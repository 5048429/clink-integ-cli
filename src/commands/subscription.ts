import type { Command } from "commander";
import type { SubscriptionCreatePayload, SubscriptionCreateResponse } from "../api/openapi-types.js";
import { curlForJsonRequest } from "../curl.js";
import { printResult } from "../output.js";
import { buildUrl, collect, getCommandContext, parseMetadata } from "./helpers.js";

export function registerSubscription(program: Command): void {
  const subscription = program.command("subscription").description("Create and manage subscriptions");

  subscription
    .command("get <subscription-id>")
    .description("Get subscription details")
    .action(async function (this: Command, subscriptionId: string) {
      const { config, client } = await getCommandContext(this);
      const result = await client.get(`/subscription/${encodeURIComponent(subscriptionId)}`);
      printResult(result, config.outputMode);
    });

  subscription
    .command("create")
    .description("Create a subscription with an existing payment instrument")
    .requiredOption("--product-id <id>", "Product ID")
    .requiredOption("--price-id <id>", "Recurring price ID")
    .requiredOption("--payment-instrument-id <id>", "Payment instrument ID")
    .requiredOption("--payment-currency <currency>", "Payment currency")
    .requiredOption("--return-url <url>", "Return URL for required payment actions")
    .option("--customer-id <id>", "Existing Clink customer ID")
    .option("--customer-email <email>", "Customer email")
    .option("--reference-customer-id <id>", "Merchant-side customer ID")
    .option("--merchant-reference-id <id>", "Merchant reference ID")
    .option("--payment-method-type <type>", "CARD or GCASH", "CARD")
    .option("--metadata <key=value...>", "Metadata entry", collect, [])
    .action(async (options: {
      productId: string;
      priceId: string;
      paymentInstrumentId: string;
      paymentCurrency: string;
      returnUrl: string;
      customerId?: string;
      customerEmail?: string;
      referenceCustomerId?: string;
      merchantReferenceId?: string;
      paymentMethodType: string;
      metadata: string[];
    }, command: Command) => {
      const { config, client } = await getCommandContext(command);
      const body: SubscriptionCreatePayload = {
        customerId: options.customerId,
        customerEmail: options.customerEmail,
        referenceCustomerId: options.referenceCustomerId,
        merchantReferenceId: options.merchantReferenceId,
        productId: options.productId,
        priceId: options.priceId,
        paymentInstrumentId: options.paymentInstrumentId,
        paymentMethodType: options.paymentMethodType as SubscriptionCreatePayload["paymentMethodType"],
        paymentCurrency: options.paymentCurrency.toUpperCase(),
        returnUrl: options.returnUrl,
        metadata: parseMetadata(options.metadata),
      };
      const result = await client.post<SubscriptionCreateResponse, SubscriptionCreatePayload>("/subscription", { body });
      const url = buildUrl(config.baseUrl, "/subscription");
      printResult(
        {
          result,
          curl: curlForJsonRequest("POST", url, body),
        },
        config.outputMode,
        "Subscription create request completed. Use --json to view the full response and curl example.",
      );
    });

  subscription
    .command("cancel <subscription-id>")
    .description("Cancel a subscription")
    .requiredOption("--reason <reason>", "Cancellation reason")
    .option("--reason-code <code>", "Cancel reason code, for example no_longer_needed")
    .option("--immediately", "Cancel immediately without refund")
    .action(async (
      subscriptionId: string,
      options: { reason: string; reasonCode?: string; immediately?: boolean },
      command: Command,
    ) => {
      const { config, client } = await getCommandContext(command);
      const path = `/subscription/${encodeURIComponent(subscriptionId)}/cancel`;
      const body = {
        reason: options.reason,
        cancelReasonCode: options.reasonCode,
        cancelImmediately: Boolean(options.immediately),
      };
      const result = await client.post(path, { body });
      printResult(
        {
          result,
          curl: curlForJsonRequest("POST", buildUrl(config.baseUrl, path), body),
        },
        config.outputMode,
        "Subscription cancel request completed. Use --json to view the full response and curl example.",
      );
    });
}
