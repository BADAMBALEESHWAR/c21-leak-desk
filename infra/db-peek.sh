#!/bin/bash
# Read-only look at the live MongoDB through SSM Run Command (free): collection counts, sign-in users, latest logins.
# Run from anywhere: bash infra/db-peek.sh
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env.aws; set +a
command -v aws >/dev/null 2>&1 || PATH="$PATH:/c/Program Files/Amazon/AWSCLIV2"
export MSYS_NO_PATHCONV=1 AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION:-ap-south-1}
INSTANCE=i-072e8e3b4aec9f324
JS='const d=db.getSiblingDB("leakdesk");
print("== collections (documents) ==");
d.getCollectionNames().sort().forEach(c=>print(c.padEnd(16),d.getCollection(c).countDocuments()));
print("== users (who signed in) ==");
d.users.find({},{email:1,name:1,provider:1,created_at:1,last_login_at:1,consent:1}).forEach(u=>print(JSON.stringify({email:u.email,name:u.name,provider:u.provider,created:u.created_at,last_login:u.last_login_at,consent:u.consent})));
print("== latest 5 logins ==");
d.logins.find({},{provider:1,at:1,_id:0}).sort({at:-1}).limit(5).forEach(l=>print(JSON.stringify(l)));
print("== latest 3 decisions ==");
d.decisions.find({},{intervention:1,owner:1,saved_at:1,_id:0}).sort({saved_at:-1}).limit(3).forEach(x=>print(JSON.stringify(x)));'
B64=$(printf '%s' "$JS" | base64 -w0)
CMD=$(aws ssm send-command --instance-ids "$INSTANCE" --document-name AWS-RunShellScript \
  --parameters "commands=[\"echo $B64 | base64 -d > /tmp/peek.js\",\"docker exec -i \$(docker ps -qf name=mongo) mongosh --quiet < /tmp/peek.js; rm -f /tmp/peek.js\"]" \
  --query Command.CommandId --output text)
aws ssm wait command-executed --command-id "$CMD" --instance-id "$INSTANCE" || true
aws ssm get-command-invocation --command-id "$CMD" --instance-id "$INSTANCE" --query StandardOutputContent --output text
