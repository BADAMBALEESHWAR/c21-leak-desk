# ADR-007: Local first, AWS second

- Status: Accepted
- Date: 2026-10-17
- Owner: M1 (Track 1)

## Context

The organisers ask for an AWS deployment, and the judges run the three checks during a seven-minute slot. Venue networks, CloudFront propagation, free-tier limits and instance restarts can all fail at the wrong moment. The checks and the changed-input drill depend only on the engine and the data in `data/`, not on any cloud service.

## Decision

- The primary demo path is local: Docker Compose (`make up`, then `make check`), or Node alone (`npm run setup`, `npm run dev:api`, `npm run dev:web`, then `npm run check`).
- AWS is the second screen: the static web build in S3 behind CloudFront, the API and Mongo containers on one EC2 instance, images in ECR, secrets in SSM Parameter Store, logs in CloudWatch. Steps, rollback and teardown are in `docs/DEPLOY.md`.
- The check harness takes a base URL, so the same three checks run against either target: `make check BASE_URL=<url>`.
- Nothing in the journey calls a cloud service when running locally; S3 storage is used only when `S3_BUCKET` is set.

## Consequences

- A cloud outage cannot block the three checks or the judge's changed input.
- AWS work sits after the engine on the critical path and is the first item to cut if a gate slips (Roadmap §4, Track 1 cut lines).
- Two environments must stay in step; the engine version on `/health` shows which build each one runs.
- At snapshot time the AWS deployment has not been made and the Docker path has not been verified on the presenting laptop (`docs/SNAPSHOT.md`, known gaps).
