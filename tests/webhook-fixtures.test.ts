import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WEBHOOK_FIXTURE_PROFILE,
  WEBHOOK_FIXTURE_TYPES,
  createWebhookFixture,
} from "../src/webhook/fixtures.js";
import { WEBHOOK_COMMERCE_EVENTS } from "../src/webhook/event-catalog.js";
import { normalizeWebhookEvent } from "../src/webhook/normalize.js";
import { withSmokeReconciliationFields } from "../src/commands/smoke-test.js";

const REQUIRED_ACCEPTANCE_FIXTURES = [
  "order.succeeded",
  "order.failed",
  "refund.succeeded",
  "subscription.activated",
  "subscription.updated.renewed",
  "subscription.past_due",
  "subscription.cancelled",
  "invoice.open",
  "invoice.paid",
  "invoice.void",
  "dispute.created",
] as const;

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
      const data = event.data as { object: Record<string, unknown> };
      expect(Object.keys(data)).toEqual(["object"]);
      expect(data.object).not.toBeNull();
      expect(Array.isArray(data.object)).toBe(false);
      expect(data.object).not.toHaveProperty("object");
    }
  });

  it("covers all 31 stable commerce events without adding payment_method.deleted", () => {
    expect(WEBHOOK_FIXTURE_TYPES).toHaveLength(31);
    expect([...WEBHOOK_FIXTURE_TYPES].sort()).toEqual([...WEBHOOK_COMMERCE_EVENTS].sort());
    expect(WEBHOOK_FIXTURE_TYPES).not.toContain("payment_method.deleted");
  });

  it("generates every fixture required by the acceptance contract without relying on the implementation type list", () => {
    for (const type of REQUIRED_ACCEPTANCE_FIXTURES) {
      const event = createWebhookFixture(type);
      expect(event).toMatchObject({
        id: expect.stringMatching(/^event_/),
        object: "event",
        created: expect.any(Number),
        type,
        data: { object: expect.any(Object) },
      });
      expect(Number.isInteger(event.created)).toBe(true);
      const data = event.data as { object: unknown };
      expect(data.object).not.toBeNull();
      expect(Array.isArray(data.object)).toBe(false);
    }
  });

  it("uses production-style resource IDs and nests session/order resources in data.object", () => {
    expect(fixtureResource("session.complete")).toMatchObject({
      sessionId: "sess_test_123",
      orderId: null,
      merchantReferenceId: "merchant_order_test_123",
      status: "completed",
      paymentStatus: "paid",
    });
    expect(fixtureResource("order.succeeded")).toMatchObject({
      orderId: "order_test_123",
      sessionId: "sess_test_123",
      invoiceId: "inv_test_123",
      type: "recurring",
      merchantReferenceId: "merchant_order_test_123",
      status: "success",
    });
  });

  it("matches the stable order fields observed in sandbox webhook serialization", () => {
    const created = fixtureResource("order.created");
    const nextAction = fixtureResource("order.next_action");
    const succeeded = fixtureResource("order.succeeded");

    expect(created).toMatchObject({
      status: "created",
      paymentTime: null,
      paymentExecutionDetails: null,
      riskLevel: null,
    });
    expect(succeeded).toMatchObject({
      status: "success",
      paymentTime: expect.any(Number),
      paymentExecutionDetails: null,
      paymentMethod: {
        paymentMethodType: "CARD",
        paymentInstrumentId: "pi_test_123",
        cardLastFour: "4242",
        cardScheme: "VISA",
        issuerBank: "Test Bank",
        issuerRegion: "US",
        wallet: null,
      },
    });
    expect(nextAction).toMatchObject({
      orderId: "order_test_123",
      status: "requires_action",
      paymentTime: null,
    });
    expect(nextAction).not.toHaveProperty("nextAction");
    expect(created).not.toHaveProperty("createTime");
    expect(succeeded).not.toHaveProperty("createTime");
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
      expect(resource).not.toHaveProperty("activatedAt");
      expect(resource).not.toHaveProperty("pastDueSince");
      const lineItem = resource.recurringInvoiceItem ?? resource.upcomingInvoiceItem;
      expect(lineItem).toMatchObject({
        amount: "19.99",
        discountAmount: null,
        paymentAmount: "19.99",
        couponTerms: null,
        promotionCode: null,
        description: "Local webhook test plan",
        proration: null,
        price: {
          unitAmount: "19.99",
          recurring: {
            interval: "month",
            intervalCount: 1,
            pricingModel: "flat_rate",
            tiersMode: null,
            trialPeriodDays: null,
          },
        },
      });
    }

    expect(fixtureResource("subscription.created")).toMatchObject({
      recurringInvoiceItem: null,
      upcomingInvoiceItem: expect.any(Object),
      trialStart: null,
      trialEnd: null,
      cancelAt: null,
      cancelAtPeriodEnd: null,
      canceledAt: null,
      cancelReason: null,
      scheduledPhases: null,
      elapsedCycles: null,
      metadata: null,
    });
  });

  it("uses invoice.items, millisecond times, and string amounts for all invoice fixtures", () => {
    for (const type of ["invoice.open", "invoice.paid", "invoice.void"] as const) {
      const resource = fixtureResource(type);
      expect(resource.invoiceId).toBe("inv_test_123");
      expect(resource.createTime).toEqual(expect.any(Number));
      expect(resource.currentPeriodStart).toEqual(expect.any(Number));
      expect(resource.currentPeriodEnd).toEqual(expect.any(Number));
      expect(resource).not.toHaveProperty("lineItems");
      expect(resource).toHaveProperty("discount", null);
      expect(resource).toHaveProperty("metadata", null);
      expect(resource.items).toEqual([
        expect.objectContaining({
          amount: "19.99",
          discountAmount: null,
          paymentAmount: "19.99",
          couponTerms: null,
          promotionCode: null,
          description: "Local webhook test plan",
          proration: null,
          price: expect.objectContaining({
            unitAmount: "19.99",
            recurring: {
              interval: "month",
              intervalCount: 1,
              pricingModel: "flat_rate",
              tiersMode: null,
              trialPeriodDays: null,
            },
          }),
        }),
      ]);
    }

    expect(fixtureResource("invoice.open")).toHaveProperty("orderId", null);
    expect(fixtureResource("invoice.paid")).toHaveProperty("orderId", "order_test_123");
  });

  it("uses canonical refund sample fields and explicit lifecycle states", () => {
    expect(fixtureResource("refund.created")).toMatchObject({
      refundId: "rfd_test_123",
      orderId: "order_test_123",
      status: "created",
      createTime: expect.any(Number),
    });
    expect(fixtureResource("refund.succeeded")).toMatchObject({
      refundId: "rfd_test_123",
      orderId: "order_test_123",
      status: "success",
      createTime: expect.any(Number),
    });
    expect(fixtureResource("refund.failed")).toMatchObject({
      refundId: "rfd_test_123",
      orderId: "order_test_123",
      status: "failed",
      createTime: expect.any(Number),
      failureCode: "already_refunded",
      failureMessage: "The local fixture order has already been refunded.",
    });
    expect(fixtureResource("refund.created")).not.toHaveProperty("failureCode");
    expect(fixtureResource("refund.created")).not.toHaveProperty("failureMessage");
    expect(fixtureResource("refund.succeeded")).not.toHaveProperty("failureCode");
    expect(fixtureResource("refund.succeeded")).not.toHaveProperty("failureMessage");
    expect(fixtureResource("refund.succeeded")).not.toHaveProperty("object");
  });

  it("maps all five dispute lifecycle fixtures to their stable numeric statuses", () => {
    const statuses = {
      "dispute.created": 1,
      "dispute.updated": 2,
      "dispute.won": 3,
      "dispute.lost": 4,
      "dispute.closed": 5,
    } as const;

    for (const [type, status] of Object.entries(statuses)) {
      const resource = fixtureResource(type);
      expect(resource).toMatchObject({
        chargeBackId: "dispute_test_123",
        orderId: "order_test_123",
        merchantReferenceId: "merchant_order_test_123",
        disputeAmount: 19.99,
        disputeCurrency: "USD",
        evidenceDeadline: "2025-01-30T12:00:00.000Z",
        channelDisputeTime: "2025-01-16T09:00:00.000Z",
        status,
      });
      expect(resource).not.toHaveProperty("object");
    }
  });

  it("uses the production-oriented payment instrument resource without invented default fields", () => {
    const expectedBase = {
      id: "pi_test_123",
      customerId: "cus_test_123",
      type: "card",
      card: {
        last4: "4242",
        name: "Test User",
        expiryYear: "2030",
        expiryMonth: "12",
        scheme: "visa",
        funding: "credit",
        issuerRegion: "US",
        issuerBank: "Test Bank",
        billingAddress: null,
      },
      wallet: null,
      created: expect.any(Number),
    };

    for (const type of ["payment_method.added", "payment_method.default_change"] as const) {
      const resource = fixtureResource(type);
      expect(resource).toMatchObject(expectedBase);
      expect(resource).not.toHaveProperty("visaRegistrationSucceeded");
      expect(resource).not.toHaveProperty("isDefault");
    }

    expect(fixtureResource("payment_method.update")).toMatchObject({
      ...expectedBase,
      visaRegistrationSucceeded: true,
    });
    expect(fixtureResource("payment_method.update")).not.toHaveProperty("isDefault");
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
