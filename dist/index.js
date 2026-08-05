#!/usr/bin/env node
import { Command, CommanderError } from "commander";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { registerApi } from "./commands/api.js";
import { registerAuth } from "./commands/auth.js";
import { registerBilling } from "./commands/billing.js";
import { registerCatalog } from "./commands/catalog.js";
import { registerCheckout } from "./commands/checkout.js";
import { registerDashboard } from "./commands/dashboard.js";
import { registerDoctor } from "./commands/doctor.js";
import { registerEnv } from "./commands/env.js";
import { registerInit } from "./commands/init.js";
import { registerLogin } from "./commands/login.js";
import { registerOrder } from "./commands/order.js";
import { registerPayment } from "./commands/payment.js";
import { registerPrice } from "./commands/price.js";
import { registerProduct } from "./commands/product.js";
import { registerRefund } from "./commands/refund.js";
import { registerSmokeTest } from "./commands/smoke-test.js";
import { registerSubscription } from "./commands/subscription.js";
import { registerWebhook } from "./commands/webhook.js";
import { classifyError } from "./exit-codes.js";
async function main() {
    const packageJson = await readPackageJson();
    const program = new Command();
    program
        .name("clink")
        .description("Merchant developer CLI for ClinkBill integrations")
        .version(packageJson.version)
        .option("--json", "Output machine-readable JSON")
        .option("--profile <name>", "Use a named local profile", "default")
        .option("--env <environment>", "Environment name: sandbox, production, or a custom env (see clink env)")
        .option("--base-url <url>", "Override Clink API base URL")
        .option("--api-key <value>", "Secret key literal or env:CLINK_SECRET_KEY")
        .option("--timeout-ms <milliseconds>", "Abort Clink API requests after this many milliseconds (default: 30000)")
        .option("--dry-run", "Print request metadata instead of executing Clink API writes");
    program.exitOverride();
    program.configureOutput({
        writeErr: (text) => {
            if (!process.argv.includes("--json")) {
                process.stderr.write(text);
            }
        },
    });
    registerApi(program);
    registerAuth(program);
    registerCatalog(program);
    registerEnv(program);
    registerLogin(program);
    registerDashboard(program);
    registerInit(program);
    registerBilling(program);
    registerProduct(program);
    registerPrice(program);
    registerCheckout(program);
    registerOrder(program);
    registerRefund(program);
    registerPayment(program);
    registerSubscription(program);
    registerWebhook(program);
    registerDoctor(program);
    registerSmokeTest(program);
    await program.parseAsync(process.argv);
}
async function readPackageJson() {
    const currentFile = fileURLToPath(import.meta.url);
    const root = join(dirname(currentFile), "..");
    try {
        const raw = await readFile(join(root, "package.json"), "utf8");
        return JSON.parse(raw);
    }
    catch {
        const raw = await readFile(join(root, "..", "package.json"), "utf8");
        return JSON.parse(raw);
    }
}
main().catch((error) => {
    if (error instanceof CommanderError && error.exitCode === 0) {
        process.exitCode = 0;
        return;
    }
    const message = error instanceof Error ? error.message : String(error);
    const exitCode = classifyError(error);
    const wantsJson = process.argv.includes("--json");
    if (wantsJson) {
        console.error(JSON.stringify({ ok: false, error: message, exitCode }, null, 2));
    }
    else {
        console.error(`Error: ${message}`);
    }
    process.exitCode = exitCode;
});
//# sourceMappingURL=index.js.map