#!/usr/bin/env bash
# vite build → S3 sync (keeping a copy under releases/<sha>/ for rollback) → CloudFront invalidation.
. "$(dirname "$0")/lib.sh"
load_state
SHA=$(git rev-parse --short HEAD 2>/dev/null || date +%s)
[ -d web/node_modules ] || npm --prefix web ci   # reuse installed modules (a running dev server locks them on Windows)
npm --prefix web run build
aws s3 sync web/dist "s3://$WEB_BUCKET/releases/$SHA/" --delete
aws s3 sync web/dist "s3://$WEB_BUCKET/" --delete --exclude "releases/*" --cache-control "public,max-age=300"
# pages (/ and /app/) must never be cached, so a deploy shows at once; hashed assets can be
aws s3 cp web/dist "s3://$WEB_BUCKET/" --recursive --exclude "*" --include "*.html" --cache-control "no-cache"
# Keep the CloudFront function (folder → index.html, /app and /login redirects) in step with infra/cf-dir-index.js.
FN_ETAG=$(aws cloudfront describe-function --name profyn-dir-index --query ETag --output text 2>/dev/null || true)
if [ -n "$FN_ETAG" ] && [ "$FN_ETAG" != "None" ]; then
  FN_ETAG=$(aws cloudfront update-function --name profyn-dir-index --if-match "$FN_ETAG" --function-config Comment="index.html for directories",Runtime=cloudfront-js-2.0 --function-code fileb://infra/cf-dir-index.js --query ETag --output text)
  aws cloudfront publish-function --name profyn-dir-index --if-match "$FN_ETAG" >/dev/null
fi
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" >/dev/null
echo "web $SHA live on ${SITE_URL:-https://$CF_DOMAIN}"
