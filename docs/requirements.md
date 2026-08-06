# Clink Integ CLI Requirements

## Goal

Build a merchant developer CLI that lets an AI agent or independent developer integrate ClinkBill with minimal Dashboard usage.

The CLI should focus on the standard merchant integration path:

- create checkout sessions
- create products and prices for subscription flows
- create subscriptions
- simulate and verify webhook delivery locally
- run integration health checks
- generate starter integration files for common web frameworks

## User Profile

The primary user is a developer, coding agent, or solo founder who has a ClinkBill sandbox Secret Key and wants to validate a payment integration from the terminal.

The CLI is not a replacement for merchant account registration, MFA, production approval, or legal/financial confirmation.

## MVP Scope

The first release should support:

- profile and API key configuration, including `clink auth secret set` for sandbox environments where browser login is unavailable
- sandbox-first API calls
- product creation and listing
- price creation and listing
- agent-produced product catalog validation, planning, and import with local sourceId mapping
- checkout session creation with inline one-time product data
- subscription creation with existing product, price, and payment instrument IDs
- Secret Key API webhook endpoint events/list/create/update/delete/enable/disable/rotate-secret/ensure
- local webhook event simulation with Clink-compatible HMAC signing
- integration doctor checks
- smoke-test command for checkout and webhook verification
- framework starter generation for Next.js App Router, Express, and FastAPI

## Non-Goals For MVP

- production onboarding
- merchant account creation
- API key generation
- requiring browser automation for merchants that already have a sandbox Secret Key
- built-in website crawling or pricing-page scraping; agents should produce catalog JSON and the CLI should import it deterministically
- hosted webhook relay
- remote event replay
- direct replacement for the existing customer wallet CLI

## Future Scope

Future versions should add:

- event list, replay, and trigger APIs
- `clink listen` for local webhook forwarding
- OpenAPI-generated typed client
- official MCP server integration
- framework-specific code generation for Laravel, Rails, and other server stacks

## Sandbox Authentication Flow

The primary sandbox flow is Dashboard-less:

```bash
export CLINK_SECRET_KEY=sk_test_xxx
clink auth secret set --api-key env:CLINK_SECRET_KEY --env sandbox
clink auth status
```

After this, product, price, checkout, subscription, webhook endpoint management, doctor, smoke-test, and local webhook commands use the configured Secret Key. `clink login` and Dashboard Console APIs are optional fallback tools for Dashboard-only operations, not prerequisites for normal Secret Key authentication.

## Webhook Endpoint Flow

Webhook endpoint management uses the public Secret Key API. Agents should prefer the top-level endpoint commands:

```bash
clink webhook endpoint events --json
clink webhook endpoint ensure --url https://your-public-host.example.com/api/clink/webhook --events commerce --save-secret --json
clink webhook endpoint list --json
```

`dashboard webhook` is a compatibility alias for older scripts, but it no longer requires a Dashboard Console token for endpoint management. The Secret Key selects the current merchant. Request bodies use webhook event names, not Dashboard numeric event codes. Event selections are resolved from runtime `GET /webhook/events`; `commerce` is the complete checkout/subscription/dispute/payment-method preset, while `core` remains a deliberately incomplete six-event compatibility preset.

## Catalog Import Flow

Website scanning is an agent responsibility. The CLI accepts the agent output as catalog JSON, validates it, shows a deterministic plan, and imports products and prices through the official Product API:

```bash
clink catalog validate --file ./clink-catalog.json --json
clink catalog plan --file ./clink-catalog.json --mapping-file ./.clink/catalog-map.json --json
clink catalog import --file ./clink-catalog.json --mapping-file ./.clink/catalog-map.json --json
```

Each catalog product and price must include a stable `sourceId`. The CLI stores those source IDs in a mapping file so repeated imports can skip existing products/prices instead of creating duplicates.

