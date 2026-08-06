import { spawn } from "node:child_process";
import { curlForJsonRequest } from "../curl.js";
import { parseIntegerOption, parseNumberOption, printResult, requireOption } from "../output.js";
import { buildUrl, getCommandContext } from "./helpers.js";
export function registerCheckout(program) {
    const checkout = program.command("checkout").description("Create checkout sessions");
    checkout
        .command("get <session-id-or-url>")
        .description("Get checkout session details")
        .action(async function (sessionIdOrUrl) {
        const { config, client } = await getCommandContext(this);
        const sessionId = normalizeCheckoutSessionId(sessionIdOrUrl);
        const result = await client.get(`/checkout/session/${encodeURIComponent(sessionId)}`);
        printResult({
            sessionId,
            result,
        }, config.outputMode);
    });
    checkout
        .command("create")
        .description("Create a checkout session using either product/price IDs or inline price data")
        .option("--customer-id <id>", "Existing Clink customer ID")
        .option("--customer-email <email>", "Customer email")
        .option("--reference-customer-id <id>", "Merchant-side customer ID")
        .requiredOption("--amount <amount>", "Original total amount; required for registered and inline checkout")
        .requiredOption("--currency <currency>", "Original currency; required for registered and inline checkout, for example USD")
        .option("--name <name>", "Inline one-time product name")
        .option("--unit-amount <amount>", "Inline product unit amount. Defaults to amount / quantity.")
        .option("--quantity <number>", "Inline one-time product quantity", "1")
        .option("--image-url <url>", "Inline product image URL")
        .option("--product-id <id>", "Registered product ID")
        .option("--price-id <id>", "Registered price ID")
        .option("--merchant-reference-id <id>", "Merchant order/reference ID")
        .option("--success-url <url>", "Success redirect URL")
        .option("--cancel-url <url>", "Cancel redirect URL")
        .option("--ui-mode <mode>", "hostedPage or elements", "hostedPage")
        .option("--return-url <url>", "Return URL for elements mode")
        .option("--payment-method-type <type>", "Default payment method type")
        .option("--allow-promotion-codes", "Enable promotion code entry")
        .option("--promotion-code <code>", "Pre-filled promotion code")
        .option("--open", "Open the hosted checkout URL after creation")
        .action(async (options, command) => {
        const { config, client } = await getCommandContext(command);
        const { body, mode } = buildCheckoutPayload(options);
        const result = await client.post("/checkout/session", { body });
        const url = buildUrl(config.baseUrl, "/checkout/session");
        const checkoutUrl = extractCheckoutUrl(result);
        if (options.open && checkoutUrl && !config.dryRun) {
            openUrl(checkoutUrl);
        }
        printResult({
            mode,
            checkoutUrl,
            sessionId: extractSessionId(result),
            result,
            curl: curlForJsonRequest("POST", url, body),
        }, config.outputMode, checkoutUrl
            ? `Checkout session created: ${checkoutUrl}`
            : "Checkout session create request completed. Use --json to view the full response and curl example.");
    });
}
function buildCheckoutPayload(options) {
    requireCustomerIdentifier(options);
    const amount = parseNumberOption("--amount", options.amount);
    const currency = options.currency.toUpperCase();
    const mode = checkoutMode(options);
    const body = {
        customerId: options.customerId,
        customerEmail: options.customerEmail,
        referenceCustomerId: options.referenceCustomerId,
        originalAmount: amount,
        originalCurrency: currency,
        merchantReferenceId: options.merchantReferenceId,
        successUrl: options.successUrl,
        cancelUrl: options.cancelUrl,
        uiMode: options.uiMode,
        returnUrl: options.returnUrl,
        paymentMethodType: options.paymentMethodType,
        allowPromotionCodes: Boolean(options.allowPromotionCodes),
        showPromotionCode: true,
        localPriceOnly: false,
        promotionCode: options.promotionCode,
    };
    if (mode === "registered") {
        body.productId = options.productId;
        body.priceId = options.priceId;
        return { body, mode };
    }
    const quantity = parsePositiveIntegerOption("--quantity", options.quantity);
    const unitAmount = options.unitAmount ? parseNumberOption("--unit-amount", options.unitAmount) : roundMoney(amount / quantity);
    const expectedAmount = roundMoney(unitAmount * quantity);
    if (roundMoney(amount) !== expectedAmount) {
        throw new Error(`Option --amount must be equal to --unit-amount * --quantity for inline checkout. Got amount=${amount}, unitAmount=${unitAmount}, quantity=${quantity}.`);
    }
    const priceData = {
        name: options.name ?? "Test Product",
        quantity,
        unitAmount,
        currency,
        imageUrl: options.imageUrl,
    };
    body.priceDataList = [priceData];
    return { body, mode };
}
function requireCustomerIdentifier(options) {
    if (!options.customerId && !options.customerEmail && !options.referenceCustomerId) {
        throw new Error("Missing required option: --customer-id or --customer-email or --reference-customer-id");
    }
}
function checkoutMode(options) {
    if (options.productId || options.priceId) {
        requireOption("--product-id", options.productId);
        requireOption("--price-id", options.priceId);
        return "registered";
    }
    return "inline";
}
function parsePositiveIntegerOption(name, value) {
    const parsed = parseIntegerOption(name, value);
    if (parsed < 1) {
        throw new Error(`Option ${name} must be greater than or equal to 1`);
    }
    return parsed;
}
function roundMoney(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}
function extractCheckoutUrl(result) {
    const root = result && typeof result === "object" ? result : undefined;
    const data = root?.data && typeof root.data === "object" ? root.data : undefined;
    const value = data?.checkoutUrl ?? data?.url ?? data?.hostedUrl ?? data?.paymentUrl ?? data?.checkout_url
        ?? root?.checkoutUrl ?? root?.url ?? root?.hostedUrl ?? root?.paymentUrl ?? root?.checkout_url;
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
function extractSessionId(result) {
    const root = result && typeof result === "object" ? result : undefined;
    const data = root?.data && typeof root.data === "object" ? root.data : undefined;
    const value = data?.sessionId ?? data?.id ?? root?.sessionId ?? root?.id;
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
function normalizeCheckoutSessionId(value) {
    const trimmed = value.trim();
    requireOption("session-id-or-url", trimmed);
    if (!/^https?:\/\//i.test(trimmed))
        return trimmed;
    let url;
    try {
        url = new URL(trimmed);
    }
    catch {
        return trimmed;
    }
    const sessionId = url.searchParams.get("session_id")
        ?? url.searchParams.get("sessionId")
        ?? url.pathname
            .split("/")
            .filter(Boolean)
            .reverse()
            .find((part) => /^sess[_-]/i.test(part))
        ?? url.pathname.split("/").filter(Boolean).pop();
    if (!sessionId) {
        throw new Error("Could not extract checkout session ID from URL.");
    }
    return sessionId;
}
function openUrl(url) {
    const command = process.platform === "win32"
        ? "cmd"
        : process.platform === "darwin"
            ? "open"
            : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.unref();
}
//# sourceMappingURL=checkout.js.map