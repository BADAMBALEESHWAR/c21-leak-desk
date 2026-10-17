# Architecture decision records

One page each. Status, date, context, decision and consequences. A decision is changed by writing a new record that supersedes the old one, never by editing the old one. A business-rule change also bumps the engine version and updates `data/expected.json` (see `docs/RULES.md`).

| ADR | Decision | Reason in one line | Status | Date |
|---|---|---|---|---|
| [ADR-001](ADR-001-express-over-fastapi.md) | Express over FastAPI | The host company's backend is Node and TypeScript; one language for four people | Accepted | 2026-10-17 |
| [ADR-002](ADR-002-pure-engine-functions.md) | Pure engine functions, no I/O | Determinism, testability, reuse in scenarios and `/checks` | Accepted | 2026-10-17 |
| [ADR-003](ADR-003-channel-spend-equals-allocated-ads.md) | Channel spend = Σ allocated ads per channel | Makes "never both deducted" visible with equal grand totals | Accepted | 2026-10-17 |
| [ADR-004](ADR-004-null-means-unknown.md) | null → unknown status, not zero | The pack's rule; protects check 3 and every total | Accepted | 2026-10-17 |
| [ADR-005](ADR-005-ai-narrates-only.md) | AI only rewords; template fallback is mandatory | The pack accepts a declared fallback; free-tier quota is unreliable on stage | Accepted | 2026-10-17 |
| [ADR-006](ADR-006-mongodb-over-sqlite.md) | MongoDB over SQLite | Host company stack; document shape fits per-analysis snapshots | Accepted | 2026-10-17 |
| [ADR-007](ADR-007-local-first-aws-second.md) | Local first, AWS second | A cloud outage must never block the three checks | Accepted | 2026-10-17 |
| [ADR-008](ADR-008-no-queue-no-redis.md) | No queue, no Redis | Analysis finishes well inside a request; extra moving parts would not score | Accepted | 2026-10-17 |
