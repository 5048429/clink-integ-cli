# Dashboard Automation Research

Date: 2026-06-17

Status: legacy research note. Current `clink-integ-cli` webhook endpoint management uses the Secret Key API through `clink webhook endpoint ensure`. New agent integrations must not follow the manual webhook signing-key copy flow below unless the target platform has no agent-accessible Secret write capability. For complete cloud-hosted, low-code, cloud IDE, and sandbox payment integrations, prefer `clink webhook endpoint ensure --events commerce --save-secret --show-secret --json`, then write the returned signing secret into backend/platform Secret `CLINK_WEBHOOK_SIGNING_KEY` and redeploy.

## Recommendation

Recommendation: **defer**.

Do not add OpenCLI to `package.json`, do not ship production browser automation, and do not build a first-party `clink` Dashboard adapter now. The API gap is real, especially for API key setup and webhook endpoint registration, but the remaining Dashboard-only work is security-sensitive, often one-time, and not stable enough to justify production automation in the merchant CLI.

The best next step is to keep `clink-integ-cli` API-first and add public API commands where the ClinkBill API already exists. If browser automation is still needed after repeated sandbox onboarding pain, build it as an external experimental OpenCLI plugin with human review gates, not as a core dependency.

## Sources Reviewed

- Project docs: `README.md`, `SKILL.md`, `docs/requirements.md`, `docs/roadmap.md`, `docs/agent-workflow.md`
- Current CLI source under `src/commands` and `src/api/client.ts`
- ClinkBill public docs:
  - https://docs.clinkbill.com/integration
  - https://docs.clinkbill.com/api-reference/introduction
  - https://docs.clinkbill.com/api-reference/openapi.json
  - https://docs.clinkbill.com/api-reference/clink_cli
  - https://docs.clinkbill.com/guides/account/merchant
  - https://docs.clinkbill.com/guides/account/user
  - https://docs.clinkbill.com/guides/resources/product
  - https://docs.clinkbill.com/guides/payments/link_psp
  - https://docs.clinkbill.com/finance/balance
  - https://docs.clinkbill.com/finance/payout
- OpenCLI:
  - https://github.com/jackwener/opencli
  - https://github.com/jackwener/opencli/blob/main/PRIVACY.md

## Current Public API And CLI Coverage

The current `clink-integ-cli` already supports:

- local auth profiles for existing Secret Keys and webhook signing keys
- product image upload, product create, product list
- price create and price list
- checkout session create
- subscription create with an existing payment instrument
- local webhook simulate, sign, and verify
- `doctor`, `smoke-test`, and `init`
- global `--json`, `--dry-run`, `--env`, `--base-url`, `--api-key`, and profile flags

The current ClinkBill OpenAPI exposes public endpoints for checkout sessions, billing sessions, orders, agent payment sessions, payments, payment instruments, products, prices, coupons, promotion codes, refunds, subscriptions, invoices, and subscription test clocks.

These public API areas are not Dashboard-only and should not use OpenCLI as a fallback:

| Area | Public API exists? | Current CLI support | Recommendation |
| --- | --- | --- | --- |
| Orders list/get | Yes | No | Add normal API commands later. |
| Refund create/get | Yes | No | Add normal API commands later. |
| Coupon and promotion codes | Yes | No | Add normal API commands later. |
| Payment and payment instrument creation | Yes | No | Add normal API commands later if merchant workflow needs them. |
| Subscription get/cancel/invoice/test clocks | Yes | Create only | Add normal API commands later. |
| Price get/update | Yes | Create/list only | Add normal API commands later. |
| Checkout session get | Yes | Create only | Add normal API commands later. |
| Customer portal session | Listed in docs navigation | No | Confirm OpenAPI shape, then add normal API command. |

## Dashboard Operations Not Covered By Public API Or Current CLI

The following operations are currently Dashboard-only or not exposed by the public API/CLI surface reviewed here:

| Operation | Public evidence | Why API/CLI cannot complete it today |
| --- | --- | --- |
| Initialize a merchant Secret Key | ClinkBill docs say the key is generated in the Dashboard Developers tab and displayed once. | No public API endpoint for key creation. Current CLI can store an existing key only. |
| Roll, delete, or IP-restrict Secret Keys | ClinkBill docs describe Dashboard API key pages and overflow-menu actions. | No public API endpoint for key lifecycle or IP restriction. High-risk credential operation. |
| Register webhook endpoint | ClinkBill docs say to go to Developers -> Webhooks, click Add, enter HTTPS endpoint, and select event types. | No public `/webhook` endpoint in the OpenAPI spec. Current CLI only simulates/signs/verifies local webhook payloads. |
| View or capture webhook signing key after endpoint registration | ClinkBill docs say the signature key becomes available after registration. | No public endpoint for retrieving the signing key. Current CLI can store/use a provided key only. |
| Manage webhook endpoint event selections, disable, or delete | Dashboard registration flow exists; no public endpoint reviewed. | No public webhook endpoint CRUD API. |
| Merchant profile update, merchant creation, merchant disable | Merchant docs describe Dashboard Settings -> Merchant flows. | No public merchant admin API in OpenAPI. Some actions require Clink review or affect payment acceptance. |
| User management, roles, permissions, MFA, sessions | User docs describe Dashboard Settings -> Users and profile security flows. | No public user admin API. These are account-security operations. |
| Linked PSP connection add/edit/delete | Docs describe Settings -> Merchant -> Linked Payment Services Providers and require PSP API keys/webhook signatures. | No public PSP connection API. Includes external PSP credentials and PCI-sensitive context. |
| Balance and payout Dashboard flows | Docs describe Balances tab and Balances -> Payouts. | No public balance/payout API in reviewed OpenAPI. Payouts and bank accounts are financial operations. |
| Product archive/unarchive | Product guide describes Dashboard archive/unarchive. | No public product archive endpoint in reviewed OpenAPI, and current CLI does not expose it. |

## Operations Suitable For Temporary OpenCLI Fallback

OpenCLI is best suited only for sandbox, human-in-the-loop Dashboard assistance where the browser automation reduces navigation and form-filling work but does not take custody of secrets or final authority.

Suitable temporary uses:

1. **Dashboard readiness check**
   - Confirm the user is logged into the expected ClinkBill Dashboard profile.
   - Read non-secret page state such as current merchant name, selected environment, and whether the Developers/Webhooks pages are reachable.
   - Output JSON with `loggedIn`, `merchantLabel`, `environmentLabel`, and page availability.

2. **Webhook endpoint registration preparation**
   - Sandbox only.
   - Fill the webhook endpoint URL and requested event selections.
   - Stop at a review screen before clicking the final Add/Confirm button.
   - Require the human to inspect the merchant, environment, URL, and events in the browser.
   - After human confirmation, optionally read back non-secret endpoint metadata such as endpoint URL, enabled status, and selected events.

3. **Webhook endpoint configuration verification**
   - Read-only check that a user-provided HTTPS endpoint appears in the webhook list with expected event selections.
   - Mask endpoint paths and query strings in logs unless the endpoint was passed on the command line.

4. **API key setup guidance**
   - Navigate the human to Developers -> API Keys.
   - Explain that the user must initialize/copy/store the Secret Key themselves.
   - Never click Initialize Key automatically.
   - Never scrape, print, store, or pass the key to an agent.

5. **Legacy signing key setup guidance**
   - This section applied before the public webhook endpoint API existed.
   - Current flow: use `clink webhook endpoint ensure --save-secret --show-secret --json`, then write the returned signing key into `CLINK_WEBHOOK_SIGNING_KEY` through a backend/platform Secret API or tool.
   - Only ask a human to copy the signing key when the platform does not allow the agent to write Secrets.

Not suitable for OpenCLI:

- replacing public API commands that already exist
- production environment writes
- unattended setup
- long-lived monitoring
- CI automation
- any flow requiring password, MFA, real Secret Key, webhook signing key, PSP key, bank account, or payout credentials to be given to the agent

## Operations Requiring Human Confirmation

The following must require explicit human review and final confirmation in the Dashboard. Some should remain fully manual.

| Operation | Minimum required boundary |
| --- | --- |
| API key initialization | Fully manual. OpenCLI may navigate only. The human clicks Initialize Key and stores the one-time key. |
| API key rotation | Fully manual. It can revoke access and exposes a one-time replacement key. |
| API key deletion | Fully manual. It can immediately break live integrations. |
| API key IP restriction changes | Manual final confirmation. Incorrect CIDR values can cause outages. |
| Webhook endpoint registration | OpenCLI may prepare sandbox forms only; final Add/Confirm must be human-approved. |
| Webhook endpoint event selection changes | Human review and confirmation. Missing events can break integration state. |
| Webhook endpoint disable/delete | Fully manual for production; sandbox may allow prepared flow with human final click. |
| Webhook signing key viewing/copying | Fully manual. Agent must not read, print, store, screenshot, or summarize the raw key. |
| Merchant create/update/disable | Fully manual. New merchants require review and disabling prevents payments. |
| User invites, roles, permissions, password reset, MFA reset, session termination | Fully manual. Account-security and access-control impact. |
| Linked PSP connection add/edit/delete | Fully manual. It includes PSP API keys, webhook signatures, and payment routing. |
| Bank account add/edit and payout request | Fully manual. Financial and bank-account impact. |
| Any production write | Fully manual unless ClinkBill later publishes official API support and policy-approved automation gates. |

## Proposed OpenCLI Adapter Commands

If the experiment is approved later, keep it outside this package first. Do not add OpenCLI as a dependency of `clink-integ-cli`. The command surface should live in an OpenCLI plugin or separate research package.

Recommended OpenCLI-native commands:

```bash
opencli clinkbill dashboard status --env sandbox --format json
opencli clinkbill dashboard open --section developers --env sandbox
opencli clinkbill api-key guide --env sandbox
opencli clinkbill webhook list --env sandbox --format json
opencli clinkbill webhook verify --url https://example.com/clink/webhook --events all --env sandbox --format json
opencli clinkbill webhook prepare --url https://example.com/clink/webhook --events all --env sandbox --require-human-confirm
```

If a thin `clink` wrapper is ever added, it should be opt-in and fail closed when OpenCLI is missing:

```bash
clink dashboard status --adapter opencli --env sandbox --json
clink dashboard webhook verify --adapter opencli --url https://example.com/clink/webhook --events all --env sandbox --json
clink dashboard webhook prepare --adapter opencli --url https://example.com/clink/webhook --events all --env sandbox --require-human-confirm
clink dashboard api-key guide --adapter opencli --env sandbox
```

Do not implement these commands until the adapter is approved. If implemented later, require:

- `--adapter opencli` or `--experimental-dashboard`
- sandbox default
- `--env production` rejection unless a separate `--i-understand-production-dashboard-risk` flag is present
- no raw secret output
- JSON output with masked values
- browser-visible human review before every write
- a dry-run/preflight mode that never clicks final submit buttons

## Safety Boundaries

### API Key Initialization

- Current state: Dashboard-only for key creation. CLI can store an existing key without any browser step using `clink auth secret set --api-key env:CLINK_SECRET_KEY`.
- Allowed OpenCLI behavior: navigate to Developers -> API Keys and display instructions.
- Forbidden behavior: clicking Initialize Key, reading the one-time key, copying it from DOM/clipboard, writing it to shell history, config, `.env`, logs, screenshots, or JSON output.
- Required user action: the human initializes, copies, and stores the key outside the agent; the CLI only references it through `env:CLINK_SECRET_KEY` or an explicitly provided literal key.

### Webhook Signing Key Viewing

- Legacy state at the time of this research: signing key became available only after Dashboard webhook endpoint registration; no public retrieval endpoint had been reviewed.
- Current state: webhook endpoint management is supported by Secret Key API commands in `clink-integ-cli`.
- Current flow: run `clink webhook endpoint ensure --save-secret --show-secret --json`, then sync the returned or rotated signing key into `CLINK_WEBHOOK_SIGNING_KEY` in the app runtime and redeploy.
- Required user action only when blocked: if the platform does not expose a Secret write tool/API to the agent, the human adds `CLINK_WEBHOOK_SIGNING_KEY` to the platform backend Secret manager.

### Webhook Endpoint Registration

- Current state: Dashboard-only; no public OpenAPI endpoint.
- Allowed OpenCLI behavior: sandbox-only form preparation and read-back verification.
- Required confirmation: human verifies merchant, environment, endpoint URL, event selection, and final button state before submission.
- Forbidden default: production registration, endpoint deletion, endpoint disabling, event deselection, or overwriting an existing endpoint.
- Adapter output: endpoint URL should be masked unless provided by the user; signing key must never be included.

### Production Environment Operations

- Default policy: reject production Dashboard writes.
- Production read-only checks may be allowed only after the browser clearly shows the selected production merchant and the command includes `--env production`.
- Production writes must remain manual unless ClinkBill publishes official API support and a separate production validation gate is designed.
- Never rely on hidden Dashboard state. The adapter must display the detected environment and merchant and require the user to confirm mismatches.

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Secret exposure through DOM snapshots, logs, screenshots, or JSON | Compromise of merchant Secret Key or webhook signing key | Never inspect secret fields; mask output; forbid screenshots on secret pages; keep secret entry manual. |
| One-time API key display lost or mishandled | User cannot retrieve the key again and may need rotation | Human owns initialization and storage; adapter only navigates. |
| Production mis-targeting | Live payment, webhook, user, or payout changes | Sandbox default; production writes rejected; visible merchant/environment confirmation. |
| UI selector drift | Broken or wrong clicks after Dashboard changes | Keep adapter experimental; use read-before-write checks; fail closed. |
| Account lockout or MFA friction | User loses access or blocks onboarding | Never automate passwords or MFA; user handles login. |
| Webhook endpoint misconfiguration | Missing events or wrong URL can break integration | Prepare-only flow, human review, read-back verification, local `clink webhook simulate` smoke test. |
| Compliance and payment-routing impact | PSP/bank/payout operations may touch PCI or financial workflows | Exclude PSP, bank account, and payout automation. |

## Decision Matrix

| Option | Decision | Reason |
| --- | --- | --- |
| Build now | No | The most important gaps are secret-bearing or production-sensitive. Current project rules also say OpenCLI must not be a core dependency. |
| Defer | Yes | Keep a documented, sandbox-only fallback design while prioritizing API-first CLI commands and waiting for official webhook endpoint APIs or policy approval. |
| Reject | No | Webhook registration is a real onboarding gap. A tightly bounded OpenCLI experiment may be useful if ClinkBill accepts browser automation for sandbox setup. |

## Final Position

Do not build OpenCLI automation now. Use this document as the boundary for a future external experiment. In the meantime:

1. Add normal API commands for public endpoints that already exist.
2. For current integrations, use Secret Key API webhook endpoint commands instead of manual Dashboard webhook setup.
3. Ask ClinkBill for official public APIs for webhook endpoint create/list/delete, event list/replay, test event trigger, API key metadata, and Dashboard-safe onboarding status.
4. Revisit OpenCLI only if webhook endpoint registration remains Dashboard-only and developers repeatedly fail sandbox onboarding because of it.
