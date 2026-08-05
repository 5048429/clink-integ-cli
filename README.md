# clink-integ-cli

Merchant developer CLI for ClinkBill integrations.

This CLI is designed for AI-assisted and Dashboard-light integration workflows. It helps developers create Clink checkout sessions, manage products and prices, create subscriptions, simulate signed webhooks locally, and run integration health checks.

## Quick Links

- [CLI 使用文档](docs/cli-usage.zh-CN.md)
- [AI 自动接入官网与 Developers 更新 PRD](docs/ai-integration-website-developers-prd.zh-CN.md)
- [Agent CLI install guide](docs/agent-cli-install.zh-CN.md)
- [Requirements](docs/requirements.md)

## Install

For coding agents, sandboxes, CI, and low-code runtimes, install the CLI into a project-local tools directory. This avoids global npm permission issues and stale global directory file locks:

```bash
npm install --prefix ./.clink-tools github:5048429/clink-integ-cli
./.clink-tools/node_modules/.bin/clink --help
./.clink-tools/node_modules/.bin/clink-integ --help
```

On Windows PowerShell, the local binary path is:

```powershell
.\.clink-tools\node_modules\.bin\clink.cmd --help
.\.clink-tools\node_modules\.bin\clink-integ.cmd --help
```

Global install is still fine for a developer machine where global npm installs are known to work:

```bash
npm install -g --install-links=true github:5048429/clink-integ-cli
clink --help
clink-integ --help
```

The `--install-links=true` flag avoids broken global junctions that some npm versions create for Git dependencies on Windows.

GitHub installs expose the package as `clink-integ-cli` and install the `clink`, `clink-integ`, and backward-compatible `clink-dev` binaries.

Git URL installs use the committed `dist/` package output and do not require the target project to compile TypeScript or install Node type declarations. The install-time `prepare` hook only verifies that `dist/` is present.

During CLI development in this repository:

```bash
npm install
npm run build
npm link
clink --help
```

Run without linking when debugging source changes:

```bash
npm run dev -- --help
```

Validate changes before handoff:

```bash
npm run verify
npm run pack:dry-run
```

## Configure

### Environments (Request Domains)

Built-in environments are `sandbox` (default, `https://uat-api.clinkbill.com/api/`) and `production` (`https://api.clinkbill.com/api/`). You can define additional named environments locally without changing code. Each environment switches both the Clink API base URL and the Dashboard Console addresses (Dashboard API, login URL, ClientID):

```bash
clink env add staging \
  --api-base-url https://staging-api.clinkbill.com/api/ \
  --dashboard-base-url https://staging-dashboard.clinkbill.com/prod-api/ \
  --dashboard-login-url https://staging-dashboard.clinkbill.com/auth/login \
  --dashboard-client-id <client-id>

clink env list
clink env show staging
clink --env staging auth status
clink env remove staging
```

Custom environments are stored in `~/.clink-integ-cli/config.json` under `environments`. Built-in names cannot be removed, and overriding a built-in name requires `--force`. The active environment is selected with `--env <name>`, the `CLINK_ENV` variable, or the saved profile; `--base-url` and `CLINK_BASE_URL` still override the resolved API base URL for one-off use.

### Sandbox Without Browser

If you already have a ClinkBill sandbox Secret Key, you do not need `clink login` or Playwright for official public API work. Store the key in the CLI profile and all public API commands will authenticate with `X-API-KEY`:

```bash
export CLINK_SECRET_KEY=sk_test_xxx

clink auth secret set --api-key env:CLINK_SECRET_KEY --env sandbox
clink auth status
```

You can also pass a literal key when an environment variable is not available:

```bash
clink auth secret set --api-key sk_test_xxx --env sandbox
```

Literal keys are stored in the local profile file, so `env:CLINK_SECRET_KEY` is still preferred for shared machines, CI logs, and AI-agent workflows. CLI output masks Secret Keys by default.

Sandbox is the default environment and maps to:

```text
https://uat-api.clinkbill.com/api/
```

Webhook signing keys are configured separately because they are used only for local webhook signing and verification:

```bash
export CLINK_WEBHOOK_SIGNING_KEY=whsec_xxx
clink auth set --webhook-secret env:CLINK_WEBHOOK_SIGNING_KEY --env sandbox
```

### Dashboard Console Login

Use `clink login` only when a workflow needs the UAT Dashboard Console identity, for example resolving a Secret Key from a logged-in Dashboard session. It is optional for product, price, checkout, subscription, order, refund, payment, billing portal, webhook endpoint management, `api request`, doctor, smoke-test, and local webhook commands when a Secret Key is already configured:

```bash
clink login
clink dashboard whoami
clink dashboard whoami --json
```

`clink login` opens `https://uat-dashboard.clinkbill.com/auth/login` with Playwright. The CLI does not type credentials, bypass MFA, or solve CAPTCHA. After you finish login in the browser, it captures the Dashboard `/platform/user/getInfo` request headers, verifies the identity with:

```http
GET https://uat-dashboard.clinkbill.com/prod-api/platform/user/getInfo
Authorization: Bearer <token>
ClientID: <clientId>
Accept-Language: zh_CN
Content-Language: zh_CN
```

Then it saves the Dashboard base URL, ClientID, access token, and a user summary in the selected local profile. CLI output always masks the access token. `clink dashboard whoami --dry-run --json` prints the request metadata with `Authorization: Bearer [masked]`.

By default `clink login` tries an installed Chrome or Edge browser before falling back to Playwright's bundled Chromium. You can force a channel when debugging:

```bash
clink login --browser-channel chrome
clink login --browser-channel msedge
```

After login, you may resolve the current UAT Dashboard Secret Key and save it for Clink API calls. This is a fallback for Dashboard-assisted validation, not required when you manually configured a Secret Key with `clink auth secret set`:

```bash
clink dashboard apikey list --json
clink dashboard apikey ensure-secret --save --json
```

`dashboard apikey ensure-secret` first calls the Dashboard API key list endpoint. If a Secret Key already exists, it uses that key. If no Secret Key exists, it initializes the Dashboard standard Publishable Key and Secret Key pair. Secret values are masked by default; pass `--show-secret` only when you intentionally need the raw value in the terminal.

### Webhook Endpoint Setup

Webhook endpoint management uses the Secret Key API and does not require `clink login` or Playwright. The top-level command is `clink webhook endpoint ...`; `clink dashboard webhook ...` remains as a compatibility alias for older scripts, but it also uses `X-API-KEY` now.

```bash
clink webhook endpoint events --json
clink webhook endpoint list --json

clink webhook endpoint ensure \
  --url https://your-public-host.example.com/api/clink/webhook \
  --events commerce \
  --save-secret \
  --sync-env-file .env.local \
  --json

clink webhook endpoint update whk_xxx \
  --url https://new-public-host.example.com/api/clink/webhook \
  --events commerce

clink webhook endpoint enable whk_xxx
clink webhook endpoint disable whk_xxx
clink webhook endpoint rotate-secret whk_xxx --save-secret --json
```

`webhook endpoint ensure` creates or updates the endpoint by URL. Its default event behavior is a **safe merge**: existing subscriptions are preserved and the resolved events are added. If the endpoint-list summary omits its event set, the CLI reads endpoint detail and fails closed when events still cannot be determined. Pass `--allow-remove-events` only when you explicitly want replacement semantics; a dangerous replacement prints `added`, `removed`, `unchanged`, and the final event set before PUT, and interactive use asks for confirmation. After PUT, the CLI reads the endpoint back and exits non-zero unless the final event set exactly matches the computed merge or replacement target.

Created and updated endpoints are enabled by default; pass `--disabled` only when you intentionally want to leave one disabled. Use `webhook endpoint update <endpoint-id>` when a local tunnel URL changes and you want to reuse an existing endpoint record instead of creating another one.

`--save-secret` stores the returned signing secret in the current local profile for `clink webhook simulate/sign/verify`. `--sync-env-file <path>` atomically writes or updates `CLINK_WEBHOOK_SIGNING_KEY` in a local env file after the plaintext signing secret is resolved; local destinations are checked before PUT, and profile/env updates are rolled back when a later write races or fails. Add `--restart-command "<command>"` together with `--sync-env-file` when you want the CLI to restart a local server after writing the file; the restart completes before endpoint read-back, and captured restart output is redacted before it reaches JSON or terminal output. For existing endpoints, Clink cannot return the old plaintext secret; when `--save-secret`, `--show-secret`, or `--sync-env-file` is used, `ensure` requests the plaintext secret and automatically asks the API to rotate it if the old secret is unavailable. `--show-secret` prints the raw value only when you explicitly ask for it. API requests abort after 30 seconds by default; use `--timeout-ms` or `CLINK_API_TIMEOUT_MS` for a different positive limit.

Webhook endpoint URLs must start with `https://` and cannot use localhost, loopback, private, link-local, or multicast hosts. Public API request bodies use event names, not Dashboard numeric event codes. Every event selection is validated against the runtime `GET /webhook/events` response; missing preset events fail instead of being silently removed.

Available presets can be combined and are de-duplicated:

- `core`: the compatibility set of exactly 6 events: `session.complete`, `order.succeeded`, `order.failed`, `refund.succeeded`, `subscription.created`, and `invoice.paid`. It is **not** a complete subscription preset and omits the full subscription lifecycle, dunning, cancellation, disputes/chargebacks, `refund.failed`, and `session.expired`.
- `checkout`: 9 session, order, and refund events.
- `subscriptions`: 14 events covering 11 subscription lifecycle events plus `invoice.open`, `invoice.paid`, and `invoice.void`.
- `disputes`: 5 dispute lifecycle events.
- `payment-methods`: the stable set of 3 currently public payment-method events.
- `commerce`: the checkout, subscriptions, disputes, and payment-methods union; 31 events in the current 44-event catalog.
- `all`: every event returned by the current runtime catalog.

If a newer runtime publishes `payment_method.deleted`, it is available through an explicit event name and through `all`; stable `payment-methods` and `commerce` do not silently grow.

Example composition: `--events checkout,subscriptions,disputes,payment-methods`.

## MVP Commands

```bash
export CLINK_SECRET_KEY=sk_test_xxx
clink auth secret set --api-key env:CLINK_SECRET_KEY --env sandbox
clink auth status

clink product create --name "Starter" --image-id oss_xxx --tax-category software_service --amount 9.99 --currency USD --type recurring --interval month --default
clink product list

clink catalog validate --file ./clink-catalog.json --project-root . --public-dir public --json
clink catalog plan --file ./clink-catalog.json --mapping-file ./.clink/catalog-map.json --project-root . --public-dir public --json
clink catalog import --file ./clink-catalog.json --mapping-file ./.clink/catalog-map.json --project-root . --public-dir public --json

clink price create --product-id prd_xxx --amount 9.99 --currency USD --type recurring --interval month
clink price list --product-id prd_xxx

clink checkout create --customer-email test@example.com --amount 19.99 --currency USD --name "Test Product" --success-url http://localhost:3000/success --cancel-url http://localhost:3000/cancel
clink checkout create --customer-email test@example.com --amount 9.99 --currency USD --product-id prd_xxx --price-id price_xxx --success-url http://localhost:3000/success --cancel-url http://localhost:3000/cancel
clink checkout get sess_xxx

clink subscription create --customer-email test@example.com --product-id prd_xxx --price-id price_xxx --payment-instrument-id pi_xxx --payment-method-type CARD --payment-currency USD --return-url http://localhost:3000/account
clink subscription get sub_xxx
clink subscription cancel sub_xxx --reason "No longer needed"

clink order list --page 1 --page-size 20
clink order get order_xxx

clink refund create --order-id order_xxx --refund-merchant-order-id refund_merchant_xxx --amount 9.99
clink refund get rfd_xxx

clink billing portal-session --customer-id cus_xxx --return-url https://your-site.com/account

clink payment create --data '{"customerEmail":"test@example.com","paymentInstrumentId":"pi_xxx","paymentMethodType":"CARD","amount":9.99,"currency":"USD","returnUrl":"https://your-site.com/payment/return"}'
clink payment instrument create --data '{"customerEmail":"test@example.com","paymentInstrumentType":"GCASH"}'

clink api request GET /order --query pageNum=1 --query pageSize=20
clink api request POST /refund --data '{"orderId":"order_xxx","refundMerchantOrderId":"refund_merchant_xxx","refundAmount":9.99}'

clink webhook endpoint ensure --url https://your-public-host.example.com/api/clink/webhook --events commerce --save-secret --sync-env-file .env.local --json
clink webhook simulate order.succeeded --secret env:CLINK_WEBHOOK_SIGNING_KEY --forward-to http://localhost:3000/api/clink/webhook

clink doctor
clink smoke-test
```

`smoke-test` can create a checkout session and send a signed simulated webhook, but webhook HTTP 200 is not the real-payment finish line. After opening a real sandbox `checkoutUrl`, verify the local merchant order matched by both `merchantReferenceId` and `sessionId` is paid/completed, then verify entitlement, credits, shipment, download access, or other fulfillment is complete.

Dashboard-assisted Secret Key discovery remains available when needed:

```bash
clink login
clink dashboard whoami
clink dashboard apikey ensure-secret --save
```

`clink dashboard webhook ensure --url https://your-public-host.example.com/api/clink/webhook --events core --save-secret` is kept for compatibility and uses the same Secret Key API as `clink webhook endpoint ensure`.

`product create --json` promotes the useful IDs to the top level so agents do not need to dig through the raw API response:

```json
{
  "productId": "prd_xxx",
  "defaultPrice": "price_xxx",
  "initialPriceId": "price_xxx",
  "checkoutCommand": "clink checkout create ..."
}
```

## Product Catalog Import

Agents should scan the merchant site, source code, CMS data, or pricing page and write a deterministic catalog file. The CLI does not crawl websites directly; it validates the catalog, plans changes, creates Clink products and prices, and stores a local source-to-Clink mapping to avoid duplicate imports.

```json
{
  "version": 1,
  "source": {
    "site": "https://merchant.example/pricing"
  },
  "products": [
    {
      "sourceId": "starter-plan",
      "name": "Starter",
      "description": "Starter subscription plan",
      "imageFile": "public/images/starter.png",
      "taxCategory": "software_service",
      "prices": [
        {
          "sourceId": "starter-monthly",
          "type": "recurring",
          "amount": 9.99,
          "currency": "USD",
          "interval": "month",
          "intervalCount": 1,
          "default": true
        },
        {
          "sourceId": "starter-yearly",
          "type": "recurring",
          "amount": 99.99,
          "currency": "USD",
          "interval": "year",
          "intervalCount": 1
        }
      ]
    }
  ]
}
```

Use `sourceId` values from the scanned site, route, SKU, CMS ID, or generated slug. They must stay stable across runs because the mapping file stores `sourceId -> productId/priceId`.

Each product must provide exactly one image source:

- `imageId`: an existing Clink OSS image ID.
- `imageUrl`: a public HTTP(S) image URL; the CLI downloads, validates, uploads, and caches it.
- `imageFile`: a local image path resolved relative to `clink-catalog.json`; pass `--project-root` and `--public-dir` to also resolve project/public assets such as `/images/starter.png`.

`catalog validate` checks that product images exist, are valid `jpg/jpeg/png/gif/webp` images, and are at most 5 MB. URL strings are rejected when placed in `imageId`; use `imageUrl` instead. `catalog plan` reports which images will be uploaded, reused from the sha256 cache, or skipped because an OSS ID/product mapping already exists. `catalog import` uploads `imageUrl` and `imageFile` assets to `/product/image/upload`, uses the returned `ossId` when creating the product, and stores `sha256 -> ossId` in the catalog mapping file to avoid duplicate uploads.

```bash
clink catalog validate --file ./clink-catalog.json --project-root . --public-dir public --json
clink catalog plan --file ./clink-catalog.json --mapping-file ./.clink/catalog-map.json --project-root . --public-dir public --json
clink catalog import --file ./clink-catalog.json --mapping-file ./.clink/catalog-map.json --project-root . --public-dir public --json
```

Pass `--dry-run` before `catalog import` to inspect the Product API request bodies without writing Clink data or the mapping file:

```bash
clink --dry-run --json catalog import --file ./clink-catalog.json
```

If scanned products do not have uploaded Clink image OSS IDs yet, prefer `imageUrl` or `imageFile` so the CLI can upload them automatically. Use `--default-image-id oss_xxx` only as a deliberate fallback placeholder.

## Checkout Sessions

Checkout is the payment entry point. The CLI supports both price sources from the official quickstart.
Under the current API contract, both registered-product and inline checkout require `--amount` and `--currency`; registered IDs do not make those options optional.

Use an existing Dashboard product and price:

```bash
clink checkout create \
  --customer-email buyer@example.com \
  --amount 10 \
  --currency USD \
  --product-id prd_xxx \
  --price-id price_xxx \
  --success-url https://your-site.com/success \
  --cancel-url https://your-site.com/cancel \
  --json
```

Use inline price data for a one-time order:

```bash
clink checkout create \
  --customer-email buyer@example.com \
  --amount 10 \
  --currency USD \
  --name "A One-time purchase" \
  --quantity 1 \
  --success-url https://your-site.com/success \
  --cancel-url https://your-site.com/cancel \
  --json
```

For inline price data, `--amount` must equal `--unit-amount * --quantity`. If `--unit-amount` is omitted, the CLI uses `amount / quantity`. Add `--open` to open the hosted checkout URL after creation.

## Framework Starters

Generate starter integration files for common server frameworks:

```bash
clink init --framework nextjs --out ./tmp-next --force --json
clink init --framework express --out ./tmp-express --force --json
clink init --framework fastapi --out ./tmp-fastapi --force --json
```

Each starter includes checkout, subscription, and raw-body webhook examples, plus `.env.example`, curl examples, and integration docs. Generated handlers verify the untouched raw body before parsing, normalize canonical and legacy envelopes, emit a safe warning metric for legacy payloads, and return non-2xx for unknown payloads or events. Secrets are read from environment variables such as `CLINK_SECRET_KEY` and `CLINK_WEBHOOK_SIGNING_KEY`.

## Local Webhook Development

The webhook tools do not require Dashboard setup or live Clink API access. Use a local signing key such as `env:CLINK_WEBHOOK_SIGNING_KEY` or a throwaway value like `test_secret`.

Generate a stable fixture:

```bash
clink webhook fixture invoice.paid --json
clink webhook fixture invoice.paid --out ./fixtures/invoice-paid.json --json
```

Without `--out`, `--json` prints the generated fixture in the command result. `--out` remains available when a stable fixture file is needed.

The default `merchant-webhook` fixture profile uses the production Merchant Webhook envelope: an `event_` ID, `object: "event"`, Unix-millisecond `created`, and the complete resource under object-valued `data.object`. Invoice resources use `items`, never `lineItems`. The old flattened format is available only through explicit `--fixture-profile legacy` for compatibility with old tests; it is deprecated and prints a warning.

Merchant Webhooks and Agent Customer Callbacks are separate contracts. This release does not reinterpret subscription or invoice events as flattened Agent Callback payloads and does not provide an `agent-callback` fixture profile.

Sign the exact raw file contents:

```bash
clink webhook sign --body-file ./fixtures/invoice-paid.json --secret env:CLINK_WEBHOOK_SIGNING_KEY --json
```

Verify the raw file contents, timestamp, and signature before accepting a local webhook:

```bash
clink webhook verify --body-file ./fixtures/invoice-paid.json --secret env:CLINK_WEBHOOK_SIGNING_KEY --timestamp <timestamp-from-sign> --signature <signature-from-sign> --tolerance-seconds 300 --json
```

`clink webhook verify` rejects timestamps outside the tolerance window. The default tolerance is 300 seconds. The signature is HMAC SHA-256 over:

```text
X-Clink-Timestamp + "." + rawBody
```

Supported fixtures:

```text
session.complete
session.expired
order.created
order.next_action
order.succeeded
order.failed
refund.created
refund.succeeded
refund.failed
subscription.created
subscription.trialing
subscription.activated
subscription.incomplete_expired
subscription.past_due
subscription.cancelled
subscription.updated.plan_changed
subscription.updated.plan_change_canceled
subscription.updated.renewed
subscription.updated.cancel_at_period_end_set
subscription.updated.cancel_at_period_end_revoked
invoice.open
invoice.paid
invoice.void
dispute.created
dispute.updated
dispute.won
dispute.lost
dispute.closed
payment_method.added
payment_method.default_change
payment_method.update
```

These 31 fixtures cover the stable `commerce` preset. They are deterministic local simulations for handler and routing tests; they are not evidence that Clink emitted the corresponding server event. This release-candidate work has not completed real sandbox parity for `order.failed`, `refund.succeeded`, `subscription.past_due`, `invoice.void`, or provider-generated `dispute.created`.

## Webhook Type Contracts

`src/openapi/clink.openapi.ts` is generated by `npm run openapi:refresh` from the current public OpenAPI document and must not be edited by hand. It describes the published API surface, including the object-valued webhook envelope, and remains the source for REST request and response types.

The public OpenAPI resource schemas can lag production serialization for nullable fields and decimal-string amounts. The exported Merchant Webhook aliases therefore use the hand-maintained canonical envelope and resource contracts in `src/webhook/contracts.ts`; invoice and subscription webhook objects use those production-serialization types. Generated OpenAPI resource DTOs may still be reused for other webhook resources, but generated event envelopes are not the authoritative Merchant Webhook contract.

## AI-Friendly Output

All commands accept `--json` so coding agents can parse results reliably:

```bash
clink checkout create ... --json
```

## Project Docs

- [v0.2.0 release candidate notes](docs/releases/v0.2.0.md)
- [CLI 使用文档](docs/cli-usage.zh-CN.md)
- [AI 自动接入官网与 Developers 更新 PRD](docs/ai-integration-website-developers-prd.zh-CN.md)
- [Requirements](docs/requirements.md)
- [Agent CLI install guide](docs/agent-cli-install.zh-CN.md)
- [CLI 更新与发布操作指南](docs/cli-release-runbook.zh-CN.md)
- [中文需求说明](docs/requirements.zh-CN.md)
- [产品需求文档](docs/product-requirements.zh-CN.md)
- [最小 MVP：AI 生成 UAT Secret Key 并接入支付](docs/mvp-agent-secret-key-api.zh-CN.md)
- [Roadmap](docs/roadmap.md)
- [Agent workflow](docs/agent-workflow.md)
- [Exit codes](docs/exit-codes.md)
- [OpenAPI types](docs/openapi-client.md)

## Agent Skill

This repository includes `SKILL.md` so compatible coding agents can understand the CLI architecture, safety rules, and quality bar before modifying the project.
