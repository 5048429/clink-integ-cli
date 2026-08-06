import type { components } from "../openapi/clink.openapi.js";

/**
 * Canonical envelope delivered to merchant webhook endpoints.
 *
 * Resource-specific types below intentionally do not reuse the generated
 * OpenAPI event envelope. The public schema can lag production serialization
 * details such as decimal values encoded as JSON strings.
 */
export interface MerchantWebhookEvent<
  TType extends string = string,
  TObject extends Record<string, unknown> = Record<string, unknown>,
> {
  id: string;
  object: "event";
  created: number;
  type: TType;
  data: {
    object: TObject;
  };
}

export type OrderPaymentMethodWebhookObject = {
  paymentMethodType: string | null;
  paymentInstrumentId: string | null;
  cardScheme: string | null;
  cardLastFour: string | null;
  issuerRegion: string | null;
  issuerBank: string | null;
  wallet: Record<string, unknown> | null;
};

/** Production-serialized Order resource delivered inside data.object. */
export type OrderWebhookObject = {
  orderId: string;
  type: string | null;
  sessionId: string | null;
  merchantReferenceId: string | null;
  invoiceId: string | null;
  customerId: string | null;
  customerEmail: string | null;
  productId: string | null;
  priceId: string | null;
  priceDataList: Record<string, unknown>[] | null;
  paymentMethod: OrderPaymentMethodWebhookObject | null;
  paymentExecutionDetails: Record<string, unknown>[] | null;
  amountSubtotal: number | null;
  amountTotal: number | null;
  paymentCurrency: string | null;
  originalCurrency: string | null;
  status: string;
  failureCode?: string | null;
  failureMessage?: string | null;
  paymentTime: number | null;
  metadata: Record<string, unknown> | null;
  riskLevel: string | null;
};

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

/**
 * Canonical dispute resource delivered to merchant webhook endpoints.
 *
 * This intentionally does not reuse the generated ChargeBackWebhookVo:
 * production filters channelCode and serializes Java Date values as Unix
 * milliseconds rather than OpenAPI's current date-time strings.
 */
export type DisputeWebhookObject = {
  chargeBackId: string | null;
  orderId: string | null;
  merchantReferenceId: string | null;
  merchantId: string | null;
  customerId: string | null;
  disputeAmount: number | null;
  disputeCurrency: string | null;
  originalAmount: number | null;
  originalCurrency: string | null;
  reasonCode: string | null;
  reasonDescription: string | null;
  status: 1 | 2 | 3 | 4 | 5 | null;
  evidenceDeadline: number | null;
  channelDisputeTime: number | null;
  networkReasonCode: string | null;
};

export type PaymentMethodType =
  | "CARD"
  | NonNullable<components["schemas"]["PaymentInstrumentApiVo"]["type"]>;

export type PaymentMethodBillingAddressWebhookObject = {
  city: string | null;
  country: string | null;
  line1: string | null;
  line2: string | null;
  postalCode: string | null;
  state: string | null;
};

export type PaymentMethodCardWebhookObject = {
  last4: string | null;
  name: string | null;
  expiryYear: string | null;
  expiryMonth: string | null;
  scheme: string | null;
  funding: string | null;
  issuerRegion: string | null;
  issuerBank: string | null;
  billingAddress: PaymentMethodBillingAddressWebhookObject | null;
};

export type PaymentMethodWalletWebhookObject = {
  accountTag: string | null;
};

/** Canonical PaymentInstrumentApiVo direction used by merchant webhooks. */
export type PaymentMethodWebhookObject = {
  id: string | null;
  customerId: string | null;
  type: PaymentMethodType;
  card: PaymentMethodCardWebhookObject | null;
  wallet: PaymentMethodWalletWebhookObject | null;
  created: number | null;
  visaRegistrationSucceeded?: boolean;
};
