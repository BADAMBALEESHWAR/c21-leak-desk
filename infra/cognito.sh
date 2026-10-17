#!/usr/bin/env bash
# Owner sign-in with Cognito (plan §8.3 H). Free up to 10,000 monthly active users. Safe to re-run.
# Creates the user pool "profyn", a hosted sign-in domain, a public web client (code flow + PKCE, no secret),
# stores the three ids in SSM and restarts the API so /api/v1/auth/config turns sign-in on.
# Judges never need it: the landing page's "Try the demo" and /checks stay open.
. "$(dirname "$0")/lib.sh"
load_state
: "${DOMAIN:?set DOMAIN in .env.aws}"
: "${INSTANCE:?run infra/aws-up.sh first}"

say "User pool profyn (email sign-in, email verified by code)"
POOL=$(aws cognito-idp list-user-pools --max-results 60 --query "UserPools[?Name=='profyn'].Id | [0]" --output text)
if [ "$POOL" = "None" ] || [ -z "$POOL" ]; then
  POOL=$(aws cognito-idp create-user-pool --pool-name profyn \
    --username-attributes email --auto-verified-attributes email \
    --policies 'PasswordPolicy={MinimumLength=8,RequireUppercase=true,RequireLowercase=true,RequireNumbers=true,RequireSymbols=false}' \
    --account-recovery-setting 'RecoveryMechanisms=[{Priority=1,Name=verified_email}]' \
    --admin-create-user-config AllowAdminCreateUserOnly=false \
    --query UserPool.Id --output text)
fi
save_state COGNITO_POOL_ID "$POOL"

say "Hosted sign-in domain"
PREFIX=$(aws cognito-idp describe-user-pool --user-pool-id "$POOL" --query UserPool.Domain --output text)
if [ "$PREFIX" = "None" ] || [ -z "$PREFIX" ]; then
  for TRY in profyn-auth "profyn-auth-$(date +%s | tail -c 5)"; do
    if aws cognito-idp create-user-pool-domain --domain "$TRY" --user-pool-id "$POOL" >/dev/null 2>&1; then PREFIX=$TRY; break; fi
  done
fi
AUTH_DOMAIN="$PREFIX.auth.$REGION.amazoncognito.com"
save_state COGNITO_DOMAIN "$AUTH_DOMAIN"

say "Web client profyn-web (callbacks: https://$DOMAIN/app/, https://${CF_DOMAIN:-cloudfront}/app/, localhost)"
CALLBACKS="https://$DOMAIN/app/ https://www.$DOMAIN/app/ http://localhost:5173/app/"
LOGOUTS="https://$DOMAIN/ https://www.$DOMAIN/ http://localhost:5173/"
if [ -n "${CF_DOMAIN:-}" ]; then CALLBACKS="$CALLBACKS https://$CF_DOMAIN/app/"; LOGOUTS="$LOGOUTS https://$CF_DOMAIN/"; fi
CLIENT=$(aws cognito-idp list-user-pool-clients --user-pool-id "$POOL" --query "UserPoolClients[?ClientName=='profyn-web'].ClientId | [0]" --output text)
CLIENT_ARGS=(--user-pool-id "$POOL" --supported-identity-providers COGNITO
  --allowed-o-auth-flows code --allowed-o-auth-scopes openid email profile --allowed-o-auth-flows-user-pool-client
  --callback-urls $CALLBACKS --logout-urls $LOGOUTS
  --explicit-auth-flows ALLOW_USER_SRP_AUTH ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH
  --prevent-user-existence-errors ENABLED --id-token-validity 8 --token-validity-units IdToken=hours)
if [ "$CLIENT" = "None" ] || [ -z "$CLIENT" ]; then
  CLIENT=$(aws cognito-idp create-user-pool-client --client-name profyn-web --no-generate-secret "${CLIENT_ARGS[@]}" \
    --query UserPoolClient.ClientId --output text)
else
  aws cognito-idp update-user-pool-client --client-id "$CLIENT" --client-name profyn-web "${CLIENT_ARGS[@]}" >/dev/null
fi
save_state COGNITO_CLIENT_ID "$CLIENT"

say "SSM parameters and API restart"
aws ssm put-parameter --name /leakdesk/COGNITO_POOL_ID --type String --value "$POOL" --overwrite >/dev/null
aws ssm put-parameter --name /leakdesk/COGNITO_CLIENT_ID --type String --value "$CLIENT" --overwrite >/dev/null
aws ssm put-parameter --name /leakdesk/COGNITO_DOMAIN --type String --value "$AUTH_DOMAIN" --overwrite >/dev/null
CMD=$(aws ssm send-command --instance-ids "$INSTANCE" --document-name AWS-RunShellScript \
  --parameters 'commands=["/opt/leakdesk/refresh.sh latest"]' --query Command.CommandId --output text)
aws ssm wait command-executed --command-id "$CMD" --instance-id "$INSTANCE" || true
say "Done. Sign-in page: https://$AUTH_DOMAIN  (the app's Sign in button opens it)"
