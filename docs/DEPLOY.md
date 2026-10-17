# Deploy

Local Docker is the primary demo path; AWS is the second screen (ADR-007). Nothing here is needed to pass the three checks.

## Local (verified on the team laptop)

```
docker compose up -d --build        # api :8080, web :3000, mongo
npm run check                       # PASS ×3   (make check on macOS/Linux)
```

Ports are configurable: `API_PORT=8090 WEB_PORT=3010 docker compose up -d --build`.

## AWS architecture (Blueprint §19.3)

```
Browser ──HTTPS──▶ CloudFront ── /        ──▶ S3 leakdesk-web-<account>  (private, origin access control)
                              └─ /api/v1/* ──▶ EC2 t3.small :8080 (api + mongo via compose)
                                                 ├─▶ S3 leakdesk-uploads-<account>  (uploads, exports)
                                                 ├─▶ SSM Parameter Store /leakdesk/*  (GEMINI_API_KEY, AI_DISABLED, …)
                                                 └─▶ CloudWatch Logs /leakdesk/api  (alarm on /health 503)
ECR leakdesk-api ◀── CI or infra/deploy-api.sh pushes :<sha> and :latest
```

Region default `ap-south-1` (Mumbai). The EC2 security group admits port 8080 only from the CloudFront origin-facing prefix list. The instance role grants S3 on the uploads bucket, SSM read on `/leakdesk/*`, ECR pull and log writes (`infra/iam-policy.json`); there are no keys on the box.

## First deploy (five commands)

Prerequisites: AWS CLI v2 signed in to the team account (`aws sts get-caller-identity` works), Docker running, Node 20.

```
REGION=ap-south-1 make aws-up                       # ECR, buckets, role, SG, EC2, CloudFront, SSM, alarm; pushes the first image and web build
aws ssm put-parameter --name /leakdesk/GEMINI_API_KEY --type SecureString --value <key> --overwrite   # optional; AI stays off until AI_DISABLED=0
source infra/.aws-state && echo https://$CF_DOMAIN  # the public URL (allow ~10 min for CloudFront)
BASE_URL=https://$CF_DOMAIN make check              # PASS ×3 against AWS
make aws-down                                       # teardown after the event
```

On Windows without `make`, run the scripts directly: `REGION=ap-south-1 bash infra/aws-up.sh`.

## Redeploy

| What | Command |
|---|---|
| Web only | `make deploy-web` — vite build, S3 sync (a copy under `releases/<sha>/`), CloudFront invalidation |
| API only | `make deploy-api` — docker build, ECR push `:<sha>` and `:latest`, SSM runs `/opt/leakdesk/refresh.sh <sha>` |
| From CI | push to `main`; `.github/workflows/deploy.yml` runs test → web → ECR → SSM. Needs secrets `AWS_ROLE_ARN` (OIDC role with `infra/ci-policy.json`), `WEB_BUCKET`, `DIST_ID`, `INSTANCE_ID` and variable `AWS_REGION`; it is skipped while `AWS_REGION` is unset |

## Rollback

- API: `TAG=<previous sha> bash infra/deploy-api.sh --rollback` re-runs the instance refresh with the older image (every image is kept in ECR by sha).
- Web: `aws s3 sync s3://$WEB_BUCKET/releases/<previous sha>/ s3://$WEB_BUCKET/ --exclude "releases/*"` then invalidate `/*`.

## Fallback if CloudFront `/api/*` misbehaves

Cut line from the Roadmap: point the web build at the EC2 address and allow its origin.

```
aws ssm put-parameter --name /leakdesk/CORS_ORIGIN --type String --value https://<cloudfront-domain> --overwrite
make deploy-api
```

## Cost guard

One t3.small (roughly US$15–20 a month on demand if left running; check the current price for your region), S3 and CloudFront within free-tier volumes, CloudWatch logs at demo volume. `make aws-down` empties and deletes both buckets, terminates the instance and deletes the distribution; ECR images, the IAM role and SSM parameters are left (no running cost).

## Status

The scripts in `infra/` are syntax-checked but have not yet been run against an AWS account from this laptop (the AWS CLI is not installed here). Record the first run's URL and `make check` output in `docs/SNAPSHOT.md`.
