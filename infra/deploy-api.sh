#!/usr/bin/env bash
# docker build → ECR push (:sha and :latest) → SSM send-command runs refresh.sh on the instance.
# Rollback: TAG=<previous sha> bash infra/deploy-api.sh --rollback
. "$(dirname "$0")/lib.sh"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REGISTRY="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"
SHA=${TAG:-$(git rev-parse --short HEAD 2>/dev/null || date +%s)}

if [ "${1:-}" != "--rollback" ]; then
  aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY"
  docker build -f api/Dockerfile -t "$REGISTRY/leakdesk-api:$SHA" -t "$REGISTRY/leakdesk-api:latest" .
  docker push "$REGISTRY/leakdesk-api:$SHA"
  docker push "$REGISTRY/leakdesk-api:latest"
fi
[ "${1:-}" = "--push-only" ] && exit 0

load_state
# Ship the current compose file with every deploy, so infra/docker-compose.aws.yml changes reach the instance.
COMPOSE_B64=$(base64 -w0 infra/docker-compose.aws.yml)
CMD=$(aws ssm send-command --instance-ids "$INSTANCE" --document-name AWS-RunShellScript \
  --parameters "commands=[\"echo $COMPOSE_B64 | base64 -d > /opt/leakdesk/docker-compose.aws.yml\",\"/opt/leakdesk/refresh.sh $SHA\"]" \
  --query Command.CommandId --output text)
aws ssm wait command-executed --command-id "$CMD" --instance-id "$INSTANCE" || true
aws ssm get-command-invocation --command-id "$CMD" --instance-id "$INSTANCE" --query '[Status,StandardOutputContent]' --output text | tail -5
echo "api $SHA deployed; check: BASE_URL=${SITE_URL:-https://$CF_DOMAIN} make check"
