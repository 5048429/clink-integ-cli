import { DEFAULT_PAGE_SIZE } from "../constants.js";
import { curlForJsonRequest } from "../curl.js";
import { parseNumberOption, printResult } from "../output.js";
import { buildUrl, getCommandContext, readJsonInput } from "./helpers.js";
export function registerPrice(program) {
    const price = program.command("price").description("Create and list Clink prices");
    price
        .command("get <price-id>")
        .description("Get price details")
        .action(async function (priceId) {
        const { config, client } = await getCommandContext(this);
        const result = await client.get(`/price/${encodeURIComponent(priceId)}`);
        printResult(result, config.outputMode);
    });
    price
        .command("create")
        .description("Create a one-time or recurring price")
        .requiredOption("--product-id <id>", "Product ID")
        .requiredOption("--amount <amount>", "Unit amount")
        .requiredOption("--currency <currency>", "Currency, for example USD")
        .option("--type <type>", "one_time or recurring", "one_time")
        .option("--interval <interval>", "day, week, month, year, quarter, half_year, or custom")
        .option("--interval-count <number>", "Interval count", "1")
        .option("--trial-days <number>", "Trial period days")
        .option("--pricing-model <model>", "flat_rate, per_seat, tiered, or usage_based", "flat_rate")
        .option("--default", "Mark as default price")
        .action(async (options, command) => {
        const { config, client } = await getCommandContext(command);
        const body = {
            productId: options.productId,
            currency: options.currency.toUpperCase(),
            unitAmount: parseNumberOption("--amount", options.amount),
            priceType: options.type,
            isDefaultPrice: Boolean(options.default),
        };
        if (options.type === "recurring") {
            body.recurringDetails = {
                interval: (options.interval ?? "month"),
                intervalCount: Number(options.intervalCount),
                trialPeriodDays: options.trialDays ? Number(options.trialDays) : undefined,
                pricingModel: options.pricingModel,
            };
        }
        const result = await client.post("/price", { body });
        printResult(result, config.outputMode, `Price create request completed for product ${options.productId}`);
    });
    price
        .command("list")
        .description("List prices for a product")
        .requiredOption("--product-id <id>", "Product ID")
        .option("--active <boolean>", "Filter active prices", "true")
        .option("--page <number>", "Page number", "1")
        .option("--page-size <number>", "Page size", String(DEFAULT_PAGE_SIZE))
        .action(async (options, command) => {
        const { config, client } = await getCommandContext(command);
        const query = {
            productId: options.productId,
            active: options.active === "true",
            pageNum: Number(options.page),
            pageSize: Number(options.pageSize),
        };
        const result = await client.get("/price", {
            query,
        });
        printResult(result, config.outputMode);
    });
    price
        .command("update <price-id>")
        .description("Update a price. Provide the official API JSON payload with --data or --data-file.")
        .option("--data <json>", "Update price JSON payload")
        .option("--data-file <path>", "Read JSON payload from a file")
        .action(async (priceId, options, command) => {
        const { config, client } = await getCommandContext(command);
        const body = await readJsonInput(options);
        if (body === undefined) {
            throw new Error("Missing required option: --data or --data-file");
        }
        const path = `/price/${encodeURIComponent(priceId)}`;
        const result = await client.put(path, { body });
        printResult({
            result,
            curl: curlForJsonRequest("PUT", buildUrl(config.baseUrl, path), body),
        }, config.outputMode, "Price update request completed. Use --json to view the full response and curl example.");
    });
}
//# sourceMappingURL=price.js.map