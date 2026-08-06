---
name: clink-integ-cli
description: Use this skill when developing, testing, or extending the ClinkBill merchant developer CLI for checkout, subscriptions, products, prices, webhooks, doctor checks, and AI-friendly integration workflows.
---

# clink-integ-cli

This repository builds a merchant developer CLI for ClinkBill integrations.

Use this skill when the user asks to:

- add or change a `clink` CLI command
- improve AI-assisted ClinkBill integration workflows
- add checkout, product, price, subscription, webhook, doctor, or smoke-test behavior
- design Dashboard-light or Dashboard-less merchant developer flows
- generate framework starters for Next.js, Express, FastAPI, Laravel, or similar stacks
- improve tests, exit codes, JSON output, or command docs

## Operating Rules

- Keep the CLI API-first and sandbox-first.
- Prefer stable command flags and machine-readable JSON over interactive flows.
- Every command that returns useful data should support `--json`.
- Resolve webhook endpoint events from the selected environment's `GET /webhook/events` response; do not treat a build-time event enum as authoritative.
- Treat `webhook endpoint ensure` event updates as safe merges by default. Preserve existing events, require `--allow-remove-events` for explicit replacement, show added/removed/unchanged before dangerous writes, and verify the post-write event set.
- Keep webhook signature verification on the untouched raw body before parsing or normalizing fixture formats.
- Reject malformed or stale webhook signature timestamps before parsing. Generated handlers use the shared 300-second tolerance and still require durable `event.id` deduplication inside that window.
- Keep `merchant-webhook` as the default fixture profile and the flattened `legacy` profile explicit and deprecated. Merchant Webhooks and Agent Customer Callbacks are separate contracts.
- Keep `core` fixed at its compatibility set of 6 events; recommend the stable 31-event `commerce` preset for complete charging integrations and resolve every selection against the runtime catalog.
- Treat fixtures and signed simulations as local test inputs, never as evidence of a real Clink server event or completed sandbox acceptance.
- Regenerate `src/openapi/clink.openapi.ts` with `npm run openapi:refresh`; never edit it manually. Keep canonical Merchant Webhook serialization contracts in `src/webhook/contracts.ts` when the public OpenAPI resource schema is incomplete.
- Do not hardcode real Secret Keys or webhook signing keys.
- Resolve authenticated API request paths through the shared safe URL resolver. A command path must not replace the configured origin or escape its API base pathname.
- Prefer `env:CLINK_SECRET_KEY` and `env:CLINK_WEBHOOK_SIGNING_KEY` references for stored profiles.
- Write CLI profiles and env files containing secrets atomically as private files; POSIX targets must end at mode `0600` even when an existing file was more permissive.
- Never print unmasked secrets in normal output.
- Generated public checkout and subscription routes must select server-authoritative price or plan allowlists. Do not trust browser-supplied amounts, product/price IDs, merchant references, redirect URLs, or payment settings; this rule does not restrict trusted local CLI commands.
- Keep `Commander` as the core command router unless the user explicitly requests a different shell framework.
- Do not add Ink to core commands. If interactive UI is needed, add a separate `wizard` command later.
- Do not use OpenCLI as a core dependency. Treat browser/Dashboard automation as an optional experiment.

## Current Architecture

- `src/index.ts`: CLI entrypoint and global flags
- `src/commands/`: command modules
- `src/api/client.ts`: Clink REST client
- `src/config.ts`: local profile and environment resolution
- `src/webhook/`: signing and fixture helpers
- `src/webhook/contracts.ts`: canonical production Merchant Webhook envelope and resource serialization types
- `src/openapi/clink.openapi.ts`: generated public OpenAPI types; machine-owned
- `docs/requirements.md`: product requirements
- `docs/roadmap.md`: implementation roadmap
- `docs/agent-workflow.md`: parallel agent task plan

## Quality Bar

Before finishing a change:

1. Run `npm run check`.
2. Run `npm run build`.
3. Smoke-test relevant commands with `--json` or `--dry-run`.
4. Confirm no real secrets were added to files, logs, docs, or examples.
5. Keep README/docs updated when command flags change.

## Suggested Work Order

For new command work:

1. Add or update command module under `src/commands/`.
2. Reuse `getCommandContext()` and `ClinkApiClient`.
3. Add JSON output first, then human output.
4. Add dry-run support for API writes through the shared client.
5. Update README examples.
6. Update docs if the command changes project workflow.
