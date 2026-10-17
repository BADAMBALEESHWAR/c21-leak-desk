#!/usr/bin/env bash
# First-time AWS provisioning for Leak Desk (Blueprint §19.3). Run once from the repo root with AWS credentials:
#   REGION=ap-south-1 bash infra/aws-up.sh
# Creates: ECR repo, two S3 buckets, IAM instance role, security group, EC2 t3.small, CloudFront with /api/* to EC2,
# SSM parameters and a CloudWatch alarm. Writes the IDs to infra/.aws-state (git-ignored). Cost: one t3.small + S3/CloudFront free tier.
set -euo pipefail
cd "$(dirname "$0")/.."
REGION=${REGION:-ap-south-1}
export AWS_DEFAULT_REGION=$REGION
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
WEB_BUCKET=leakdesk-web-$ACCOUNT
UPLOADS_BUCKET=leakdesk-uploads-$ACCOUNT
STATE=infra/.aws-state
say() { echo "== $*"; }
fill() { sed -e "s/__REGION__/$REGION/g" -e "s/__ACCOUNT__/$ACCOUNT/g" -e "s/__WEB_BUCKET__/$WEB_BUCKET/g" -e "s/__UPLOADS_BUCKET__/$UPLOADS_BUCKET/g" "$1"; }

say "ECR repository leakdesk-api"
aws ecr describe-repositories --repository-names leakdesk-api >/dev/null 2>&1 || aws ecr create-repository --repository-name leakdesk-api --image-scanning-configuration scanOnPush=true >/dev/null

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
REGION=$REGION bash infra/deploy-api.sh --push-only

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

say "EC2 t3.small (Ubuntu 24.04) with user-data"
AMI=$(aws ssm get-parameter --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id --query Parameter.Value --output text)
COMPOSE=$(cat infra/docker-compose.aws.yml)
USERDATA=$(fill infra/ec2-userdata.sh)
USERDATA=${USERDATA/__COMPOSE__/$COMPOSE}
INSTANCE=$(aws ec2 run-instances --image-id "$AMI" --instance-type t3.small --security-group-ids "$SG" \
  --iam-instance-profile Name=leakdesk-ec2 --user-data "$USERDATA" \
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=20,VolumeType=gp3}' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=leakdesk-api},{Key=app,Value=leakdesk}]' \
  --query 'Instances[0].InstanceId' --output text)
aws ec2 wait instance-running --instance-ids "$INSTANCE"
EC2_DNS=$(aws ec2 describe-instances --instance-ids "$INSTANCE" --query 'Reservations[0].Instances[0].PublicDnsName' --output text)

say "CloudFront distribution"
CF_CONFIG=$(fill infra/cloudfront-config.json | sed -e "s/__CALLER_REF__/leakdesk-$(date +%s)/" -e "s/__OAC_ID__/$OAC/" -e "s/__EC2_DNS__/$EC2_DNS/")
DIST=$(aws cloudfront create-distribution --distribution-config "$CF_CONFIG" --query 'Distribution.[Id,DomainName]' --output text)
DIST_ID=$(echo "$DIST" | cut -f1)
CF_DOMAIN=$(echo "$DIST" | cut -f2)
aws s3api put-bucket-policy --bucket "$WEB_BUCKET" --policy "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"cloudfront.amazonaws.com\"},\"Action\":\"s3:GetObject\",\"Resource\":\"arn:aws:s3:::$WEB_BUCKET/*\",\"Condition\":{\"StringEquals\":{\"AWS:SourceArn\":\"arn:aws:cloudfront::$ACCOUNT:distribution/$DIST_ID\"}}}]}"

say "CloudWatch alarm on /health"
aws logs create-log-group --log-group-name /leakdesk/api 2>/dev/null || true
aws logs put-metric-filter --log-group-name /leakdesk/api --filter-name health-503 --filter-pattern '{ $.res.statusCode = 503 }' \
  --metric-transformations metricName=Health503,metricNamespace=LeakDesk,metricValue=1 || true
aws cloudwatch put-metric-alarm --alarm-name leakdesk-health-503 --namespace LeakDesk --metric-name Health503 --statistic Sum \
  --period 60 --evaluation-periods 1 --threshold 1 --comparison-operator GreaterThanOrEqualToThreshold --treat-missing-data notBreaching

cat > "$STATE" <<EOF
REGION=$REGION
ACCOUNT=$ACCOUNT
WEB_BUCKET=$WEB_BUCKET
UPLOADS_BUCKET=$UPLOADS_BUCKET
INSTANCE=$INSTANCE
EC2_DNS=$EC2_DNS
SG=$SG
OAC=$OAC
DIST_ID=$DIST_ID
CF_DOMAIN=$CF_DOMAIN
EOF

say "Web build to S3"
REGION=$REGION bash infra/deploy-web.sh

say "Done. CloudFront: https://$CF_DOMAIN (allow ~10 min to deploy). Then: BASE_URL=https://$CF_DOMAIN make check"
