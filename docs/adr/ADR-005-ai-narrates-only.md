# ADR-005: AI only rewords; template fallback is mandatory

- Status: Accepted
- Date: 2026-10-17
- Owner: M3 (Track 3)

## Context

The product explains each leak group and each recommendation in plain English. A language model could make that text read better, but it can also invent numbers, order IDs or causal claims, and a free-tier quota can run out during the demo. The pack accepts a declared text or mock fallback. The rubric scores correct numbers and reliability, not the presence of AI.

## Decision

- Every "why" sentence, 30-day test and stop rule is first rendered from a deterministic Handlebars template (`api/src/ai/templates.ts`) from numbers the engine already computed. This text is always correct on its own and is labelled `why_source: "template"`.
- An optional rewrite by a hosted language model may replace that text only after it passes the guards: the response matches the output schema; every rupee figure and digit in it appears in the input; no banned words (profit, margin, caused, drove sales); it arrives within 6 seconds. Any failure keeps the template text. A rewrite is labelled `"ai"`.
- The AI may not compute or change numbers, choose or rank the recommendation, classify leaks, invent order IDs, or claim that advertising caused sales.
- The AI is off by default (`AI_DISABLED=1` in `.env.example` and in Docker Compose). The model key lives only on the server.

## Consequences

- The whole journey and all three checks work with AI disabled; the demo is rehearsed that way.
- Turning AI on can change wording, never a rupee value, a ranking or a confidence label.
- `/health` reports `ai: "disabled"` or `"ok"`; the UI shows a template or AI tag beside each explanation.
- The adapter (`api/src/ai/client.ts`, with timeout, cache and call caps) and its guard tests (`tests/ai-guard.test.ts`) were added at snapshot time and have not been run against a live key (`docs/SNAPSHOT.md`, known gaps).
