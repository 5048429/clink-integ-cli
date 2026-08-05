export const WEBHOOK_FIXTURE_PROFILES = ["merchant-webhook", "legacy"];
export const DEFAULT_WEBHOOK_FIXTURE_PROFILE = "merchant-webhook";
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
];
const FIXTURE_EVENT_CREATED = Date.parse("2025-01-15T12:00:00.000Z");
const CHECKOUT_CREATED_AT = "2025-01-15T11:45:00.000Z";
const CHECKOUT_EXPIRES_AT = "2025-01-15T12:45:00.000Z";
const ORDER_PAYMENT_TIME = Date.parse("2025-01-15T11:55:00.000Z");
const SUBSCRIPTION_CREATED_AT = Date.parse("2025-01-15T11:56:00.000Z");
const CURRENT_PERIOD_START = Date.parse("2025-01-15T00:00:00.000Z");
const CURRENT_PERIOD_END = Date.parse("2025-02-15T00:00:00.000Z");
const NEXT_PERIOD_START = CURRENT_PERIOD_END;
const NEXT_PERIOD_END = Date.parse("2025-03-15T00:00:00.000Z");
const TRIAL_START = Date.parse("2025-01-15T11:57:00.000Z");
const TRIAL_END = Date.parse("2025-01-22T11:57:00.000Z");
const CANCELLED_AT = Date.parse("2025-02-16T12:00:00.000Z");
const INVOICE_CREATED_AT = Date.parse("2025-01-15T11:58:00.000Z");
const REFUND_CREATED_AT = Date.parse("2025-01-16T09:30:00.000Z");
export function createWebhookFixture(type, options = {}) {
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
export function isDeprecatedWebhookFixtureProfile(profile) {
    return profile === "legacy";
}
function createMerchantWebhookEnvelope(type, resource) {
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
function createLegacyEnvelope(type, resource) {
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
const fixtureBuilders = {
    "session.complete": () => sessionFixture({
        status: "completed",
        paymentStatus: "paid",
        expiresAt: CHECKOUT_EXPIRES_AT,
    }),
    "session.expired": () => sessionFixture({
        status: "expired",
        paymentStatus: "unpaid",
        expiresAt: CHECKOUT_EXPIRES_AT,
    }),
    "order.created": () => orderFixture({
        status: "created",
        paymentTime: null,
        paymentExecutionDetails: null,
        riskLevel: null,
    }),
    "order.succeeded": () => orderFixture({
        status: "success",
        paymentTime: ORDER_PAYMENT_TIME,
        paymentExecutionDetails: null,
        riskLevel: "low",
    }),
    "order.failed": () => orderFixture({
        status: "failed",
        paymentTime: ORDER_PAYMENT_TIME,
        paymentExecutionDetails: [
            {
                channelCode: "CARD",
                originalFailureCode: "card_declined",
                originalFailureMessage: "The payment method was declined in the local fixture.",
            },
        ],
        riskLevel: "high",
    }),
    "refund.succeeded": () => refundFixture(),
    "subscription.created": () => subscriptionFixture({
        status: "incomplete",
        recurringInvoiceItem: null,
        upcomingInvoiceItem: recurringInvoiceItem(),
    }),
    "subscription.trialing": () => subscriptionFixture({ status: "free_trial", trialStart: TRIAL_START, trialEnd: TRIAL_END }),
    "subscription.activated": () => subscriptionFixture({ status: "active" }),
    "subscription.incomplete_expired": () => subscriptionFixture({
        status: "incomplete_expired",
        recurringInvoiceItem: null,
        upcomingInvoiceItem: recurringInvoiceItem(),
    }),
    "subscription.past_due": () => subscriptionFixture({ status: "past_due", elapsedCycles: 1 }),
    "subscription.cancelled": () => subscriptionFixture({
        status: "cancelled",
        cancelAt: CANCELLED_AT,
        cancelAtPeriodEnd: false,
        canceledAt: CANCELLED_AT,
        cancelReason: "requested_by_customer",
        elapsedCycles: 1,
    }),
    "subscription.updated.plan_changed": () => subscriptionFixture({ status: "active", priceId: "price_test_456", priceSnapshotId: "price_snapshot_test_456" }),
    "subscription.updated.plan_change_canceled": () => subscriptionFixture({ status: "active" }),
    "subscription.updated.renewed": () => subscriptionFixture({ status: "active", currentPeriodStart: NEXT_PERIOD_START, currentPeriodEnd: NEXT_PERIOD_END, elapsedCycles: 1 }),
    "subscription.updated.cancel_at_period_end_set": () => subscriptionFixture({ status: "active", cancelAtPeriodEnd: true, cancelAt: CURRENT_PERIOD_END }),
    "subscription.updated.cancel_at_period_end_revoked": () => subscriptionFixture({ status: "active", cancelAtPeriodEnd: false, cancelAt: null }),
    "invoice.open": () => invoiceFixture({ status: "open", paymentAmount: "19.99", orderId: null }),
    "invoice.paid": () => invoiceFixture({ status: "paid", paymentAmount: "19.99", orderId: "order_test_123" }),
    "invoice.void": () => invoiceFixture({ status: "void", paymentAmount: "0.00", orderId: null }),
    "dispute.created": () => disputeFixture(),
};
function assertFixtureType(type) {
    if (WEBHOOK_FIXTURE_TYPES.includes(type))
        return type;
    throw new Error(`Unsupported webhook fixture type "${type}". Supported types: ${WEBHOOK_FIXTURE_TYPES.join(", ")}.`);
}
function fixtureEventId(type, prefix) {
    return `${prefix}_${type.replace(/[^a-z0-9]+/gi, "_")}_test`;
}
function recurringInvoiceItem(options = {}) {
    return {
        invoiceItemId: "invoice_item_test_123",
        amount: "19.99",
        discountAmount: null,
        paymentAmount: "19.99",
        couponTerms: null,
        promotionCode: null,
        description: "Local webhook test plan",
        currency: "USD",
        periodStart: CURRENT_PERIOD_START,
        periodEnd: CURRENT_PERIOD_END,
        proration: null,
        price: {
            productId: "prd_test_123",
            productName: "Local webhook test plan",
            priceId: options.priceId ?? "price_test_123",
            priceSnapshotId: options.priceSnapshotId ?? "price_snapshot_test_123",
            unitAmount: "19.99",
            quantity: 1,
            recurring: {
                interval: "month",
                intervalCount: 1,
                pricingModel: "flat_rate",
                tiersMode: null,
                trialPeriodDays: null,
            },
        },
    };
}
function invoiceItems() {
    return [recurringInvoiceItem()];
}
function baseMetadata() {
    return {
        environment: "local",
        source: "clink-integ-cli",
    };
}
function sessionFixture(values) {
    return {
        sessionId: "sess_test_123",
        token: "tok_test_123",
        status: values.status,
        paymentStatus: values.paymentStatus,
        originalCurrency: "USD",
        paymentCurrency: null,
        amountSubtotal: 19.99,
        amountTotal: null,
        subscriptionId: null,
        invoiceId: null,
        orderId: null,
        merchantReferenceId: "merchant_order_test_123",
        customer: null,
        locale: null,
        uiMode: "hostedPage",
        returnUrl: null,
        successUrl: "https://merchant.example/success",
        cancelUrl: "https://merchant.example/cancel",
        created: CHECKOUT_CREATED_AT,
        expire: values.expiresAt,
        product: null,
        price: {
            priceId: null,
            priceList: null,
            recurring: null,
        },
        priceDataList: null,
        showPromotionCode: false,
        metadata: {},
    };
}
function orderFixture(values) {
    return {
        orderId: "order_test_123",
        type: "recurring",
        status: values.status,
        merchantReferenceId: "merchant_order_test_123",
        sessionId: "sess_test_123",
        invoiceId: "inv_test_123",
        customerId: "cus_test_123",
        customerEmail: "test@example.com",
        productId: "prd_test_123",
        priceId: "price_test_123",
        priceDataList: null,
        paymentMethod: {
            paymentMethodType: "CARD",
            paymentInstrumentId: "pi_test_123",
            cardLastFour: "4242",
            cardScheme: "VISA",
            issuerBank: "Test Bank",
            issuerRegion: "US",
            wallet: null,
        },
        paymentExecutionDetails: values.paymentExecutionDetails,
        amountSubtotal: 19.99,
        amountTotal: 19.99,
        paymentCurrency: "USD",
        originalCurrency: "USD",
        paymentTime: values.paymentTime,
        metadata: {},
        riskLevel: values.riskLevel,
    };
}
function subscriptionFixture(values) {
    const priceId = values.priceId ?? "price_test_123";
    const priceSnapshotId = values.priceSnapshotId ?? "price_snapshot_test_123";
    return {
        merchantReference: "merchant_subscription_test_123",
        subscriptionId: "sub_test_123",
        sessionId: "sess_test_123",
        customerId: "cus_test_123",
        productId: "prd_test_123",
        priceId,
        priceSnapshotId,
        createTime: SUBSCRIPTION_CREATED_AT,
        quantity: 1,
        paymentMethodType: "CARD",
        paymentInstrumentId: "pi_test_123",
        trialStart: values.trialStart ?? null,
        trialEnd: values.trialEnd ?? null,
        currentPeriodStart: values.currentPeriodStart ?? CURRENT_PERIOD_START,
        currentPeriodEnd: values.currentPeriodEnd ?? CURRENT_PERIOD_END,
        cancelAt: values.cancelAt ?? null,
        cancelAtPeriodEnd: values.cancelAtPeriodEnd ?? null,
        canceledAt: values.canceledAt ?? null,
        cancelReason: values.cancelReason ?? null,
        status: values.status,
        billing: "charge_automatically",
        currency: "USD",
        recurringInvoiceItem: values.recurringInvoiceItem === undefined
            ? recurringInvoiceItem({ priceId, priceSnapshotId })
            : values.recurringInvoiceItem,
        upcomingInvoiceItem: values.upcomingInvoiceItem ?? null,
        scheduledPhases: null,
        elapsedCycles: values.elapsedCycles ?? null,
        metadata: null,
    };
}
function invoiceFixture(values) {
    return {
        invoiceId: "inv_test_123",
        subscriptionId: "sub_test_123",
        merchantReference: "merchant_subscription_test_123",
        orderId: values.orderId,
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
        discount: null,
        metadata: null,
    };
}
function refundFixture() {
    return {
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
function disputeFixture() {
    return {
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
function resourceObjectForType(type) {
    if (type.startsWith("session."))
        return "checkout.session";
    return type.split(".")[0];
}
function toLegacyResource(resource) {
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
    ]) {
        if (typeof legacy[field] === "number") {
            legacy[field] = new Date(legacy[field]).toISOString();
        }
    }
    return legacy;
}
//# sourceMappingURL=fixtures.js.map