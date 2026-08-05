import { createImageUploadForm } from "../api/client.js";
import { DEFAULT_PAGE_SIZE } from "../constants.js";
import { parseNumberOption, printResult, requireOption } from "../output.js";
import { getCommandContext } from "./helpers.js";
export function registerProduct(program) {
    const product = program.command("product").description("Create and list Clink products");
    product
        .command("get <product-id>")
        .description("Get product details")
        .action(async function (productId) {
        const { config, client } = await getCommandContext(this);
        const result = await client.get(`/product/${encodeURIComponent(productId)}`);
        printResult(result, config.outputMode);
    });
    product
        .command("create")
        .description("Create a product with its initial price. Use --image-file to upload a product image first.")
        .requiredOption("--name <name>", "Product name")
        .requiredOption("--amount <amount>", "Initial price unit amount")
        .requiredOption("--currency <currency>", "Initial price currency, for example USD")
        .option("--description <description>", "Product description")
        .option("--image-id <ossId>", "Existing uploaded product image OSS ID")
        .option("--image-file <path>", "Local image file to upload before product creation")
        .option("--tax-category <category>", "digital_goods_or_service, ebook, or software_service", "software_service")
        .option("--type <type>", "Initial price type: one_time or recurring", "one_time")
        .option("--interval <interval>", "Recurring interval: day, week, month, year, quarter, half_year, or custom")
        .option("--interval-count <number>", "Recurring interval count", "1")
        .option("--trial-days <number>", "Recurring trial period days")
        .option("--pricing-model <model>", "Recurring pricing model: flat_rate, per_seat, tiered, or usage_based", "flat_rate")
        .option("--default", "Mark the initial price as the product default price")
        .action(async (options, command) => {
        const { config, client } = await getCommandContext(command);
        let imageId = options.imageId;
        let uploadResult;
        if (!imageId && options.imageFile) {
            const form = await createImageUploadForm(options.imageFile);
            uploadResult = await client.post("/product/image/upload", { multipart: form });
            imageId = extractOssId(uploadResult);
        }
        requireOption("--image-id or --image-file", imageId);
        const body = {
            name: options.name,
            description: options.description,
            image: imageId,
            taxCategory: options.taxCategory,
            priceList: [buildInitialPrice(options)],
        };
        const result = await client.post("/product", { body });
        const ids = extractProductIds(result);
        printResult({
            productId: ids.productId,
            defaultPrice: ids.defaultPrice,
            initialPriceId: ids.initialPriceId,
            checkoutCommand: ids.productId && ids.initialPriceId
                ? checkoutCommand(ids.productId, ids.initialPriceId, options.currency, options.amount)
                : undefined,
            upload: uploadResult,
            product: result,
        }, config.outputMode, [
            `Product create request completed for "${options.name}"`,
            ids.productId ? `Product ID: ${ids.productId}` : undefined,
            ids.initialPriceId ? `Price ID: ${ids.initialPriceId}` : undefined,
            ids.productId && ids.initialPriceId
                ? `Next: ${checkoutCommand(ids.productId, ids.initialPriceId, options.currency, options.amount)}`
                : undefined,
        ]
            .filter(Boolean)
            .join("\n"));
    });
    product
        .command("list")
        .description("List products for the current merchant")
        .option("--page <number>", "Page number", "1")
        .option("--page-size <number>", "Page size", String(DEFAULT_PAGE_SIZE))
        .action(async (options, command) => {
        const { config, client } = await getCommandContext(command);
        const query = {
            pageNum: Number(options.page),
            pageSize: Number(options.pageSize),
        };
        const result = await client.get("/product", {
            query,
        });
        printResult(result, config.outputMode);
    });
}
function buildInitialPrice(options) {
    const price = {
        currency: options.currency.toUpperCase(),
        unitAmount: parseNumberOption("--amount", options.amount),
        priceType: options.type,
        isDefaultPrice: Boolean(options.default),
    };
    if (options.type === "recurring") {
        price.recurringDetails = {
            interval: (options.interval ?? "month"),
            intervalCount: Number(options.intervalCount),
            trialPeriodDays: options.trialDays ? Number(options.trialDays) : undefined,
            pricingModel: options.pricingModel,
        };
    }
    return price;
}
function extractOssId(uploadResult) {
    if (!uploadResult || typeof uploadResult !== "object")
        return undefined;
    const data = uploadResult.data;
    return data?.ossId;
}
function extractProductIds(result) {
    const data = result && typeof result === "object" ? result.data : undefined;
    const productId = stringValue(data?.productId);
    const defaultPrice = stringValue(data?.defaultPrice);
    const priceList = Array.isArray(data?.priceList) ? data.priceList : [];
    const firstPrice = priceList.find((item) => item && typeof item === "object");
    const initialPriceId = defaultPrice ?? stringValue(firstPrice?.priceId);
    return { productId, defaultPrice, initialPriceId };
}
function stringValue(value) {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
function checkoutCommand(productId, priceId, currency, amount) {
    return [
        "clink checkout create",
        "--customer-email buyer@example.com",
        `--amount ${amount}`,
        `--currency ${currency.toUpperCase()}`,
        `--product-id ${productId}`,
        `--price-id ${priceId}`,
        "--success-url https://your-site.com/success",
        "--cancel-url https://your-site.com/cancel",
        "--json",
    ].join(" ");
}
//# sourceMappingURL=product.js.map