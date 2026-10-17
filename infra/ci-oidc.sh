#!/usr/bin/env bash
# Auto-deploy on every push to main (plan §8.3 G). Free. Safe to re-run.
# GitHub Actions gets a short-lived AWS role through OIDC (no AWS keys stored in GitHub), limited to
# infra/ci-policy.json and to the main branch of REPO. Then the repo gets the secrets deploy.yml reads.
# Setting secrets needs a token with Secrets + Variables write: GH_TOKEN in the environment, or the
# GIT_PAT_TRACK1 token from .env.git. Without one, the values are printed for the GitHub settings page.
. "$(dirname "$0")/lib.sh"
load_state
REPO=${REPO:-BADAMBALEESHWAR/c21-leak-desk}
: "${DIST_ID:?run infra/aws-up.sh first}"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
fill() { sed -e "s/__ACCOUNT__/$ACCOUNT/g" -e "s#__REPO__#$REPO#g" -e "s/__WEB_BUCKET__/$WEB_BUCKET/g" "$1"; }

say "OIDC provider token.actions.githubusercontent.com"
PROVIDER=arn:aws:iam::$ACCOUNT:oidc-provider/token.actions.githubusercontent.com
aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$PROVIDER" >/dev/null 2>&1 ||
  aws iam create-open-id-connect-provider --url https://token.actions.githubusercontent.com \
    --client-id-list sts.amazonaws.com --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 >/dev/null

say "Role leakdesk-ci (main branch of $REPO only)"
if aws iam get-role --role-name leakdesk-ci >/dev/null 2>&1; then
  aws iam update-assume-role-policy --role-name leakdesk-ci --policy-document "$(fill infra/ci-trust.json)"
else
  aws iam create-role --role-name leakdesk-ci --assume-role-policy-document "$(fill infra/ci-trust.json)" >/dev/null
fi
aws iam put-role-policy --role-name leakdesk-ci --policy-name leakdesk-deploy --policy-document "$(fill infra/ci-policy.json)"
ROLE_ARN=$(aws iam get-role --role-name leakdesk-ci --query Role.Arn --output text)
save_state CI_ROLE_ARN "$ROLE_ARN"

say "GitHub secrets and variable on $REPO"
if [ -z "${GH_TOKEN:-}" ] && [ -f .env.git ]; then
  GH_TOKEN=$(grep -E '^GIT_PAT_TRACK1=' .env.git | cut -d= -f2- | tr -d '\r "')
fi
set_all() {
  GH_TOKEN=$GH_TOKEN gh secret set AWS_ROLE_ARN -R "$REPO" --body "$ROLE_ARN" &&
  GH_TOKEN=$GH_TOKEN gh secret set WEB_BUCKET -R "$REPO" --body "$WEB_BUCKET" &&
  GH_TOKEN=$GH_TOKEN gh secret set DIST_ID -R "$REPO" --body "$DIST_ID" &&
  GH_TOKEN=$GH_TOKEN gh secret set INSTANCE_ID -R "$REPO" --body "$INSTANCE" &&
  GH_TOKEN=$GH_TOKEN gh variable set AWS_REGION -R "$REPO" --body "$REGION"
}
if [ -n "${GH_TOKEN:-}" ] && set_all >/dev/null 2>&1; then
  say "Done. Every push to main now tests, then deploys web + API."
else
  echo "Could not set them with the token (it needs Secrets and Variables: Read and write)."
  echo "Add these by hand at https://github.com/$REPO/settings/secrets/actions :"
  echo "  secret   AWS_ROLE_ARN = $ROLE_ARN"
  echo "  secret   WEB_BUCKET   = $WEB_BUCKET"
  echo "  secret   DIST_ID      = $DIST_ID"
  echo "  secret   INSTANCE_ID  = $INSTANCE"
  echo "  variable AWS_REGION   = $REGION   (Variables tab)"
fi
