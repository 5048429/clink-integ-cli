import { curlForJsonRequest } from "../curl.js";
import { parseNumberOption, printResult } from "../output.js";
import { buildUrl, getCommandContext } from "./helpers.js";
export function registerRefund(program) {
    const refund = program
        .command("refund")
        .description("Create and inspect refunds with CLINK_SECRET_KEY authentication");
    refund
        .command("create")
        .description("Create a refund for an existing order")
        .requiredOption("--order-id <id>", "Order ID to refund")
        .requiredOption("--refund-merchant-order-id <id>", "Merchant idempotency ID for this refund")
        .requiredOption("--amount <amount>", "Refund amount")
        .option("--reason-type <number>", "0 duplicate, 1 fraud, 2 customer initiated, 3 other", "2")
        .option("--remark <text>", "Refund remark")
        .action(async (options, command) => {
        const { config, client } = await getCommandContext(command);
        const body = {
            orderId: options.orderId,
            refundMerchantOrderId: options.refundMerchantOrderId,
            refundAmount: parseNumberOption("--amount", options.amount),
            refundReasonType: Number(options.reasonType),
            remark: options.remark,
        };
        const result = await client.post("/refund", { body });
        printResult({
            result,
            curl: curlForJsonRequest("POST", buildUrl(config.baseUrl, "/refund"), body),
        }, config.outputMode, "Refund create request completed. Use --json to view the full response and curl example.");
    });
    refund
        .command("get <refund-id>")
        .description("Get refund details")
        .action(async function (refundId) {
        const { config, client } = await getCommandContext(this);
        const result = await client.get(`/refund/${encodeURIComponent(refundId)}`);
        printResult(result, config.outputMode);
    });
}
//# sourceMappingURL=refund.js.map