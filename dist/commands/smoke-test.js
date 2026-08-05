import { printResult } from "../output.js";
import { createWebhookFixture } from "../webhook/fixtures.js";
import { signWebhookPayload } from "../webhook/signature.js";
import { getCommandContext } from "./helpers.js";
export function registerSmokeTest(program) {
    program
        .command("smoke-test")
        .description("Run a minimal checkout and optional webhook smoke test")
        .option("--customer-email <email>", "Customer email", "test@example.com")
        .option("--amount <amount>", "Checkout amount", "1")
        .option("--currency <currency>", "Checkout currency", "USD")
        .option("--name <name>", "Inline product name", "CLI Smoke Test Product")
        .option("--merchant-reference-id <id>", "Merchant order/reference ID. Defaults to smoke-<timestamp>.")
        .option("--success-url <url>", "Success URL", "http://localhost:3000/success")
        .option("--cancel-url <url>", "Cancel URL", "http://localhost:3000/cancel")
        .option("--webhook-url <url>", "Optional local webhook URL to receive a signed fixture")
        .action(async (options, command) => {
        const { config, client } = await getCommandContext(command);
        const steps = [];
        const merchantReferenceId = options.merchantReferenceId ?? `smoke-${Date.now()}`;
        const checkoutBody = {
            customerEmail: options.customerEmail,
            originalAmount: Number(options.amount),
            originalCurrency: options.currency.toUpperCase(),
            merchantReferenceId,
            successUrl: options.successUrl,
            cancelUrl: options.cancelUrl,
            uiMode: "hostedPage",
            priceDataList: [
                {
                    name: options.name,
                    quantity: 1,
                    unitAmount: Number(options.amount),
                    currency: options.currency.toUpperCase(),
                },
            ],
        };
        const checkout = await client.post("/checkout/session", { body: checkoutBody });
        const sessionId = extractDataString(checkout, "sessionId");
        steps.push({ name: "checkout_session", ok: true, merchantReferenceId, sessionId, result: checkout });
        if (options.webhookUrl) {
            if (!config.webhookSigningKey) {
                steps.push({ name: "webhook_simulation", ok: false, error: "Missing CLINK_WEBHOOK_SIGNING_KEY" });
            }
            else {
                const event = withSmokeReconciliationFields(createWebhookFixture("order.succeeded"), {
                    merchantReferenceId,
                    sessionId,
                });
                const rawBody = JSON.stringify(event);
                const timestamp = String(Date.now());
                const signature = signWebhookPayload(config.webhookSigningKey, timestamp, rawBody);
                const response = await fetch(options.webhookUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-Clink-Timestamp": timestamp,
                        "X-Clink-Signature": signature,
                    },
                    body: rawBody,
                });
                steps.push({
                    name: "webhook_simulation",
                    ok: response.ok,
                    status: response.status,
                    body: await response.text(),
                });
            }
        }
        const ok = steps.every((step) => typeof step === "object" && step !== null && step.ok);
        const realPaymentVerification = realPaymentVerificationChecklist();
        printResult({ ok, steps, realPaymentVerification }, config.outputMode, ok
            ? `Smoke test passed. Real payment is not complete until the merchant order is paid and fulfillment/entitlement is complete.`
            : "Smoke test completed with failures");
        if (!ok)
            process.exitCode = 1;
    });
}
export function withSmokeReconciliationFields(event, values) {
    const data = event.data && typeof event.data === "object" ? event.data : {};
    const resource = data.object && typeof data.object === "object" ? data.object : {};
    event.data = {
        ...data,
        object: {
            ...resource,
            merchantReferenceId: values.merchantReferenceId,
            sessionId: values.sessionId ?? resource.sessionId,
        },
    };
    return event;
}
function extractDataString(result, key) {
    if (!result || typeof result !== "object")
        return undefined;
    const root = result;
    const data = root.data && typeof root.data === "object" ? root.data : undefined;
    const value = data?.[key] ?? root[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
function realPaymentVerificationChecklist() {
    return [
        "Open the real sandbox checkoutUrl and complete a sandbox payment.",
        "Confirm the webhook handler returns 200 after signature verification.",
        "Confirm the local order matched by both merchantReferenceId and sessionId is marked paid/completed.",
        "Confirm entitlement, credits, download access, shipment, or other merchant fulfillment is completed.",
    ];
}
//# sourceMappingURL=smoke-test.js.map