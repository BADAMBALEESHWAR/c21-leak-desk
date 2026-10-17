# ADR-001: Express over FastAPI

- Status: Accepted
- Date: 2026-10-17
- Owner: M1 (Track 1)

## Context

An earlier plan (v3) named FastAPI for the API while the web app was planned in React and TypeScript. That meant two languages, two sets of types for the same order schema, and two test runners for a four-person team with 15 build hours. The host company's backend stack is Node and TypeScript, and the MBA team and judges will read the code after the event.

The API's job is narrow: parse JSON or CSV, validate it, call the engine, store results and return JSON. No part of it needs a Python-only library.

## Decision

Build the API in Node 20 with Express 4 and TypeScript. Validate requests and order rows with Zod. Log with pino. Test with Vitest and supertest from the repository root.

## Consequences

- One language across `api/`, `web/` and `tests/`. The web client's types mirror the engine's types in `api/src/engine/types.ts`.
- The engine can be imported directly by tests and by the `/checks` route, with no process boundary (ADR-002).
- `npm run setup` installs everything; `npm test` runs every suite from one place.
- The team gives up FastAPI's generated OpenAPI page. `docs/API.md` is kept by hand and checked against the Zod schemas in `api/src/schema/orders.ts`.
- Anyone extending the product needs Node 20 or later, or Docker.
