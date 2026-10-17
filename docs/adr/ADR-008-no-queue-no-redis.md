# ADR-008: No queue, no Redis

- Status: Accepted
- Date: 2026-10-17
- Owner: M1 (Track 1)

## Context

Uploads are capped at 5 MB and 10,000 rows. The engine is a single pass of arithmetic per order plus grouping; the target is under 2 seconds for 10,000 rows on a laptop, and the case files have at most 28 rows. A job queue, worker process or cache would add containers, failure modes and configuration that a judge would have to start and that the team would have to explain, without changing any score.

## Decision

- Analyses, scenarios and checks run synchronously inside the HTTP request.
- No message queue, no worker, no Redis. The only stores are MongoDB (ADR-006) and local disk or S3 for files.
- Size and row caps are enforced at upload (413) so no request can exceed the synchronous budget.
- If the optional AI rewrite is enabled, it is bounded by a 6-second timeout and falls back to template text (ADR-005); it never holds the response open longer.

## Consequences

- Three containers in Docker Compose (api, web, mongo) and one process to debug.
- A request either returns the full result or a mapped error; there is no "pending" state for the UI to handle.
- If a real pilot brings files far larger than 10,000 rows, this decision is revisited with measured timings, not before.
