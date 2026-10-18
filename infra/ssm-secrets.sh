#!/bin/bash
# Copies sign-in and AI secrets from .env.oauth (gitignored) into SSM under /leakdesk/.
# Secrets are SecureString (AWS-managed key, no charge); standard parameters are free. Never prints a value.
# Run from anywhere: bash infra/ssm-secrets.sh   (safe to re-run; keeps an existing SESSION_SECRET)
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env.oauth ] || { echo "missing .env.oauth in the repo root"; exit 1; }
set -a; . ./.env.aws; set +a
export MSYS_NO_PATHCONV=1 AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION:-ap-south-1}
val() { grep "^$1=" .env.oauth | cut -d= -f2- | tr -d '\r' || true; }
put() { # name value type
  [ -n "$2" ] || { echo "skip $1 (empty in .env.oauth)"; return; }
  aws ssm put-parameter --name "/leakdesk/$1" --type "$3" --value "$2" --overwrite >/dev/null
  echo "stored /leakdesk/$1 ($3, length ${#2})"
}
put GITHUB_CLIENT_ID "$(val GITHUB_CLIENT_ID)" String
put GITHUB_CLIENT_SECRET "$(val GITHUB_CLIENT_SECRET)" SecureString
put GOOGLE_CLIENT_ID "$(val GOOGLE_CLIENT_ID)" String
put GOOGLE_CLIENT_SECRET "$(val GOOGLE_CLIENT_SECRET)" SecureString
put GEMINI_API_KEY "$(val GEMINI_API_KEY)" SecureString
# Optional: a Shopify app from the Dev Dashboard, for "Install Profyn from Shopify" (the token method works without it).
put SHOPIFY_CLIENT_ID "$(val SHOPIFY_CLIENT_ID)" String
put SHOPIFY_CLIENT_SECRET "$(val SHOPIFY_CLIENT_SECRET)" SecureString
put GEMINI_MODEL gemini-3.5-flash String
put PUBLIC_URL https://d2gmrabs4sk8gk.cloudfront.net String
# AI on: the v2 API still keeps it off for uploaded data unless the signed-in owner consents (demo data only by default).
put AI_DISABLED 0 String
if aws ssm get-parameter --name /leakdesk/SESSION_SECRET >/dev/null 2>&1; then echo "kept /leakdesk/SESSION_SECRET"; else
  put SESSION_SECRET "$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")" SecureString; fi
echo "done: $(aws ssm get-parameters-by-path --path /leakdesk/ --query 'length(Parameters)' --output text) parameters under /leakdesk/"
