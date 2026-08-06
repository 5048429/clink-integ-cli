/**
 * Resource-only JSON text extracted from the supplied internal-Agent transcript.
 *
 * These values are not complete Merchant Webhook request bodies. The playback
 * test synthesizes the canonical event envelope, test signature, and localhost
 * HTTP delivery. Keep each template value byte-for-byte stable: UTF-8, LF, and
 * no trailing newline inside the template string.
 */
export const GOLDEN_RESOURCE_BODIES = {
  "order.failed": `{
  "orderId": "order_mocked219d5b63",
  "type": "onetime",
  "sessionId": "sess_mocked79a4f29d",
  "merchantReferenceId": "null",
  "invoiceId": null,
  "customerId": "cus_mockede7e2d6e9",
  "customerEmail": "mocked_user@example.com",
  "productId": "prd_mockedc782c278",
  "priceId": "price_mocked6c510cb6",
  "priceDataList": null,
  "paymentMethod": {
    "paymentMethodType": "CARD",
    "paymentInstrumentId": "pi_mockedefd74f04",
    "cardScheme": "Mastercard",
    "cardLastFour": "1003",
    "issuerRegion": "USA",
    "issuerBank": "NORTHERN BANK &TRUST COMPANY",
    "wallet": null
  },
  "paymentExecutionDetails": null,
  "amountSubtotal": 2,
  "amountTotal": 2,
  "paymentCurrency": "USD",
  "originalCurrency": "USD",
  "status": "failed",
  "failureCode": "processor_communication_error",
  "failureMessage": "The payment processor is temporarily unavailable. Please try again later.",
  "paymentTime": 1785936113600,
  "metadata": {},
  "riskLevel": "LOW"
}`,
  "refund.succeeded": `{
  "createTime": 1785921704850,
  "refundId": "rfd_mocked93231457",
  "refundMerchantOrderId": "rf_mockedd8717702",
  "orderId": "order_mockedd7f96882",
  "customerId": "cus_mocked19900738",
  "refundAmount": 227.91,
  "refundCurrency": "USD",
  "status": "success",
  "refundReason": "Customer Initiated Refund",
  "paymentInstrumentId": "pi_mocked0ae4aa5d",
  "metadata": {}
}`,
  "subscription.past_due": `{
  "merchantReference": "mcht_mocked2245efa1",
  "subscriptionId": "sub_mockede15c4525",
  "sessionId": "sess_mockedef304bc6",
  "customerId": "cus_mocked48052d85",
  "productId": "prd_mockedda32ac62",
  "priceId": "price_mockedae714e9d",
  "priceSnapshotId": "pricesns_mockedef3e3f72",
  "createTime": 1772542049186,
  "quantity": 1,
  "paymentMethodType": "paypal",
  "paymentInstrumentId": "pi_mocked93b3a666",
  "trialStart": null,
  "trialEnd": null,
  "currentPeriodStart": 1772542049024,
  "currentPeriodEnd": 1785761249024,
  "cancelAt": null,
  "cancelAtPeriodEnd": null,
  "canceledAt": null,
  "cancelReason": null,
  "status": "past_due",
  "billing": "charge_automatically",
  "currency": "USD",
  "recurringInvoiceItem": {
    "invoiceItemId": "ii_mocked363624e9",
    "amount": "20",
    "discountAmount": null,
    "paymentAmount": "20",
    "couponTerms": null,
    "promotionCode": null,
    "currency": "USD",
    "description": "订阅商品-20usd每月",
    "periodStart": 1783082849024,
    "periodEnd": 1785761249024,
    "proration": null,
    "price": {
      "productId": "prd_mockedda32ac62",
      "productName": "订阅商品-20usd每月",
      "priceId": "price_mockedae714e9d",
      "priceSnapshotId": "pricesns_mockedef3e3f72",
      "unitAmount": "20.00",
      "quantity": 1,
      "recurring": {
        "interval": "month",
        "intervalCount": null,
        "trialPeriodDays": 0,
        "pricingModel": "flat_rate",
        "tiersMode": null
      }
    }
  },
  "upcomingInvoiceItem": {
    "invoiceItemId": "ii_mockedde3523dc",
    "amount": "20",
    "discountAmount": null,
    "paymentAmount": "20",
    "couponTerms": null,
    "promotionCode": null,
    "currency": "USD",
    "description": "订阅商品-20usd每月",
    "periodStart": 1785761249024,
    "periodEnd": 1788439649024,
    "proration": null,
    "price": {
      "productId": "prd_mockedda32ac62",
      "productName": "订阅商品-20usd每月",
      "priceId": "price_mockedae714e9d",
      "priceSnapshotId": "pricesns_mockedef3e3f72",
      "unitAmount": "20.00",
      "quantity": 1,
      "recurring": {
        "interval": "month",
        "intervalCount": null,
        "trialPeriodDays": 0,
        "pricingModel": "flat_rate",
        "tiersMode": null
      }
    }
  },
  "scheduledPhases": null,
  "elapsedCycles": 2,
  "metadata": {}
}`,
  "invoice.void": `{
  "invoiceId": "inv_mockedb160aa59",
  "subscriptionId": "sub_mocked48b5fbb8",
  "merchantReference": "mcht_mocked2245efa1",
  "orderId": "order_mocked9325bc45",
  "customerId": "cus_mocked1f8acbe4",
  "merchantId": "mcht_mocked2251a688",
  "status": "void",
  "createTime": 1785760824957,
  "currentPeriodStart": 1785760903339,
  "currentPeriodEnd": 1786020103339,
  "originalAmount": "0.00",
  "paymentAmount": "0.00",
  "originalCurrency": "USD",
  "billing": "charge_automatically",
  "items": [
    {
      "invoiceItemId": "ii_mocked0266caf2",
      "amount": "0",
      "discountAmount": null,
      "paymentAmount": "0",
      "couponTerms": null,
      "promotionCode": null,
      "currency": "USD",
      "description": "订阅商品-10usd试用3天",
      "periodStart": 1785760903339,
      "periodEnd": 1786020103339,
      "proration": null,
      "price": {
        "productId": "prd_mocked12446e64",
        "productName": "订阅商品-10usd试用3天",
        "priceId": "price_mockeda19f5e68",
        "priceSnapshotId": "pricesns_mocked82c8ede5",
        "unitAmount": "10",
        "quantity": 1,
        "recurring": {
          "interval": "month",
          "intervalCount": null,
          "trialPeriodDays": 3,
          "pricingModel": "flat_rate",
          "tiersMode": null
        }
      }
    }
  ],
  "discount": null,
  "metadata": null
}`,
  "dispute.created": `{
  "chargeBackId": "cbi_mocked0af12e76",
  "orderId": "order_mocked7e4314de",
  "merchantReferenceId": " ",
  "merchantId": "mcht_mocked0a356c2e",
  "customerId": "cus_mocked876693e2",
  "disputeAmount": 10.46,
  "disputeCurrency": "USD",
  "originalAmount": 10.46,
  "originalCurrency": "USD",
  "reasonCode": "10.4",
  "reasonDescription": "fraudulent",
  "status": 1,
  "evidenceDeadline": 1787680800000,
  "channelDisputeTime": 1785888000000,
  "networkReasonCode": "10.4"
}`,
} as const;

export type GoldenWebhookType = keyof typeof GOLDEN_RESOURCE_BODIES;
