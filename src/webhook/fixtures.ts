export const WEBHOOK_FIXTURE_PROFILES = ["merchant-webhook", "legacy"] as const;

export type WebhookFixtureProfile = (typeof WEBHOOK_FIXTURE_PROFILES)[number];

export const DEFAULT_WEBHOOK_FIXTURE_PROFILE: WebhookFixtureProfile = "merchant-webhook";

export const WEBHOOK_FIXTURE_TYPES = [
  "session.complete",
  "session.expired",
  "order.created",
  "order.succeeded",
  "order.failed",
  "refund.succeeded",
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
  "invoice.open",
  "invoice.paid",
  "invoice.void",
  "dispute.created",
] as const;

export type WebhookFixtureType = (typeof WEBHOOK_FIXTURE_TYPES)[number];

export interface WebhookFixtureOptions {
  profile?: WebhookFixtureProfile;
  overrides?: Record<string, unknown>;
}

const FIXTURE_EVENT_CREATED = Date.parse("2025-01-15T12:00:00.000Z");
const CHECKOUT_CREATED_AT = "2025-01-15T11:45:00.000Z";
const CHECKOUT_EXPIRES_AT = "2025-01-15T12:45:00.000Z";
const ORDER_CREATED_TIME = Date.parse("2025-01-15T11:50:00.000Z");
const ORDER_PAYMENT_TIME = Date.parse("2025-01-15T11:55:00.000Z");
const SUBSCRIPTION_CREATED_AT = Date.parse("2025-01-15T11:56:00.000Z");
const SUBSCRIPTION_ACTIVATED_AT = Date.parse("2025-01-15T11:57:00.000Z");
const CURRENT_PERIOD_START = Date.parse("2025-01-15T00:00:00.000Z");
const CURRENT_PERIOD_END = Date.parse("2025-02-15T00:00:00.000Z");
const NEXT_PERIOD_START = CURRENT_PERIOD_END;
const NEXT_PERIOD_END = Date.parse("2025-03-15T00:00:00.000Z");
const TRIAL_START = Date.parse("2025-01-15T11:57:00.000Z");
const TRIAL_END = Date.parse("2025-01-22T11:57:00.000Z");
const PAST_DUE_SINCE = Date.parse("2025-02-16T00:00:00.000Z");
const CANCELLED_AT = Date.parse("2025-02-16T12:00:00.000Z");
const INVOICE_CREATED_AT = Date.parse("2025-01-15T11:58:00.000Z");
const REFUND_CREATED_AT = Date.parse("2025-01-16T09:30:00.000Z");

export function createWebhookFixture(type: string, options: WebhookFixtureOptions = {}): Record<string, unknown> {
  const fixtureType = assertFixtureType(type);
  const profile = options.profile ?? DEFAULT_WEBHOOK_FIXTURE_PROFILE;
  if (!WEBHOOK_FIXTURE_PROFILES.includes(profile)) {
    throw new Error(`Unsupported webhook fixture profile "${profile}". Use one of: ${WEBHOOK_FIXTURE_PROFILES.join(", ")}.`);
  }

  const resource = fixtureBuilders[fixtureType]();
  const event = profile === "legacy"
    ? createLegacyEnvelope(fixtureType, resource)
    : createMerchantWebhookEnvelope(fixtureType, resource);

  return {
    ...event,
    ...options.overrides,
  };
}

export function isDeprecatedWebhookFixtureProfile(profile: WebhookFixtureProfile): boolean {
  return profile === "legacy";
}

function createMerchantWebhookEnvelope(type: WebhookFixtureType, resource: Record<string, unknown>): Record<string, unknown> {
  return {
    id: fixtureEventId(type, "event"),
    object: "event",
    created: FIXTURE_EVENT_CREATED,
    type,
    data: {
      object: resource,
    },
  };
}

function createLegacyEnvelope(type: WebhookFixtureType, resource: Record<string, unknown>): Record<string, unknown> {
  const legacyResource = toLegacyResource(resource);
  const resourceObject = typeof legacyResource.object === "string" ? legacyResource.object : resourceObjectForType(type);
  delete legacyResource.object;

  return {
    id: fixtureEventId(type, "evt"),
    object: "event",
    created: new Date(FIXTURE_EVENT_CREATED).toISOString(),
    livemode: false,
    type,
    data: {
      object: resourceObject,
      ...legacyResource,
    },
  };
}

const fixtureBuilders: Record<WebhookFixtureType, () => Record<string, unknown>> = {
  "session.complete": () =>
    sessionFixture({
      status: "completed",
      paymentStatus: "paid",
      orderId: "order_test_123",
      expiresAt: CHECKOUT_EXPIRES_AT,
    }),
  "session.expired": () =>
    sessionFixture({
      status: "expired",
      paymentStatus: "unpaid",
      orderId: null,
      expiresAt: CHECKOUT_EXPIRES_AT,
    }),
  "order.created": () =>
    orderFixture({
      status: "pending",
      paymentTime: null,
      paymentExecutionDetails: [],
    }),
  "order.succeeded": () =>
    orderFixture({
      status: "success",
      paymentTime: ORDER_PAYMENT_TIME,
      paymentExecutionDetails: [],
    }),
  "order.failed": () =>
    orderFixture({
      status: "failed",
      paymentTime: ORDER_PAYMENT_TIME,
      paymentExecutionDetails: [
        {
          channelCode: "CARD",
          originalFailureCode: "card_declined",
          originalFailureMessage: "The payment method was declined in the local fixture.",
        },
      ],
    }),
  "refund.succeeded": () => refundFixture(),
  "subscription.created": () => subscriptionFixture({ status: "incomplete" }),
  "subscription.trialing": () => subscriptionFixture({ status: "free_trial", trialStart: TRIAL_START, trialEnd: TRIAL_END }),
  "subscription.activated": () => subscriptionFixture({ status: "active", activatedAt: SUBSCRIPTION_ACTIVATED_AT }),
  "subscription.incomplete_expired": () => subscriptionFixture({ status: "incomplete_expired" }),
  "subscription.past_due": () => subscriptionFixture({ status: "past_due", activatedAt: SUBSCRIPTION_ACTIVATED_AT, pastDueSince: PAST_DUE_SINCE }),
  "subscription.cancelled": () => subscriptionFixture({ status: "cancelled", activatedAt: SUBSCRIPTION_ACTIVATED_AT, canceledAt: CANCELLED_AT, cancelReason: "requested_by_customer" }),
  "subscription.updated.plan_changed": () => subscriptionFixture({ status: "active", activatedAt: SUBSCRIPTION_ACTIVATED_AT, priceId: "price_test_456", priceSnapshotId: "price_snapshot_test_456" }),
  "subscription.updated.plan_change_canceled": () => subscriptionFixture({ status: "active", activatedAt: SUBSCRIPTION_ACTIVATED_AT }),
  "subscription.updated.renewed": () => subscriptionFixture({ status: "active", activatedAt: SUBSCRIPTION_ACTIVATED_AT, currentPeriodStart: NEXT_PERIOD_START, currentPeriodEnd: NEXT_PERIOD_END }),
  "subscription.updated.cancel_at_period_end_set": () => subscriptionFixture({ status: "active", activatedAt: SUBSCRIPTION_ACTIVATED_AT, cancelAtPeriodEnd: true, cancelAt: CURRENT_PERIOD_END }),
  "subscription.updated.cancel_at_period_end_revoked": () => subscriptionFixture({ status: "active", activatedAt: SUBSCRIPTION_ACTIVATED_AT, cancelAtPeriodEnd: false, cancelAt: null }),
  "invoice.open": () => invoiceFixture({ status: "open", paymentAmount: "0.00" }),
  "invoice.paid": () => invoiceFixture({ status: "paid", paymentAmount: "19.99" }),
  "invoice.void": () => invoiceFixture({ status: "void", paymentAmount: "0.00" }),
  "dispute.created": () => disputeFixture(),
};

function assertFixtureType(type: string): WebhookFixtureType {
  if ((WEBHOOK_FIXTURE_TYPES as readonly string[]).includes(type)) return type as WebhookFixtureType;
  throw new Error(`Unsupported webhook fixture type "${type}". Supported types: ${WEBHOOK_FIXTURE_TYPES.join(", ")}.`);
}

function fixtureEventId(type: string, prefix: "event" | "evt"): string {
  return `${prefix}_${type.replace(/[^a-z0-9]+/gi, "_")}_test`;
}

function baseCustomer(): Record<string, unknown> {
  return {
    customerId: "cus_test_123",
    email: "test@example.com",
    name: "Test Customer",
  };
}

function recurringInvoiceItem(): Record<string, unknown> {
  return {
    invoiceItemId: "invoice_item_test_123",
    amount: "19.99",
    discountAmount: "0.00",
    paymentAmount: "19.99",
    currency: "USD",
    periodStart: CURRENT_PERIOD_START,
    periodEnd: CURRENT_PERIOD_END,
    proration: false,
    price: {
      productId: "prd_test_123",
      productName: "Local webhook test plan",
      priceId: "price_test_123",
      priceSnapshotId: "price_snapshot_test_123",
      unitAmount: "19.99",
      quantity: 1,
    },
  };
}

function invoiceItems(): Record<string, unknown>[] {
  return [recurringInvoiceItem()];
}

function basePriceDataList(): Record<string, unknown>[] {
  return [
    {
      name: "Local webhook test plan",
      quantity: 1,
      unitAmount: 19.99,
      currency: "USD",
      imageUrl: "https://merchant.example/assets/local-webhook-test.png",
    },
  ];
}

function baseMetadata(): Record<string, unknown> {
  return {
    environment: "local",
    source: "clink-integ-cli",
  };
}

function sessionFixture(values: {
  status: string;
  paymentStatus: string;
  orderId: string | null;
  expiresAt: string;
}): Record<string, unknown> {
  return {
    object: "checkout.session",
    sessionId: "sess_test_123",
    token: "tok_test_123",
    status: values.status,
    paymentStatus: values.paymentStatus,
    originalCurrency: "USD",
    paymentCurrency: "USD",
    amountSubtotal: 19.99,
    amountTotal: 19.99,
    subscriptionId: null,
    invoiceId: null,
    orderId: values.orderId,
    merchantReferenceId: "merchant_order_test_123",
    customer: baseCustomer(),
    locale: "en-US",
    uiMode: "hostedPage",
    returnUrl: null,
    successUrl: "https://merchant.example/success",
    cancelUrl: "https://merchant.example/cancel",
    created: CHECKOUT_CREATED_AT,
    expire: values.expiresAt,
    product: {
      productId: "prd_test_123",
      productName: "Local webhook test plan",
    },
    priceDataList: basePriceDataList(),
    metadata: baseMetadata(),
  };
}

function orderFixture(values: {
  status: string;
  paymentTime: number | null;
  paymentExecutionDetails: Record<string, unknown>[];
}): Record<string, unknown> {
  return {
    object: "order",
    orderId: "order_test_123",
    type: "onetime",
    status: values.status,
    merchantReferenceId: "merchant_order_test_123",
    sessionId: "sess_test_123",
    customerId: "cus_test_123",
    customerEmail: "test@example.com",
    createTime: ORDER_CREATED_TIME,
    productId: "prd_test_123",
    priceId: "price_test_123",
    priceDataList: basePriceDataList(),
    paymentMethod: {
      paymentMethodType: "CARD",
      paymentInstrumentId: "pi_test_123",
    },
    paymentExecutionDetails: values.paymentExecutionDetails,
    amountSubtotal: 19.99,
    amountTotal: 19.99,
    paymentCurrency: "USD",
    originalCurrency: "USD",
    paymentTime: values.paymentTime,
    metadata: baseMetadata(),
    riskLevel: "low",
  };
}

function subscriptionFixture(values: {
  status: string;
  activatedAt?: number;
  trialStart?: number;
  trialEnd?: number;
  pastDueSince?: number;
  canceledAt?: number;
  cancelReason?: string;
  cancelAt?: number | null;
  cancelAtPeriodEnd?: boolean;
  currentPeriodStart?: number;
  currentPeriodEnd?: number;
  priceId?: string;
  priceSnapshotId?: string;
}): Record<string, unknown> {
  return {
    object: "subscription",
    merchantReference: "merchant_subscription_test_123",
    subscriptionId: "sub_test_123",
    sessionId: "sess_test_123",
    customerId: "cus_test_123",
    productId: "prd_test_123",
    priceId: values.priceId ?? "price_test_123",
    priceSnapshotId: values.priceSnapshotId ?? "price_snapshot_test_123",
    createTime: SUBSCRIPTION_CREATED_AT,
    quantity: 1,
    paymentMethodType: "CARD",
    paymentInstrumentId: "pi_test_123",
    trialStart: values.trialStart,
    trialEnd: values.trialEnd,
    currentPeriodStart: values.currentPeriodStart ?? CURRENT_PERIOD_START,
    currentPeriodEnd: values.currentPeriodEnd ?? CURRENT_PERIOD_END,
    cancelAt: values.cancelAt,
    cancelAtPeriodEnd: values.cancelAtPeriodEnd ?? false,
    canceledAt: values.canceledAt,
    cancelReason: values.cancelReason,
    activatedAt: values.activatedAt,
    pastDueSince: values.pastDueSince,
    status: values.status,
    billing: "charge_automatically",
    currency: "USD",
    recurringInvoiceItem: recurringInvoiceItem(),
    metadata: baseMetadata(),
  };
}

function invoiceFixture(values: { status: string; paymentAmount: string }): Record<string, unknown> {
  return {
    object: "invoice",
    invoiceId: "inv_test_123",
    subscriptionId: "sub_test_123",
    merchantReference: "merchant_subscription_test_123",
    orderId: "order_test_123",
    customerId: "cus_test_123",
    merchantId: "merchant_test_123",
    status: values.status,
    createTime: INVOICE_CREATED_AT,
    currentPeriodStart: CURRENT_PERIOD_START,
    currentPeriodEnd: CURRENT_PERIOD_END,
    originalAmount: "19.99",
    paymentAmount: values.paymentAmount,
    originalCurrency: "USD",
    billing: "charge_automatically",
    items: invoiceItems(),
    metadata: baseMetadata(),
  };
}

function refundFixture(): Record<string, unknown> {
  return {
    object: "refund",
    createTime: REFUND_CREATED_AT,
    refundId: "rfd_test_123",
    refundMerchantOrderId: "merchant_refund_test_123",
    orderId: "order_test_123",
    customerId: "cus_test_123",
    refundAmount: 19.99,
    refundCurrency: "USD",
    status: "success",
    refundReason: "Customer Initiated Refund",
    paymentInstrumentId: "pi_test_123",
    metadata: baseMetadata(),
  };
}

function disputeFixture(): Record<string, unknown> {
  return {
    object: "dispute",
    chargeBackId: "dispute_test_123",
    channelCode: "CARD",
    orderId: "order_test_123",
    merchantReferenceId: "merchant_order_test_123",
    merchantId: "merchant_test_123",
    customerId: "cus_test_123",
    disputeAmount: 19.99,
    disputeCurrency: "USD",
    originalAmount: 19.99,
    originalCurrency: "USD",
    reasonCode: "fraudulent",
    reasonDescription: "Cardholder reported the payment as unrecognized.",
    status: 1,
    evidenceDeadline: "2025-01-30T12:00:00.000Z",
    channelDisputeTime: "2025-01-16T09:00:00.000Z",
    networkReasonCode: "10.4",
  };
}

function resourceObjectForType(type: WebhookFixtureType): string {
  if (type.startsWith("session.")) return "checkout.session";
  return type.split(".")[0];
}

function toLegacyResource(resource: Record<string, unknown>): Record<string, unknown> {
  const legacy = structuredClone(resource);
  if (Array.isArray(legacy.items)) {
    legacy.lineItems = legacy.items;
    delete legacy.items;
  }

  for (const field of [
    "createTime",
    "trialStart",
    "trialEnd",
    "currentPeriodStart",
    "currentPeriodEnd",
    "cancelAt",
    "canceledAt",
    "activatedAt",
    "pastDueSince",
  ]) {
    if (typeof legacy[field] === "number") {
      legacy[field] = new Date(legacy[field] as number).toISOString();
    }
  }

  return legacy;
}
