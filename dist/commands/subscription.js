import { curlForJsonRequest } from "../curl.js";
import { printResult } from "../output.js";
import { buildUrl, collect, getCommandContext, parseMetadata } from "./helpers.js";
export function registerSubscription(program) {
    const subscription = program.command("subscription").description("Create and manage subscriptions");
    subscription
        .command("get <subscription-id>")
        .description("Get subscription details")
        .action(async function (subscriptionId) {
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
        .action(async (options, command) => {
        const { config, client } = await getCommandContext(command);
        const body = {
            customerId: options.customerId,
            customerEmail: options.customerEmail,
            referenceCustomerId: options.referenceCustomerId,
            merchantReferenceId: options.merchantReferenceId,
            productId: options.productId,
            priceId: options.priceId,
            paymentInstrumentId: options.paymentInstrumentId,
            paymentMethodType: options.paymentMethodType,
            paymentCurrency: options.paymentCurrency.toUpperCase(),
            returnUrl: options.returnUrl,
            metadata: parseMetadata(options.metadata),
        };
        const result = await client.post("/subscription", { body });
        const url = buildUrl(config.baseUrl, "/subscription");
        printResult({
            result,
            curl: curlForJsonRequest("POST", url, body),
        }, config.outputMode, "Subscription create request completed. Use --json to view the full response and curl example.");
    });
    subscription
        .command("cancel <subscription-id>")
        .description("Cancel a subscription")
        .requiredOption("--reason <reason>", "Cancellation reason")
        .option("--reason-code <code>", "Cancel reason code, for example no_longer_needed")
        .option("--immediately", "Cancel immediately without refund")
        .action(async (subscriptionId, options, command) => {
        const { config, client } = await getCommandContext(command);
        const path = `/subscription/${encodeURIComponent(subscriptionId)}/cancel`;
        const body = {
            reason: options.reason,
            cancelReasonCode: options.reasonCode,
            cancelImmediately: Boolean(options.immediately),
        };
        const result = await client.post(path, { body });
        printResult({
            result,
            curl: curlForJsonRequest("POST", buildUrl(config.baseUrl, path), body),
        }, config.outputMode, "Subscription cancel request completed. Use --json to view the full response and curl example.");
    });
}
//# sourceMappingURL=subscription.js.map