import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WEBHOOK_FIXTURE_PROFILE,
  WEBHOOK_FIXTURE_TYPES,
  createWebhookFixture,
} from "../src/webhook/fixtures.js";
import { normalizeWebhookEvent } from "../src/webhook/normalize.js";
import { withSmokeReconciliationFields } from "../src/commands/smoke-test.js";

function fixtureResource(type: string): Record<string, unknown> {
  const event = createWebhookFixture(type);
  const data = event.data as { object: Record<string, unknown> };
  return data.object;
}

describe("merchant webhook fixtures", () => {
  it("uses merchant-webhook as the canonical default profile", () => {
    expect(DEFAULT_WEBHOOK_FIXTURE_PROFILE).toBe("merchant-webhook");

    for (const type of WEBHOOK_FIXTURE_TYPES) {
      const event = createWebhookFixture(type);
      expect(event.id).toMatch(/^event_/);
      expect(event.object).toBe("event");
      expect(event.created).toEqual(expect.any(Number));
      expect(Number.isInteger(event.created)).toBe(true);
      expect(event.type).toBe(type);
      expect(event).not.toHaveProperty("livemode");
      expect(event.data).toMatchObject({ object: expect.any(Object) });
    }
  });

  it("uses production-style resource IDs and nests session/order resources in data.object", () => {
    expect(fixtureResource("session.complete")).toMatchObject({
      sessionId: "sess_test_123",
      orderId: "order_test_123",
      merchantReferenceId: "merchant_order_test_123",
      status: "completed",
      paymentStatus: "paid",
    });
    expect(fixtureResource("order.succeeded")).toMatchObject({
      orderId: "order_test_123",
      sessionId: "sess_test_123",
      merchantReferenceId: "merchant_order_test_123",
      status: "success",
    });
  });

  it("keeps smoke-test reconciliation overrides inside canonical data.object", () => {
    const event = withSmokeReconciliationFields(createWebhookFixture("order.succeeded"), {
      merchantReferenceId: "smoke-123",
      sessionId: "sess_smoke_123",
    });
    const data = event.data as Record<string, unknown>;
    expect(data).not.toHaveProperty("merchantReferenceId");
    expect(data.object).toMatchObject({
      merchantReferenceId: "smoke-123",
      sessionId: "sess_smoke_123",
    });
  });

  it("covers the complete 11-event subscription lifecycle with millisecond times and string line-item amounts", () => {
    const subscriptionTypes = WEBHOOK_FIXTURE_TYPES.filter((type) => type.startsWith("subscription."));
    expect(subscriptionTypes).toHaveLength(11);
    expect(subscriptionTypes).toEqual(expect.arrayContaining([
      "subscription.created",
      "subscription.trialing",
      "subscription.activated",
      "subscription.incomplete_expired",
      "subscription.past_due",
      "subscription.cancelled",
      "subscription.updated.plan_changed",
      "subscription.updated.plan_change_canceled",
      "subscription.updated.renewed",
      "subscription.updated.cancel_at_period_end_set",
      "subscription.updated.cancel_at_period_end_revoked",
    ]));

    for (const type of subscriptionTypes) {
      const resource = fixtureResource(type);
      expect(resource.subscriptionId).toBe("sub_test_123");
      expect(resource.createTime).toEqual(expect.any(Number));
      expect(resource.currentPeriodStart).toEqual(expect.any(Number));
      expect(resource.currentPeriodEnd).toEqual(expect.any(Number));
      expect(resource.recurringInvoiceItem).toMatchObject({
        amount: "19.99",
        discountAmount: "0.00",
        paymentAmount: "19.99",
      });
    }
  });

  it("uses invoice.items, millisecond times, and string amounts for all invoice fixtures", () => {
    for (const type of ["invoice.open", "invoice.paid", "invoice.void"] as const) {
      const resource = fixtureResource(type);
      expect(resource.invoiceId).toBe("inv_test_123");
      expect(resource.createTime).toEqual(expect.any(Number));
      expect(resource.currentPeriodStart).toEqual(expect.any(Number));
      expect(resource.currentPeriodEnd).toEqual(expect.any(Number));
      expect(resource).not.toHaveProperty("lineItems");
      expect(resource.items).toEqual([
        expect.objectContaining({
          amount: "19.99",
          discountAmount: "0.00",
          paymentAmount: "19.99",
        }),
      ]);
    }
  });

  it("rejects unsupported fixture types instead of generating an ambiguous mixed payload", () => {
    expect(() => createWebhookFixture("customer.unknown")).toThrow(/Unsupported webhook fixture type/);
  });
});

describe("legacy webhook fixture compatibility", () => {
  it("requires the explicit legacy profile and produces the deprecated flattened shape", () => {
    const event = createWebhookFixture("invoice.paid", { profile: "legacy" });
    const data = event.data as Record<string, unknown>;

    expect(event.id).toMatch(/^evt_/);
    expect(event.created).toEqual(expect.any(String));
    expect(event.livemode).toBe(false);
    expect(data.object).toBe("invoice");
    expect(data).toHaveProperty("lineItems");
    expect(data).not.toHaveProperty("items");
  });

  it("normalizes legacy payloads after verification and reports only safe event identity fields", () => {
    const event = createWebhookFixture("invoice.paid", { profile: "legacy" });
    const onLegacy = vi.fn();
    const normalized = normalizeWebhookEvent(event, { onLegacy });

    expect(normalized.created).toEqual(expect.any(Number));
    expect(normalized.data.object).toMatchObject({
      invoiceId: "inv_test_123",
      items: expect.any(Array),
    });
    expect(normalized.data.object).not.toHaveProperty("lineItems");
    expect(onLegacy).toHaveBeenCalledWith({ id: event.id, type: "invoice.paid" });
  });

  it("leaves canonical data.object resources intact", () => {
    const event = createWebhookFixture("subscription.activated");
    const resource = (event.data as { object: Record<string, unknown> }).object;
    const normalized = normalizeWebhookEvent(event);
    expect(normalized.data.object).toBe(resource);
  });

  it("rejects unrecognized payloads so handlers can return non-2xx", () => {
    expect(() => normalizeWebhookEvent({ id: "event_bad", object: "event", created: Date.now(), type: "order.succeeded", data: {} }))
      .toThrow(/data\.object must be/);
  });
});
