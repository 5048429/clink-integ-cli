import type { components, paths } from "../openapi/clink.openapi.js";
import type {
  DisputeWebhookObject,
  InvoiceWebhookObject,
  MerchantWebhookEvent,
  PaymentMethodWebhookObject,
  SubscriptionWebhookObject,
} from "../webhook/contracts.js";

export type {
  DisputeWebhookObject,
  InvoiceItemPriceWebhookObject,
  InvoiceItemRecurringWebhookObject,
  InvoiceItemWebhookObject,
  InvoiceWebhookObject,
  MerchantWebhookEvent,
  PaymentMethodBillingAddressWebhookObject,
  PaymentMethodCardWebhookObject,
  PaymentMethodType,
  PaymentMethodWalletWebhookObject,
  PaymentMethodWebhookObject,
  SubscriptionWebhookObject,
} from "../webhook/contracts.js";

type JsonRequestBody<Operation> = Operation extends { requestBody?: infer RequestBody }
  ? NonNullable<RequestBody> extends { content: { "application/json": infer Body } }
    ? Body
    : never
  : never;

type JsonResponseBody<Operation> = Operation extends { responses: { 200: { content: infer Content } } }
  ? Content extends { "application/json": infer Body }
    ? Body
    : Content extends { "*/*": infer Body }
      ? Body
      : never
  : never;

type QueryParameters<Operation> = Operation extends { parameters: { query?: infer Query } } ? NonNullable<Query> : never;

export type ProductCreatePayload = JsonRequestBody<paths["/product"]["post"]>;
export type ProductCreateResponse = JsonResponseBody<paths["/product"]["post"]>;
export type ProductListQuery = QueryParameters<paths["/product"]["get"]>;
export type ProductListResponse = JsonResponseBody<paths["/product"]["get"]>;
export type ProductImageUploadResponse = components["schemas"]["ProductImageUploadResponse"];

export type PriceCreatePayload = JsonRequestBody<paths["/price"]["post"]>;
export type PriceCreateResponse = JsonResponseBody<paths["/price"]["post"]>;
export type PriceListQuery = QueryParameters<paths["/price"]["get"]>;
export type PriceListResponse = JsonResponseBody<paths["/price"]["get"]>;

export type CheckoutSessionCreatePayload = JsonRequestBody<paths["/checkout/session"]["post"]>;
export type CheckoutSessionCreateResponse = JsonResponseBody<paths["/checkout/session"]["post"]>;

export type SubscriptionCreatePayload = JsonRequestBody<paths["/subscription"]["post"]>;
export type SubscriptionCreateResponse = JsonResponseBody<paths["/subscription"]["post"]>;

export type RefundCreatePayload = JsonRequestBody<paths["/refund"]["post"]>;
export type RefundCreateResponse = JsonResponseBody<paths["/refund"]["post"]>;

type GeneratedEventType<TSchema extends keyof components["schemas"]> = NonNullable<
  components["schemas"][TSchema] extends { type?: infer TType } ? TType : never
> & string;

export type OrderWebhookEvent = MerchantWebhookEvent<
  GeneratedEventType<"EventOrderVo">,
  components["schemas"]["OrderApiVo"]
>;
export type SessionWebhookEvent = MerchantWebhookEvent<
  GeneratedEventType<"EventSessionVo">,
  components["schemas"]["SessionApiVo"]
>;
export type RefundWebhookEvent = MerchantWebhookEvent<
  GeneratedEventType<"EventRefundVo">,
  components["schemas"]["RefundApiVo"]
>;
export type SubscriptionWebhookEvent = MerchantWebhookEvent<
  GeneratedEventType<"EventSubVo">,
  SubscriptionWebhookObject
>;
export type InvoiceWebhookEvent = MerchantWebhookEvent<
  GeneratedEventType<"EventInvoiceVo">,
  InvoiceWebhookObject
>;
export type CustomerVerifyWebhookEvent = MerchantWebhookEvent<
  GeneratedEventType<"EventCustomerVerifyVo">,
  NonNullable<components["schemas"]["CustomerVerifyDataVo"]["object"]>
>;
export type DisputeWebhookEvent = MerchantWebhookEvent<
  GeneratedEventType<"EventDisputeVo">,
  DisputeWebhookObject
>;
export type ChargeBackWebhook = components["schemas"]["ChargeBackWebhookVo"];
export type PaymentMethodWebhookEvent = MerchantWebhookEvent<
  "payment_method.added" | "payment_method.default_change" | "payment_method.update",
  PaymentMethodWebhookObject
>;

export type ClinkWebhookEvent =
  | OrderWebhookEvent
  | SessionWebhookEvent
  | RefundWebhookEvent
  | SubscriptionWebhookEvent
  | InvoiceWebhookEvent
  | CustomerVerifyWebhookEvent
  | DisputeWebhookEvent
  | PaymentMethodWebhookEvent;

export type ClinkWebhookEventType = ClinkWebhookEvent["type"];
