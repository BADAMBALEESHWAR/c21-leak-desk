#!/usr/bin/env bash
# Creates (or resets) a ready-to-use Profyn login: email verified, permanent password, no email sent.
#   bash infra/cognito-user.sh owner@example.com            → prints a generated password once
#   PASSWORD='...' bash infra/cognito-user.sh owner@example.com
. "$(dirname "$0")/lib.sh"
load_state
EMAIL=${1:?usage: bash infra/cognito-user.sh <email>}
: "${COGNITO_POOL_ID:?run infra/cognito.sh first}"
if [ -z "${PASSWORD:-}" ]; then
  # 14 characters with upper, lower and a digit (the pool policy); no symbols, so it is easy to type.
  PASSWORD="Pf$(node -e "const c='abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';let s='';for(const b of require('crypto').randomBytes(10))s+=c[b%c.length];console.log(s)")7"
fi
if ! aws cognito-idp admin-get-user --user-pool-id "$COGNITO_POOL_ID" --username "$EMAIL" >/dev/null 2>&1; then
  aws cognito-idp admin-create-user --user-pool-id "$COGNITO_POOL_ID" --username "$EMAIL" --message-action SUPPRESS \
    --user-attributes Name=email,Value="$EMAIL" Name=email_verified,Value=true >/dev/null
fi
aws cognito-idp admin-set-user-password --user-pool-id "$COGNITO_POOL_ID" --username "$EMAIL" --password "$PASSWORD" --permanent
echo "Login ready:"
echo "  email:    $EMAIL"
echo "  password: $PASSWORD"
