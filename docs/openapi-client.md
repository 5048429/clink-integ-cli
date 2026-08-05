# OpenAPI Types

The CLI generates TypeScript types from the Clink OpenAPI document:

```bash
npm run openapi:refresh
```

The refresh script reads `https://docs.clinkbill.com/api-reference/openapi.json` and writes the generated output to `src/openapi/clink.openapi.ts`. Do not edit that generated file directly. Commit only successful generated output; do not commit partial downloads or temporary OpenAPI JSON files.

## Typed Surface

`src/api/openapi-types.ts` exports stable aliases over generated `paths`, `components`, and `webhooks` types so command modules do not need to index into the raw generated file. REST API request and response aliases continue to come from this generated surface.

Currently migrated command payloads:

- `product create`: `ProductCreatePayload`, `ProductCreateResponse`
- `product list`: `ProductListQuery`, `ProductListResponse`
- `price create`: `PriceCreatePayload`, `PriceCreateResponse`
- `price list`: `PriceListQuery`, `PriceListResponse`
- `checkout create`: `CheckoutSessionCreatePayload`, `CheckoutSessionCreateResponse`
- `subscription create`: `SubscriptionCreatePayload`, `SubscriptionCreateResponse`

Generated but not yet wired to a CLI command:

- `RefundCreatePayload`
- `RefundCreateResponse`

The generated file contains the public OpenAPI event schemas, including `EventSessionVo`, `EventOrderVo`, `EventRefundVo`, `EventSubVo`, `EventInvoiceVo`, and `EventDisputeVo`. Regression tests require these published schemas to keep a numeric Unix-millisecond `created` field and an object-valued `data.object` wrapper.

Merchant Webhook exports keep the existing public names:

- `OrderWebhookEvent`
- `SessionWebhookEvent`
- `RefundWebhookEvent`
- `SubscriptionWebhookEvent`
- `InvoiceWebhookEvent`
- `CustomerVerifyWebhookEvent`
- `DisputeWebhookEvent`
- `ClinkWebhookEvent`
- `ClinkWebhookEventType`

These aliases do not directly reuse a generated event envelope. Their outer envelope is composed from `MerchantWebhookEvent` in `src/webhook/contracts.ts`, which requires `object: "event"`, numeric `created`, and an object-valued `data.object`. Invoice and subscription aliases use hand-maintained production-serialization resource contracts from the same file so decimal-string amounts and Unix-millisecond lifecycle timestamps do not regress. Other webhook resources may reuse generated resource DTOs when their fields remain suitable.

This separation is intentional:

- `src/openapi/clink.openapi.ts` mirrors the current public OpenAPI and is always regenerated.
- generated OpenAPI aliases describe the published REST request and response surface.
- `src/webhook/contracts.ts` describes the canonical production Merchant Webhook serialization used by handlers, fixtures, normalizers, and public webhook event aliases.
- Merchant Webhooks and Agent Customer Callbacks are separate contracts; subscription and invoice events are not flattened into an Agent Callback shape.

## Compatibility Notes

The existing CLI flags remain compatible. Some OpenAPI schemas are stricter than current command flags, especially enum fields such as product tax category, price currency, price type, checkout UI mode, and payment method type. Commands currently narrow those values for TypeScript without adding new runtime rejection rules; the API remains the source of truth for values the CLI has historically passed through.

Schema areas to treat as still settling:

- Public OpenAPI resource schemas can lag production Merchant Webhook serialization for nullable fields, missing fields, and decimal-string amounts. Refresh generated files, but do not replace the canonical Merchant Webhook contracts with incomplete generated resource schemas.
- Local fixtures cover the stable 31-event `commerce` preset, but remain deterministic simulations rather than evidence of real server delivery.
- Checkout and subscription scheduled phases are generated, but the current CLI does not expose flags for them.
- OpenAPI responses sometimes expose both `application/json` and `*/*`; local aliases prefer `application/json` when present.
