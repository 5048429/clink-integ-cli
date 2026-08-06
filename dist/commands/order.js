import { DEFAULT_PAGE_SIZE } from "../constants.js";
import { printResult } from "../output.js";
import { getCommandContext } from "./helpers.js";
export function registerOrder(program) {
    const order = program
        .command("order")
        .description("Inspect orders with CLINK_SECRET_KEY authentication");
    order
        .command("get <order-id>")
        .description("Get order details")
        .action(async function (orderId) {
        const { config, client } = await getCommandContext(this);
        const result = await client.get(`/order/${encodeURIComponent(orderId)}`);
        printResult(result, config.outputMode);
    });
    order
        .command("list")
        .description("List orders for the current merchant")
        .option("--subscription-id <id>", "Filter by subscription ID")
        .option("--customer-id <id>", "Filter by customer ID")
        .option("--page <number>", "Page number", "1")
        .option("--page-size <number>", "Page size", String(DEFAULT_PAGE_SIZE))
        .action(async (options, command) => {
        const { config, client } = await getCommandContext(command);
        const result = await client.get("/order", {
            query: {
                subscriptionId: options.subscriptionId,
                customerId: options.customerId,
                pageNum: Number(options.page),
                pageSize: Number(options.pageSize),
            },
        });
        printResult(result, config.outputMode);
    });
}
//# sourceMappingURL=order.js.map