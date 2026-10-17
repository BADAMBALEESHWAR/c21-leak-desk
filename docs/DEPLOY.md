# Deploy

Local Docker is the primary demo path. AWS is the public site (ADR-007). Nothing here is needed to pass the three checks.

## Local (verified on the team laptop)

```
docker compose up -d --build        # api :8080, web :3000 (landing at /, app at /app/), mongo
npm run check                       # PASS ×3   (make check on macOS/Linux)
```

Ports are configurable: `API_PORT=8090 WEB_PORT=3010 docker compose up -d --build`.

## AWS architecture (Free Plan account, region ap-south-1 Mumbai)

```
Browser ──HTTPS──▶ profyn.in (Route 53 alias) ──▶ CloudFront (ACM certificate, us-east-1)
                     ├─ /  and /app/  ──▶ S3 leakdesk-web-<account>  (private, origin access control;
                     │                     a CloudFront Function serves index.html for "/" paths)
                     └─ /api/v1/*      ──▶ EC2 t3.micro :8080 (api + mongo via compose, 1 GB swap, memory caps)
                                            ├─▶ S3 leakdesk-uploads-<account>   (uploads, exports)
                                            ├─▶ SSM /leakdesk/*                 (GEMINI_API_KEY, AI_DISABLED, COGNITO_*)
                                            ├─▶ Cognito user pool "profyn"      (owner sign-in; the demo needs none)
                                            └─▶ CloudWatch Logs /leakdesk/api   (alarm on /health 503)
GitHub main ──OIDC role leakdesk-ci──▶ test → web to S3 → image to ECR → SSM refresh on EC2
```

The EC2 security group admits port 8080 only from the CloudFront origin-facing prefix list. The instance role grants S3 on the uploads bucket, SSM read on `/leakdesk/*`, ECR pull and log writes (`infra/iam-policy.json`). There are no AWS keys on the box or in GitHub. CI assumes `leakdesk-ci` through OIDC, and only from the `main` branch (`infra/ci-trust.json`, `infra/ci-policy.json`).

## First deploy

Prerequisites: AWS CLI v2, Docker running, Node 20. `.env.aws` (git-ignored) holds the `deploy-admin` access key, `AWS_DEFAULT_REGION=ap-south-1` and `DOMAIN=profyn.in`. Every script reads it, is safe to re-run and records IDs in `infra/.aws-state` (git-ignored).

| Step | Command | What it creates | Cost on the Free Plan |
|---|---|---|---|
| 1 | `bash infra/aws-up.sh` | ECR repo (keeps 5 images), two private S3 buckets, instance role, security group, EC2 t3.micro (20 GB gp3), CloudFront function and distribution, SSM parameters, CloudWatch alarm. Pushes the first image and web build | EC2 about $7–8/month, public IPv4 about $3.6/month and EBS about $1.8/month, all taken from credits. S3, CloudFront, ECR, SSM and the alarm are within free volumes |
| 2 | `bash infra/domain.sh` | Route 53 hosted zone; prints 4 nameservers and stops until the registrar uses them | $0.50/month from credits |
| 3 | change nameservers at the registrar, wait 10–30 min, then `bash infra/domain.sh` again | ACM certificate for `profyn.in` and `www.profyn.in` (DNS-validated), CloudFront aliases, A/AAAA alias records | Free |
| 4 | `bash infra/cognito.sh` | User pool `profyn`, web client (password sign-in for the `/login/` page, refresh tokens), SSM ids; restarts the API | Free up to 10,000 monthly active users |
| 4b | `bash infra/cognito-user.sh owner@example.com` | A ready login (email verified, permanent password printed once); owners can also create their own account on `/login/` | Free |
| 5 | `bash infra/ci-oidc.sh` | GitHub OIDC provider, role `leakdesk-ci`; GitHub secrets `AWS_ROLE_ARN`, `WEB_BUCKET`, `DIST_ID`, `INSTANCE_ID`, variable `AWS_REGION` | Free |
| 6 | `BASE_URL=https://profyn.in npm run check` | Nothing; runs the three checks against the live site | Free |

The domain itself is bought at an Indian registrar; AWS credits do not cover registration. Optional AI wording: `aws ssm put-parameter --name /leakdesk/GEMINI_API_KEY --type SecureString --value <key> --overwrite`, then set `/leakdesk/AI_DISABLED` to `0` and run `bash infra/deploy-api.sh`.

## Redeploy

| What | Command |
|---|---|
| Automatic | push to `main`. `.github/workflows/deploy.yml` runs test → web to S3 (HTML no-cache, assets cached) → CloudFront invalidation → image to ECR → SSM `refresh.sh <sha>`. It is skipped while the `AWS_REGION` variable is unset |
| Web only | `bash infra/deploy-web.sh`: vite build, S3 sync with a copy under `releases/<sha>/`, invalidation |
| API only | `bash infra/deploy-api.sh`: docker build, ECR push `:<sha>` and `:latest`, SSM runs `/opt/leakdesk/refresh.sh <sha>` |

## Rollback

- API: `TAG=<previous sha> bash infra/deploy-api.sh --rollback` re-runs the instance refresh with the older image (ECR keeps the last five).
- Web: `aws s3 sync s3://$WEB_BUCKET/releases/<previous sha>/ s3://$WEB_BUCKET/ --exclude "releases/*"`, then invalidate `/*`.

## Fallback if CloudFront `/api/*` misbehaves

Point the web build at the EC2 address and allow its origin:

```
aws ssm put-parameter --name /leakdesk/CORS_ORIGIN --type String --value https://profyn.in --overwrite
bash infra/deploy-api.sh
```

## Cost guard

An AWS Budget of $5 a month with email alerts is set up by hand (see the console steps in the plan). On the Free Plan you cannot be charged beyond the credits. `bash infra/aws-down.sh` empties and deletes both buckets, terminates the instance and deletes the distribution. `bash infra/aws-down.sh --all` also deletes the hosted zone. ECR images, IAM roles, SSM parameters, the Cognito pool and the certificate are kept because they have no running cost.

## Errors you may see

| Message | Fix |
|---|---|
| `Unable to locate credentials` | `.env.aws` is empty or has spaces around `=`; paste the key again |
| `InvalidClientTokenId` | the access key was deleted or mistyped; create a new one for `deploy-admin` |
| domain.sh stops with "still points elsewhere" | the registrar change has not reached DNS yet; wait and re-run |
| `CNAMEAlreadyExists` on CloudFront | the domain is attached to another distribution; remove it there first |
| CI step `configure-aws-credentials` fails | the secret `AWS_ROLE_ARN` is missing, or the push was not to `main` |
| `/api/v1/auth/config` shows `enabled:false` | run `bash infra/cognito.sh` again; it rewrites the SSM ids and restarts the API |
