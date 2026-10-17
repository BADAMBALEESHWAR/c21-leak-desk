#!/usr/bin/env bash
# vite build → S3 sync (keeping a copy under releases/<sha>/ for rollback) → CloudFront invalidation.
set -euo pipefail
cd "$(dirname "$0")/.."
source infra/.aws-state
export AWS_DEFAULT_REGION=${REGION}
SHA=$(git rev-parse --short HEAD 2>/dev/null || date +%s)
npm --prefix web ci
npm --prefix web run build
aws s3 sync web/dist "s3://$WEB_BUCKET/releases/$SHA/" --delete
aws s3 sync web/dist "s3://$WEB_BUCKET/" --delete --exclude "releases/*" --cache-control "public,max-age=300"
aws s3 cp web/dist/index.html "s3://$WEB_BUCKET/index.html" --cache-control "no-cache"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" >/dev/null
echo "web $SHA live on https://$CF_DOMAIN"
