import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { components } from "../src/openapi/clink.openapi.js";
import type {
  InvoiceItemWebhookObject,
  InvoiceWebhookEvent,
  InvoiceWebhookObject,
  MerchantWebhookEvent,
  SubscriptionWebhookObject,
  SubscriptionWebhookEvent,
} from "../src/api/openapi-types.js";
import { LEGACY_WEBHOOK_WARNING_CODE, normalizeWebhookEvent } from "../src/webhook/normalize.js";

type Assert<T extends true> = T;
type EventSession = components["schemas"]["EventSessionVo"];
type EventOrder = components["schemas"]["EventOrderVo"];
type EventRefund = components["schemas"]["EventRefundVo"];
type EventSubscription = components["schemas"]["EventSubVo"];
type EventInvoice = components["schemas"]["EventInvoiceVo"];
type EventDispute = components["schemas"]["EventDisputeVo"];

type _SessionDataHasObject = Assert<"object" extends keyof NonNullable<EventSession["data"]> ? true : false>;
type _OrderDataHasObject = Assert<"object" extends keyof NonNullable<EventOrder["data"]> ? true : false>;
type _RefundDataHasObject = Assert<"object" extends keyof NonNullable<EventRefund["data"]> ? true : false>;
type _SubscriptionDataHasObject = Assert<"object" extends keyof NonNullable<EventSubscription["data"]> ? true : false>;
type _InvoiceDataHasObject = Assert<"object" extends keyof NonNullable<EventInvoice["data"]> ? true : false>;
type _DisputeDataHasObject = Assert<"object" extends keyof NonNullable<EventDispute["data"]> ? true : false>;

// These assignments intentionally fail when the generated/public contract
// regresses to ISO strings. `npm run check` compiles this file separately.
// @ts-expect-error generated event timestamps are Unix milliseconds
const generatedInvoiceCreatedCannotBeString: EventInvoice["created"] = "2025-01-15T12:00:00.000Z";
// @ts-expect-error canonical event timestamps are Unix milliseconds
const canonicalCreatedCannotBeString: MerchantWebhookEvent["created"] = "2025-01-15T12:00:00.000Z";
// @ts-expect-error canonical resources must be nested objects
const canonicalObjectCannotBeString: MerchantWebhookEvent["data"]["object"] = "invoice";

void generatedInvoiceCreatedCannotBeString;
void canonicalCreatedCannotBeString;
void canonicalObjectCannotBeString;

describe("OpenAPI and canonical merchant webhook type contracts", () => {
  it("keeps generated event envelopes nested and millisecond-based", () => {
    expectTypeOf<EventSession["created"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<EventOrder["created"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<EventRefund["created"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<EventSubscription["created"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<EventInvoice["created"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<EventDispute["created"]>().toEqualTypeOf<number | undefined>();

    expectTypeOf<NonNullable<EventInvoice["data"]>["object"]>()
      .toEqualTypeOf<components["schemas"]["InvoiceApiVo"] | undefined>();
    expectTypeOf<NonNullable<EventSubscription["data"]>["object"]>()
      .toEqualTypeOf<components["schemas"]["SubApiVo"] | undefined>();
  });

  it("uses the canonical merchant envelope for exported webhook types", () => {
    expectTypeOf<MerchantWebhookEvent["created"]>().toEqualTypeOf<number>();
    expectTypeOf<MerchantWebhookEvent["object"]>().toEqualTypeOf<"event">();
    expectTypeOf<MerchantWebhookEvent["data"]["object"]>().toEqualTypeOf<Record<string, unknown>>();
    expectTypeOf<InvoiceWebhookEvent["data"]["object"]>().toEqualTypeOf<InvoiceWebhookObject>();
    expectTypeOf<SubscriptionWebhookEvent["data"]["object"]>()
      .toEqualTypeOf<SubscriptionWebhookObject>();
  });

  it("models production-serialized invoice amounts as strings", () => {
    expectTypeOf<InvoiceWebhookObject["originalAmount"]>().toEqualTypeOf<string | null>();
    expectTypeOf<InvoiceWebhookObject["paymentAmount"]>().toEqualTypeOf<string | null>();
    expectTypeOf<InvoiceItemWebhookObject["amount"]>().toEqualTypeOf<string | null>();
    expectTypeOf<InvoiceItemWebhookObject["discountAmount"]>().toEqualTypeOf<string | null>();
    expectTypeOf<InvoiceItemWebhookObject["paymentAmount"]>().toEqualTypeOf<string | null>();
    expectTypeOf<NonNullable<InvoiceItemWebhookObject["price"]>["unitAmount"]>()
      .toEqualTypeOf<string | null>();
  });

  it("models production-serialized subscription times as nullable milliseconds", () => {
    expectTypeOf<SubscriptionWebhookObject["createTime"]>().toEqualTypeOf<number | null>();
    expectTypeOf<SubscriptionWebhookObject["trialStart"]>().toEqualTypeOf<number | null>();
    expectTypeOf<SubscriptionWebhookObject["trialEnd"]>().toEqualTypeOf<number | null>();
    expectTypeOf<SubscriptionWebhookObject["currentPeriodStart"]>().toEqualTypeOf<number | null>();
    expectTypeOf<SubscriptionWebhookObject["currentPeriodEnd"]>().toEqualTypeOf<number | null>();
    expectTypeOf<SubscriptionWebhookObject["cancelAt"]>().toEqualTypeOf<number | null>();
    expectTypeOf<SubscriptionWebhookObject["canceledAt"]>().toEqualTypeOf<number | null>();
    expectTypeOf<SubscriptionWebhookObject["recurringInvoiceItem"]>()
      .toEqualTypeOf<InvoiceItemWebhookObject | null>();
    expectTypeOf<SubscriptionWebhookObject["upcomingInvoiceItem"]>()
      .toEqualTypeOf<InvoiceItemWebhookObject | null>();
  });
});

describe("legacy webhook normalization reporting", () => {
  it("emits a safe default warning when no custom reporter is provided", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const payload = {
      id: "evt_legacy_test",
      object: "event",
      created: "2025-01-15T12:00:00.000Z",
      type: "invoice.paid",
      data: {
        object: "invoice",
        customerEmail: "private@example.com",
        originalAmount: "19.99",
        secret: "whsec_must_not_be_logged",
        lineItems: [],
      },
    };

    const normalized = normalizeWebhookEvent(payload);

    expect(normalized.created).toBe(1736942400000);
    expect(normalized.data.object).toHaveProperty("items", []);
    expect(warn).toHaveBeenCalledOnce();
    const warning = String(warn.mock.calls[0]?.[0]);
    expect(JSON.parse(warning)).toEqual({
      code: LEGACY_WEBHOOK_WARNING_CODE,
      eventId: "evt_legacy_test",
      eventType: "invoice.paid",
    });
    expect(warning).not.toContain("private@example.com");
    expect(warning).not.toContain("19.99");
    expect(warning).not.toContain("whsec_must_not_be_logged");

    warn.mockRestore();
  });
});
