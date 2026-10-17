# ADR-002: Pure engine functions, no I/O

- Status: Accepted
- Date: 2026-10-17
- Owner: M1 (Track 1)

## Context

Three public checks are worth 25 of the engineering points, and a judge will change one input and expect the same rule to hold. The same contribution logic is needed in five places: the ledger, reconciliation, leak grouping, scenarios (which recompute a copy of the data) and the `/checks` endpoint. If money were computed in route handlers or in the browser, those places could drift apart, and a test could pass while the screen showed a different number.

## Decision

Every rupee is computed by pure TypeScript functions in `api/src/engine/` (`contribution.ts`, `validate.ts`, `reconcile.ts`, `leaks.ts`, `scenario.ts`, `analyze.ts`).

- No imports from Express, Mongoose, the file system or any AI client.
- Every function takes its inputs, mode and config explicitly; there is no module-level state.
- The engine version is stamped on every analysis and decision.
- Routes only parse, call the engine, persist and respond. The web app and the Markdown export only format what the engine returns.

## Consequences

- Identical input and engine version give identical output on every machine, which is what makes `npm run check` reproducible.
- Unit tests call the engine directly on the fixture, the extended file and the negative-test files, with no server or database.
- A scenario is a recomputation on a deep copy, never a patch of stored numbers.
- Reconciliation sums the same computed rows the ledger renders, so the badge and the table cannot disagree.
- Any rule change touches one folder, bumps the engine version and updates `data/expected.json` (see `docs/RULES.md`).
- Narrative text (templates, and the optional AI rewrite) sits outside the engine and receives numbers; it never produces them (ADR-005).
