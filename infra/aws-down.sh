#!/usr/bin/env bash
# make aws-down: empties both buckets, terminates the instance, disables and deletes the distribution.
# ECR images, IAM roles, SSM parameters, the Cognito pool and the certificate are kept (no cost).
# Pass --all to also delete the Route 53 hosted zone ($0.50/month); the domain then stops resolving.
. "$(dirname "$0")/lib.sh"
load_state
aws s3 rm "s3://$WEB_BUCKET" --recursive || true
aws s3 rm "s3://$UPLOADS_BUCKET" --recursive || true
aws ec2 terminate-instances --instance-ids "$INSTANCE" >/dev/null || true
TMP=$(mk_tmp)
aws cloudfront get-distribution-config --id "$DIST_ID" > "$TMP/cf.json"
node -e "const fs=require('fs');const r=JSON.parse(fs.readFileSync('$TMP/cf.json','utf8'));r.DistributionConfig.Enabled=false;fs.writeFileSync('$TMP/off.json',JSON.stringify(r.DistributionConfig));fs.writeFileSync('$TMP/etag',r.ETag)"
aws cloudfront update-distribution --id "$DIST_ID" --if-match "$(cat "$TMP/etag")" --distribution-config "file://$TMP/off.json" >/dev/null
echo "Waiting for the distribution to disable (can take ~10 min)…"
aws cloudfront wait distribution-deployed --id "$DIST_ID"
ETAG=$(aws cloudfront get-distribution-config --id "$DIST_ID" --query ETag --output text)
aws cloudfront delete-distribution --id "$DIST_ID" --if-match "$ETAG"
rm -rf "$TMP"
aws s3api delete-bucket --bucket "$WEB_BUCKET" || true
aws s3api delete-bucket --bucket "$UPLOADS_BUCKET" || true
if [ "${1:-}" = "--all" ] && [ -n "${HOSTED_ZONE_ID:-}" ]; then
  aws route53 list-resource-record-sets --hosted-zone-id "$HOSTED_ZONE_ID" \
    --query "ResourceRecordSets[?Type!='NS' && Type!='SOA']" --output json > "infra/.tmp-zone.json"
  node -e "const fs=require('fs');const r=JSON.parse(fs.readFileSync('infra/.tmp-zone.json','utf8'));fs.writeFileSync('infra/.tmp-zone.json',JSON.stringify({Changes:r.map(x=>({Action:'DELETE',ResourceRecordSet:x}))}))"
  aws route53 change-resource-record-sets --hosted-zone-id "$HOSTED_ZONE_ID" --change-batch file://infra/.tmp-zone.json >/dev/null || true
  aws route53 delete-hosted-zone --id "$HOSTED_ZONE_ID" >/dev/null && echo "Hosted zone deleted."
  rm -f infra/.tmp-zone.json
fi
echo "Torn down. Instance $INSTANCE terminating; buckets and distribution deleted."
