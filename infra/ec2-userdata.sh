#!/bin/bash
# EC2 user-data (Ubuntu 24.04): Docker + compose, pull the API image from ECR, read secrets from SSM, start api + mongo.
# Placeholders __REGION__, __ACCOUNT__, __UPLOADS_BUCKET__ and __COMPOSE__ are filled by infra/aws-up.sh.
# Behind CloudFront the browser and /api/* share one origin, so CORS_ORIGIN is only needed for the EC2-IP fallback.
set -euo pipefail
REGION=__REGION__
ACCOUNT=__ACCOUNT__
REGISTRY="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"

apt-get update -y
apt-get install -y ca-certificates curl unzip
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscli.zip
unzip -q /tmp/awscli.zip -d /tmp && /tmp/aws/install

mkdir -p /opt/leakdesk
cat > /opt/leakdesk/refresh.sh <<EOF
#!/bin/bash
# Re-reads SSM parameters, logs in to ECR, pulls and restarts. Called by user-data and by deploys (SSM send-command).
set -euo pipefail
param() { aws ssm get-parameter --region $REGION --with-decryption --name "\$1" --query Parameter.Value --output text 2>/dev/null || true; }
{
  echo "MONGO_URL=mongodb://mongo:27017/leakdesk"
  echo "S3_BUCKET=__UPLOADS_BUCKET__"
  echo "CORS_ORIGIN=\$(param /leakdesk/CORS_ORIGIN)"
  echo "GEMINI_API_KEY=\$(param /leakdesk/GEMINI_API_KEY)"
  echo "GEMINI_MODEL=\$(param /leakdesk/GEMINI_MODEL)"
  echo "AI_DISABLED=\$(param /leakdesk/AI_DISABLED)"
} > /opt/leakdesk/.env
chmod 600 /opt/leakdesk/.env
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $REGISTRY
cd /opt/leakdesk
export API_IMAGE=$REGISTRY/leakdesk-api:\${1:-latest} AWS_REGION=$REGION
docker compose -f docker-compose.aws.yml pull
docker compose -f docker-compose.aws.yml up -d
EOF
chmod +x /opt/leakdesk/refresh.sh

cat > /opt/leakdesk/docker-compose.aws.yml <<'EOF'
__COMPOSE__
EOF

/opt/leakdesk/refresh.sh latest
