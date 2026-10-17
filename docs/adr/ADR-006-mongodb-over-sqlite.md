# ADR-006: MongoDB over SQLite

- Status: Accepted
- Date: 2026-10-17
- Owner: M1 (Track 1)

## Context

The product stores datasets (raw rows and flags), analyses (computed orders, groups, leaks, reconciliation), scenarios and decisions. A decision must carry the full assumption snapshot it was made under (mode, period end, config, overrides, engine version) so it can be re-run later. These are nested documents read and written whole; there are no joins and no reporting queries across records. SQLite would need the nested parts stored as JSON text or split across many tables. The host company lists MongoDB in its stack.

## Decision

- Use MongoDB 7 through Mongoose, with one collection each for datasets, analyses, scenarios and decisions, indexed on creation or save time and on the parent id.
- Run Mongo as a container in Docker Compose locally and on the EC2 instance.
- When `MONGO_URL` is empty, the API uses an in-memory store so the product runs with Node alone. `/health` then reports `db: "memory"` and responses carry `persisted: false`.
- When Mongo is configured but down, analyses are still computed and returned with `persisted: false`, decisions cannot be saved and say so, and `/health` returns 503.

## Consequences

- An analysis or decision is stored in the same shape the API returns, so export and re-run need no mapping.
- No schema migrations during the event; Mongoose models in `api/src/models/` document the shape.
- The in-memory fallback keeps a Node-only demo working, but its decisions are lost on restart. The UI shows "Not saved to the database — results are in memory only."
- Cross-record reporting (for example, contribution trends across months) would need aggregation pipelines later; nothing in the current scope needs it.
