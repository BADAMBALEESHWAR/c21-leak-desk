#!/usr/bin/env bash
# First-time AWS provisioning for Profyn (plan §8.3 E). Keys come from .env.aws. Run once from the repo root:
#   bash infra/aws-up.sh            (INSTANCE_TYPE defaults to t3.micro, the free-tier size)
# Creates: ECR repo, two private S3 buckets, IAM instance role, security group, one EC2 instance, a CloudFront
# function + distribution with /api/* to EC2, SSM parameters, a CloudWatch alarm. IDs go to infra/.aws-state (git-ignored).
. "$(dirname "$0")/lib.sh"
load_state
shopt -u patsub_replacement 2>/dev/null || true # bash 5.2: keep "&" literal when the compose file is spliced into user-data
# Use a size this account gets free: legacy accounts (before 15 July 2025) get t2.micro or t3.micro depending on the
# region, Free Plan accounts get t3.micro. The AMI is x86, so Graviton (t4g) sizes are skipped.
if [ -z "${INSTANCE_TYPE:-}" ]; then
  FREE=$(aws ec2 describe-instance-types --filters Name=free-tier-eligible,Values=true --query 'InstanceTypes[].InstanceType' --output text 2>/dev/null || true)
  for T in t3.micro t2.micro t3.small; do
    if echo " $FREE " | tr '\t\n' '  ' | grep -q " $T "; then INSTANCE_TYPE=$T; break; fi
  done
  INSTANCE_TYPE=${INSTANCE_TYPE:-t3.micro}
fi
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
WEB_BUCKET=leakdesk-web-$ACCOUNT
UPLOADS_BUCKET=leakdesk-uploads-$ACCOUNT
fill() { sed -e "s/__REGION__/$REGION/g" -e "s/__ACCOUNT__/$ACCOUNT/g" -e "s/__WEB_BUCKET__/$WEB_BUCKET/g" -e "s/__UPLOADS_BUCKET__/$UPLOADS_BUCKET/g" "$1"; }

say "ECR repository leakdesk-api"
aws ecr describe-repositories --repository-names leakdesk-api >/dev/null 2>&1 || aws ecr create-repository --repository-name leakdesk-api --image-scanning-configuration scanOnPush=true >/dev/null
# keep the last 5 images so ECR stays inside the 500 MB free storage
aws ecr put-lifecycle-policy --repository-name leakdesk-api --lifecycle-policy-text '{"rules":[{"rulePriority":1,"description":"keep last 5","selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":5},"action":{"type":"expire"}}]}' >/dev/null

say "S3 buckets $WEB_BUCKET and $UPLOADS_BUCKET (private)"
for b in "$WEB_BUCKET" "$UPLOADS_BUCKET"; do
  aws s3api head-bucket --bucket "$b" 2>/dev/null || aws s3api create-bucket --bucket "$b" --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
  aws s3api put-public-access-block --bucket "$b" --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
done

say "SSM parameters (fill GEMINI_API_KEY yourself: aws ssm put-parameter --name /leakdesk/GEMINI_API_KEY --type SecureString --value ... --overwrite)"
aws ssm put-parameter --name /leakdesk/AI_DISABLED --type String --value 1 --overwrite >/dev/null
aws ssm put-parameter --name /leakdesk/GEMINI_MODEL --type String --value gemini-2.5-flash --overwrite >/dev/null
aws ssm get-parameter --name /leakdesk/GEMINI_API_KEY >/dev/null 2>&1 || aws ssm put-parameter --name /leakdesk/GEMINI_API_KEY --type SecureString --value none >/dev/null

say "IAM instance role leakdesk-ec2 (S3 uploads, SSM read, ECR pull, logs; SSM agent for deploys)"
if ! aws iam get-role --role-name leakdesk-ec2 >/dev/null 2>&1; then
  aws iam create-role --role-name leakdesk-ec2 --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  aws iam attach-role-policy --role-name leakdesk-ec2 --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
  aws iam create-instance-profile --instance-profile-name leakdesk-ec2 >/dev/null
  aws iam add-role-to-instance-profile --instance-profile-name leakdesk-ec2 --role-name leakdesk-ec2
  sleep 10
fi
aws iam put-role-policy --role-name leakdesk-ec2 --policy-name leakdesk-app --policy-document "$(fill infra/iam-policy.json)"

say "First API image to ECR"
bash infra/deploy-api.sh --push-only

say "Security group: port 8080 from CloudFront only"
VPC=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=leakdesk-api Name=vpc-id,Values="$VPC" --query 'SecurityGroups[0].GroupId' --output text)
if [ "$SG" = "None" ]; then
  SG=$(aws ec2 create-security-group --group-name leakdesk-api --description "Leak Desk API from CloudFront" --vpc-id "$VPC" --query GroupId --output text)
  PL=$(aws ec2 describe-managed-prefix-lists --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing --query 'PrefixLists[0].PrefixListId' --output text)
  aws ec2 authorize-security-group-ingress --group-id "$SG" --ip-permissions "IpProtocol=tcp,FromPort=8080,ToPort=8080,PrefixListIds=[{PrefixListId=$PL}]" >/dev/null
fi

say "CloudFront origin access control for the web bucket"
OAC=$(aws cloudfront list-origin-access-controls --query "OriginAccessControlList.Items[?Name=='leakdesk-web'].Id | [0]" --output text)
if [ "$OAC" = "None" ] || [ -z "$OAC" ]; then
  OAC=$(aws cloudfront create-origin-access-control --origin-access-control-config Name=leakdesk-web,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3 --query OriginAccessControl.Id --output text)
fi

STATE_OF=$( [ -n "${INSTANCE:-}" ] && aws ec2 describe-instances --instance-ids "$INSTANCE" --query 'Reservations[0].Instances[0].State.Name' --output text 2>/dev/null || echo none)
if [ "$STATE_OF" = "running" ] || [ "$STATE_OF" = "pending" ] || [ "$STATE_OF" = "stopped" ]; then
say "EC2 $INSTANCE already exists ($STATE_OF), reusing it"
else
say "EC2 $INSTANCE_TYPE (Ubuntu 24.04) with user-data"
AMI=$(aws ssm get-parameter --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id --query Parameter.Value --output text)
COMPOSE=$(cat infra/docker-compose.aws.yml)
USERDATA=$(fill infra/ec2-userdata.sh)
USERDATA=${USERDATA/__COMPOSE__/$COMPOSE}
case "$USERDATA" in *__COMPOSE__*|*__REGION__*|*__ACCOUNT__*|*__UPLOADS_BUCKET__*) echo "user-data still has a placeholder" >&2; exit 1 ;; esac
INSTANCE=$(aws ec2 run-instances --image-id "$AMI" --instance-type "$INSTANCE_TYPE" --security-group-ids "$SG" \
  --iam-instance-profile Name=leakdesk-ec2 --user-data "$USERDATA" \
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=20,VolumeType=gp3}' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=leakdesk-api},{Key=app,Value=leakdesk}]' \
  --query 'Instances[0].InstanceId' --output text)
fi
aws ec2 wait instance-running --instance-ids "$INSTANCE"
EC2_DNS=$(aws ec2 describe-instances --instance-ids "$INSTANCE" --query 'Reservations[0].Instances[0].PublicDnsName' --output text)

say "CloudFront function: index.html for / and /app/"
FN_NAME=profyn-dir-index
if ! aws cloudfront describe-function --name $FN_NAME >/dev/null 2>&1; then
  aws cloudfront create-function --name $FN_NAME --function-config Comment="index.html for directories",Runtime=cloudfront-js-2.0 --function-code fileb://infra/cf-dir-index.js >/dev/null
fi
FN_ETAG=$(aws cloudfront describe-function --name $FN_NAME --query ETag --output text)
aws cloudfront publish-function --name $FN_NAME --if-match "$FN_ETAG" >/dev/null || true
FN_ARN=$(aws cloudfront describe-function --name $FN_NAME --stage LIVE --query FunctionSummary.FunctionMetadata.FunctionARN --output text)

if [ -n "${DIST_ID:-}" ] && aws cloudfront get-distribution --id "$DIST_ID" >/dev/null 2>&1; then
say "CloudFront $DIST_ID already exists, reusing it"
else
say "CloudFront distribution"
CF_CONFIG=$(fill infra/cloudfront-config.json | sed -e "s/__CALLER_REF__/leakdesk-$(date +%s)/" -e "s/__OAC_ID__/$OAC/" -e "s/__EC2_DNS__/$EC2_DNS/" -e "s#__FN_ARN__#$FN_ARN#")
DIST=$(aws cloudfront create-distribution --distribution-config "$CF_CONFIG" --query 'Distribution.[Id,DomainName]' --output text)
DIST_ID=$(echo "$DIST" | cut -f1)
CF_DOMAIN=$(echo "$DIST" | cut -f2)
fi
aws s3api put-bucket-policy --bucket "$WEB_BUCKET" --policy "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"cloudfront.amazonaws.com\"},\"Action\":\"s3:GetObject\",\"Resource\":\"arn:aws:s3:::$WEB_BUCKET/*\",\"Condition\":{\"StringEquals\":{\"AWS:SourceArn\":\"arn:aws:cloudfront::$ACCOUNT:distribution/$DIST_ID\"}}}]}"

say "CloudWatch alarm on /health"
aws logs create-log-group --log-group-name /leakdesk/api 2>/dev/null || true
aws logs put-metric-filter --log-group-name /leakdesk/api --filter-name health-503 --filter-pattern '{ $.res.statusCode = 503 }' \
  --metric-transformations metricName=Health503,metricNamespace=LeakDesk,metricValue=1 || true
aws cloudwatch put-metric-alarm --alarm-name leakdesk-health-503 --namespace LeakDesk --metric-name Health503 --statistic Sum \
  --period 60 --evaluation-periods 1 --threshold 1 --comparison-operator GreaterThanOrEqualToThreshold --treat-missing-data notBreaching

for KV in REGION ACCOUNT WEB_BUCKET UPLOADS_BUCKET INSTANCE EC2_DNS SG OAC DIST_ID CF_DOMAIN; do save_state "$KV" "${!KV}"; done

say "Web build to S3"
bash infra/deploy-web.sh

say "Done. CloudFront: https://$CF_DOMAIN (allow ~10 min to deploy). Then: BASE_URL=https://$CF_DOMAIN make check"
