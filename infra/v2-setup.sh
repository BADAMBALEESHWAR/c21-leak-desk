#!/usr/bin/env bash
# Profyn v2 platform settings on the stack infra/aws-up.sh built. Safe to re-run; every step is free (see each one).
#   bash infra/v2-setup.sh
# Run it after the v2 API is deployed. Secrets come from .env.oauth (gitignored) through infra/ssm-secrets.sh.
#   1. SSM parameters /leakdesk/{GOOGLE_*,GITHUB_*,GEMINI_*,SESSION_SECRET,PUBLIC_URL,AI_DISABLED}   (standard tier: free)
#   2. Instance role: s3:DeleteObject on the uploads bucket, so account delete removes uploads (IAM: free)
#   3. Both buckets: default encryption SSE-S3 stated explicitly (S3 already does this for new objects; free)
#   4. CloudFront: /api/* forwards every cookie, query string and header except Host, caching off; pages get the
#      managed security-headers policy (HSTS etc.)                                          (configuration: free)
#   5. Ships env-platform.sh to the instance, writes .env.platform and restarts the API (SSM Run Command: free;
#      the API is down for the few seconds the container takes to restart)
. "$(dirname "$0")/lib.sh"
load_state
: "${INSTANCE:?run infra/aws-up.sh first}"
: "${DIST_ID:?run infra/aws-up.sh first}"
ACCOUNT=${ACCOUNT:-$(aws sts get-caller-identity --query Account --output text)}
UPLOADS_BUCKET=${UPLOADS_BUCKET:-leakdesk-uploads-$ACCOUNT}
WEB_BUCKET=${WEB_BUCKET:-leakdesk-web-$ACCOUNT}
PUBLIC_URL=${PUBLIC_URL:-${SITE_URL:-https://$CF_DOMAIN}}
PUBLIC_URL=${PUBLIC_URL%/}

say "1/5 SSM parameters from .env.oauth (names and lengths only, never values)"
bash "$(dirname "$0")/ssm-secrets.sh"

say "2/5 Instance role policy (adds s3:DeleteObject on $UPLOADS_BUCKET)"
aws iam put-role-policy --role-name leakdesk-ec2 --policy-name leakdesk-app \
  --policy-document "$(sed -e "s/__REGION__/$REGION/g" -e "s/__ACCOUNT__/$ACCOUNT/g" -e "s/__UPLOADS_BUCKET__/$UPLOADS_BUCKET/g" infra/iam-policy.json)"

say "3/5 Bucket encryption (SSE-S3) on $WEB_BUCKET and $UPLOADS_BUCKET"
for b in "$WEB_BUCKET" "$UPLOADS_BUCKET"; do
  aws s3api put-bucket-encryption --bucket "$b" --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
  aws s3api get-bucket-encryption --bucket "$b" --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm' --output text | sed "s/^/   $b: /"
done

say "4/5 CloudFront $DIST_ID: cookies and query strings to /api/*, security headers on pages"
TMP=$(mk_tmp)
aws cloudfront get-distribution-config --id "$DIST_ID" > "$TMP/dist.json"
node - "$TMP/dist.json" "$TMP/config.json" "$TMP/etag" <<'JS'
const fs = require('fs');
const [, , inFile, outFile, etagFile] = process.argv;
const d = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const c = d.DistributionConfig;
const ALL_VIEWER_EXCEPT_HOST = 'b689b0a8-53d0-40ab-baf2-68738e2966ac'; // Managed-AllViewerExceptHostHeader: all cookies, query strings, headers
const CACHING_DISABLED = '4135ea2d-6df8-44a3-9df3-4b5a84be39ad'; // Managed-CachingDisabled
const SECURITY_HEADERS = '67f7725c-6f97-4210-82d7-5512b31e9d03'; // Managed-SecurityHeadersPolicy (HSTS, nosniff, frame, referrer)
const changed = [];
const api = (c.CacheBehaviors.Items || []).find((b) => b.PathPattern === '/api/*');
if (!api) { console.error('no /api/* behaviour on this distribution'); process.exit(2); }
if (api.ForwardedValues) { // legacy settings cannot be combined with policies
  for (const k of ['ForwardedValues', 'MinTTL', 'DefaultTTL', 'MaxTTL']) delete api[k];
  changed.push('/api/* legacy forwarding replaced by policies');
}
if (api.OriginRequestPolicyId !== ALL_VIEWER_EXCEPT_HOST) { api.OriginRequestPolicyId = ALL_VIEWER_EXCEPT_HOST; changed.push('/api/* forwards all cookies and query strings'); }
if (api.CachePolicyId !== CACHING_DISABLED) { api.CachePolicyId = CACHING_DISABLED; changed.push('/api/* caching off'); }
if (c.DefaultCacheBehavior.ResponseHeadersPolicyId !== SECURITY_HEADERS) { c.DefaultCacheBehavior.ResponseHeadersPolicyId = SECURITY_HEADERS; changed.push('pages: security headers policy'); }
fs.writeFileSync(outFile, JSON.stringify(c));
fs.writeFileSync(etagFile, changed.length ? d.ETag : '');
console.log(changed.length ? changed.map((x) => `   ${x}`).join('\n') : '   already set, nothing to change');
JS
ETAG=$(cat "$TMP/etag")
if [ -n "$ETAG" ]; then
  aws cloudfront update-distribution --id "$DIST_ID" --if-match "$ETAG" --distribution-config "file://$TMP/config.json" --query 'Distribution.Status' --output text | sed 's/^/   status: /'
fi
rm -rf "$TMP"

say "5/5 API restart with the new settings"
COMPOSE_B64=$(base64 -w0 infra/docker-compose.aws.yml)
ENVP_B64=$(base64 -w0 infra/env-platform.sh)
CMD=$(aws ssm send-command --instance-ids "$INSTANCE" --document-name AWS-RunShellScript \
  --parameters "commands=[\"echo $COMPOSE_B64 | base64 -d > /opt/leakdesk/docker-compose.aws.yml\",\"echo $ENVP_B64 | base64 -d > /opt/leakdesk/env-platform.sh && chmod 700 /opt/leakdesk/env-platform.sh\",\"/opt/leakdesk/env-platform.sh $REGION\",\"/opt/leakdesk/refresh.sh latest\"]" \
  --query Command.CommandId --output text)
aws ssm wait command-executed --command-id "$CMD" --instance-id "$INSTANCE" || true
aws ssm get-command-invocation --command-id "$CMD" --instance-id "$INSTANCE" --query '[Status,StandardOutputContent]' --output text | tail -4

say "Done. Register these redirect URIs with the providers (the API builds them from PUBLIC_URL):"
echo "   Google (console.cloud.google.com > APIs & Services > Credentials > OAuth client, Web): $PUBLIC_URL/api/v1/auth/google/callback"
echo "   GitHub (github.com/settings/developers > OAuth Apps > Authorization callback URL):     $PUBLIC_URL/api/v1/auth/github/callback"
echo "   Check: curl -s $PUBLIC_URL/api/v1/auth/providers   and   curl -s $PUBLIC_URL/api/v1/health"
