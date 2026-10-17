#!/usr/bin/env bash
# make aws-down: empties both buckets, terminates the instance, disables and deletes the distribution.
# ECR images, the IAM role and SSM parameters are kept (no cost); delete them by hand if you want a clean account.
set -euo pipefail
cd "$(dirname "$0")/.."
source infra/.aws-state
export AWS_DEFAULT_REGION=$REGION
aws s3 rm "s3://$WEB_BUCKET" --recursive || true
aws s3 rm "s3://$UPLOADS_BUCKET" --recursive || true
aws ec2 terminate-instances --instance-ids "$INSTANCE" >/dev/null || true
ETAG=$(aws cloudfront get-distribution-config --id "$DIST_ID" --query ETag --output text)
aws cloudfront get-distribution-config --id "$DIST_ID" --query DistributionConfig > /tmp/leakdesk-cf.json
sed -i 's/"Enabled": true/"Enabled": false/' /tmp/leakdesk-cf.json
aws cloudfront update-distribution --id "$DIST_ID" --if-match "$ETAG" --distribution-config file:///tmp/leakdesk-cf.json >/dev/null
echo "Waiting for the distribution to disable (can take ~10 min)…"
aws cloudfront wait distribution-deployed --id "$DIST_ID"
ETAG=$(aws cloudfront get-distribution-config --id "$DIST_ID" --query ETag --output text)
aws cloudfront delete-distribution --id "$DIST_ID" --if-match "$ETAG"
aws s3api delete-bucket --bucket "$WEB_BUCKET" || true
aws s3api delete-bucket --bucket "$UPLOADS_BUCKET" || true
echo "Torn down. Instance $INSTANCE terminating; buckets and distribution deleted."
