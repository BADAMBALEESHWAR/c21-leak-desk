#!/bin/bash
# Runs ON THE EC2 INSTANCE (deploys and infra/v2-setup.sh copy it to /opt/leakdesk/env-platform.sh).
# Writes /opt/leakdesk/.env.platform from SSM for v2 sign-in: Google and GitHub OAuth clients, the session secret and
# the public URL. docker-compose.aws.yml reads it next to .env. Unset, empty or "none" parameters are left out, so the
# API treats them as not configured (that provider's button stays hidden).
# Usage: env-platform.sh <region>
set -euo pipefail
REGION=${1:?usage: env-platform.sh <region>}
OUT=/opt/leakdesk/.env.platform
param() { aws ssm get-parameter --region "$REGION" --with-decryption --name "/leakdesk/$1" --query Parameter.Value --output text 2>/dev/null || true; }
TMP=$(mktemp)
for NAME in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET SHOPIFY_CLIENT_ID SHOPIFY_CLIENT_SECRET RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET SESSION_SECRET PUBLIC_URL; do
  VALUE=$(param "$NAME")
  case "$VALUE" in "" | None | none) ;; *) echo "$NAME=$VALUE" >> "$TMP" ;; esac
done
install -m 600 "$TMP" "$OUT"
rm -f "$TMP"
# Names only, never values.
echo "env-platform: $(cut -d= -f1 "$OUT" | tr '\n' ' ')"
