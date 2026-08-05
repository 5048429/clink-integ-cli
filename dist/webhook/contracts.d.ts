import type { components } from "../openapi/clink.openapi.js";
/**
 * Canonical envelope delivered to merchant webhook endpoints.
 *
 * Resource-specific types below intentionally do not reuse the generated
 * OpenAPI event envelope. The public schema can lag production serialization
 * details such as decimal values encoded as JSON strings.
 */
export interface MerchantWebhookEvent<TType extends string = string, TObject extends Record<string, unknown> = Record<string, unknown>> {
    id: string;
    object: "event";
    created: number;
    type: TType;
    data: {
        object: TObject;
    };
}
export type InvoiceItemRecurringWebhookObject = {
    interval: string;
    trialPeriodDays: number | null;
    pricingModel: string;
    tiersMode: string | null;
    intervalCount: number | null;
};
export type InvoiceItemPriceWebhookObject = {
    productId: string | null;
    productName: string | null;
    priceId: string | null;
    priceSnapshotId: string | null;
    unitAmount: string | null;
    quantity: number | null;
    recurring: InvoiceItemRecurringWebhookObject | null;
};
export type InvoiceItemWebhookObject = {
    invoiceItemId: string | null;
    amount: string | null;
    discountAmount: string | null;
    paymentAmount: string | null;
    couponTerms: string | null;
    promotionCode: string | null;
    currency: string | null;
    description: string | null;
    periodStart: number | null;
    periodEnd: number | null;
    proration: boolean | null;
    price: InvoiceItemPriceWebhookObject | null;
};
export type InvoiceWebhookObject = {
    invoiceId: string | null;
    subscriptionId: string | null;
    merchantReference: string | null;
    orderId: string | null;
    customerId: string | null;
    merchantId: string | null;
    status: string | null;
    createTime: number | null;
    currentPeriodStart: number | null;
    currentPeriodEnd: number | null;
    originalAmount: string | null;
    paymentAmount: string | null;
    originalCurrency: string | null;
    billing: string | null;
    items: InvoiceItemWebhookObject[];
    discount: Record<string, unknown> | null;
    metadata: Record<string, string> | null;
};
export type SubscriptionWebhookObject = {
    merchantReference: string | null;
    subscriptionId: string;
    sessionId: string | null;
    customerId: string;
    productId: string;
    priceId: string;
    priceSnapshotId: string;
    createTime: number | null;
    quantity: number | null;
    paymentMethodType: string | null;
    paymentInstrumentId: string | null;
    trialStart: number | null;
    trialEnd: number | null;
    currentPeriodStart: number | null;
    currentPeriodEnd: number | null;
    cancelAt: number | null;
    cancelAtPeriodEnd: boolean | null;
    canceledAt: number | null;
    cancelReason: string | null;
    status: string;
    billing: string;
    currency: string | null;
    recurringInvoiceItem: InvoiceItemWebhookObject | null;
    upcomingInvoiceItem: InvoiceItemWebhookObject | null;
    scheduledPhases: components["schemas"]["ScheduledPhase"][] | null;
    elapsedCycles: number | null;
    metadata: Record<string, string> | null;
};
