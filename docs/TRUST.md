# Trust: what happens to your data

Profyn holds an owner's order exports, costs and decisions. This page says where that data lives, who can see it,
what the AI sees, and how to take it out or delete it. Where the deployment does not yet do what a promise needs,
the gap is stated and the fix named.

## The data promise

| Promise | How it is kept | Status |
|---|---|---|
| **Stored in India** | All AWS resources (EC2 API + MongoDB, S3 buckets, SSM parameters, CloudWatch logs) are created in `ap-south-1` (Mumbai): `infra/lib.sh` defaults `REGION` to it. `GET /api/v1/health` reports `region`. CloudFront is a global CDN: it terminates TLS near the viewer and does not store API responses (`/api/*` caching is off). | In place |
| **Encrypted in transit (browser to Profyn)** | HTTPS only: CloudFront redirects HTTP to HTTPS on every path. The API sends `Strict-Transport-Security: max-age=31536000; includeSubDomains`; `infra/v2-setup.sh` also puts CloudFront's managed security-headers policy (HSTS, `nosniff`, frame and referrer policy) on the pages. | In place (page headers after `v2-setup.sh`) |
| **Encrypted in transit (CloudFront to the API)** | CloudFront reaches the instance over plain HTTP on port 8080 (`OriginProtocolPolicy: http-only`, `infra/cloudfront-config.json`). The port only accepts CloudFront's origin-facing addresses (security group with the AWS-managed prefix list), and the traffic stays on AWS networks, but it is not TLS. | **Gap.** Fix: a TLS origin (a certificate on the instance or a load balancer) and `https-only` |
| **Encrypted at rest: S3** | Raw uploads, large stored records and Mongo backups are in the private uploads bucket (public access blocked). S3 encrypts every new object with SSE-S3 (AES-256) by default since January 2023; `infra/aws-up.sh` and `infra/v2-setup.sh` now also set the bucket default explicitly. Check: `aws s3api get-bucket-encryption --bucket leakdesk-uploads-<account>`. | In place |
| **Encrypted at rest: EBS (MongoDB data)** | MongoDB keeps its data in a Docker volume on the instance's root EBS volume. The instance was launched without `Encrypted=true`, so that volume is encrypted only if the account had "EBS encryption by default" on. `infra/aws-up.sh` now launches with `Encrypted=true`. Check: `aws ec2 describe-volumes --filters Name=attachment.instance-id,Values=<instance> --query 'Volumes[].Encrypted'`. An existing volume cannot be encrypted in place: snapshot it, copy the snapshot with encryption, and swap the volume (a few minutes of downtime). | **Gap on the current instance** unless the check says `true`; fixed for the next instance |
| **Owner isolation** | Every dataset, analysis, scenario and decision is saved under the account that made it; another account's record answers 404, never 403, so its existence is not revealed. Tests: `tests/auth.test.ts` (Cognito), `tests/oauth.test.ts` (Google/GitHub sessions: user B gets 404 on user A's analysis and dataset), `tests/account.test.ts` (export holds only the owner's records; delete leaves other owners untouched). Guests share one demo workspace (account `guest`) by design: nothing personal belongs there. | In place, tested |
| **AI sees aggregates only** | Raw order rows never leave the API. Each AI feature sends a fixed list of fields (`FIELDS_SENT` in `api/src/ai/guardlog.ts`, live at `GET /api/v1/ai/status`): narration sends a leak's `cause`, `count`, `lost_inr`, `order_ids`, the rule and its `expected_delta_inr`; Autopilot and the Fix Advisor send intervention labels, ₹ totals, observed rates (return rate, recovery, average return cost) and example order IDs; Ask Profyn sends the question and the totals of the one tool it called; the digest sends month totals, leak totals and decision labels. The column mapper sends header names and masked column shapes (type, size band, date format, text length), never a value (test: `tests/mapper.test.ts`). Customer IDs, e-mails and phone numbers are never sent; import profiles hash e-mail and phone into `customer_id` before anything is stored. | In place, tested |
| **No training on your data** | Profyn trains nothing. The AI is Google's Gemini API, and on Google's unpaid tier Google may use prompts to improve its products. So AI is **off for uploaded customer data** unless the signed-in owner turns it on (`consent.ai`, default `false`), and **on only for the synthetic demo data** (built-in samples, or files whose rows are all labelled synthetic). Moving to the paid Gemini tier, where prompts are not used for training, is the condition for ever changing that default. | In place |
| **AI off switch** | Three levels: server-wide `AI_DISABLED=1` (SSM `/leakdesk/AI_DISABLED`, the default in `infra/aws-up.sh`); per owner `PATCH /api/v1/me/consent {"ai": false}`; per request header `X-Profyn-AI: off`. With AI off every text is the deterministic template; numbers never come from the model in any case. | In place |
| **Audit log** | `GET /api/v1/me/audit`: sign-ins, imports, AI calls (feature, model, field names sent, accepted or not), decisions, exports, consent changes and saved mappings, newest first. Guests keep no log. | In place |
| **Export everything** | `GET /api/v1/me/export`: one JSON file with the account, consent, sign-ins, every dataset (with its rows), analysis, scenario, decision, saved column mapping, Autopilot run and the audit log. | In place |
| **Delete everything** | `DELETE /api/v1/me` with `{"confirm":"DELETE"}`: hard-deletes every record above from MongoDB and memory, the raw uploads and stored bodies in S3 (and the local fallback folder), and signs the browser out. Needs the instance role's `s3:DeleteObject` (added by `infra/v2-setup.sh`). | In place; see limits below |
| **Sign-in** | Google and GitHub (Authorization Code flow; the code is exchanged on the server with a signed, 10-minute `state` cookie against CSRF) or e-mail via Amazon Cognito. The session is Profyn's own HS256 token in an `httpOnly`, `Secure`, `SameSite=Lax` cookie for 7 days; no provider token is kept. Each sign-in stores the provider, user agent and `sha256(ip + server secret)`, not the IP address. Request logs never include the sign-in `code` or `state`. | In place |

## Limits of delete (stated, not hidden)

- **Backups.** `infra/mongo-backup.sh` writes hourly MongoDB dumps to `s3://leakdesk-uploads-<account>/backups/` and keeps them all. A deleted account stays in dumps taken before the delete. Fix: an S3 lifecycle rule expiring `backups/` (for example after 30 days), then say "gone from backups within 30 days".
- **Cognito.** Deleting a Profyn account does not remove an e-mail user from the Cognito user pool (that needs an admin call); signing in again starts a new, empty account.
- **Request logs.** CloudWatch keeps request lines (method, path, status, request id; no bodies, no headers, no cookies). The log group has no retention set, so they are kept indefinitely. Paths can contain record ids, not personal data.
- **Autopilot runs in memory.** Their MongoDB copies are deleted; an in-memory copy of a recent run can remain in the running process until it is evicted or the API restarts. It is unreachable once its dataset and analysis are gone.

## Checks you can run

```bash
curl -sI https://<site>/api/v1/health | grep -i strict-transport   # HSTS
curl -s  https://<site>/api/v1/health                              # "region": "ap-south-1" with S3 storage
curl -s  https://<site>/api/v1/ai/status                           # fields each AI feature sends
npm test                                                           # isolation, export, delete, masking tests
```
