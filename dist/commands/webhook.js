import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveSecretRef } from "../config.js";
import { formatFetchError } from "../dashboard-console.js";
import { parseIntegerOption, printResult, requireOption } from "../output.js";
import { DEFAULT_WEBHOOK_FIXTURE_PROFILE, WEBHOOK_FIXTURE_PROFILES, WEBHOOK_FIXTURE_TYPES, createWebhookFixture, isDeprecatedWebhookFixtureProfile, } from "../webhook/fixtures.js";
import { DEFAULT_WEBHOOK_TOLERANCE_SECONDS, signWebhookPayload, verifyWebhookPayload, } from "../webhook/signature.js";
import { getCommandContext } from "./helpers.js";
import { registerWebhookEndpointSubcommands } from "./webhook-endpoints.js";
const WEBHOOK_FIXTURE_HELP = [
    "",
    "Default merchant-webhook contract: event_ ID, object=event, Unix-millisecond created, and an object-valued data.object resource.",
    "Invoice fixtures use data.object.items (never lineItems).",
    `Supported generated event types (${WEBHOOK_FIXTURE_TYPES.length}): ${WEBHOOK_FIXTURE_TYPES.join(", ")}`,
    "The legacy profile is deprecated and is only for compatibility with old tests; it is never selected by default.",
].join("\n");
export function registerWebhook(program) {
    const webhook = program.command("webhook").description("Simulate, sign, verify, and manage Clink webhooks");
    const endpoint = webhook
        .command("endpoint")
        .description("Manage webhook endpoints with the Secret Key API");
    registerWebhookEndpointSubcommands(endpoint);
    webhook
        .command("fixture")
        .description("Write a stable local merchant webhook fixture to disk")
        .argument("<type>", "Generated event type; see the supported list below")
        .requiredOption("--out <file>", "Output JSON file")
        .option("--fixture-profile <profile>", "Fixture profile: merchant-webhook or deprecated legacy (old tests only)", DEFAULT_WEBHOOK_FIXTURE_PROFILE)
        .addHelpText("after", WEBHOOK_FIXTURE_HELP)
        .action(async (type, options, command) => {
        const { config } = await getCommandContext(command);
        const profile = parseWebhookFixtureProfile(options.fixtureProfile);
        warnDeprecatedFixtureProfile(profile);
        const event = createWebhookFixture(type, { profile });
        await mkdir(dirname(options.out), { recursive: true });
        await writeFile(options.out, `${JSON.stringify(event, null, 2)}\n`, "utf8");
        printResult({
            eventType: type,
            profile,
            warnings: fixtureProfileWarnings(profile),
            out: options.out,
            fixture: event,
        }, config.outputMode, `Wrote ${type} fixture to ${options.out}`);
    });
    webhook
        .command("simulate")
        .description("Generate a signed local event and optionally POST it to a local endpoint")
        .argument("<type>", "Generated event type; see the supported list below")
        .option("--secret <value>", "Webhook signing key literal or env:CLINK_WEBHOOK_SIGNING_KEY")
        .option("--forward-to <url>", "Local endpoint to POST the signed event to")
        .option("--body-file <path>", "Use a custom JSON event body instead of a generated fixture")
        .option("--fixture-profile <profile>", "Generated fixture profile: merchant-webhook or deprecated legacy (old tests only)", DEFAULT_WEBHOOK_FIXTURE_PROFILE)
        .addHelpText("after", WEBHOOK_FIXTURE_HELP)
        .action(async (type, options, command) => {
        const { config } = await getCommandContext(command);
        const secret = resolveSecretRef(options.secret, []).secret ?? config.webhookSigningKey;
        requireOption("--secret or CLINK_WEBHOOK_SIGNING_KEY", secret);
        const profile = parseWebhookFixtureProfile(options.fixtureProfile);
        if (!options.bodyFile)
            warnDeprecatedFixtureProfile(profile);
        const event = options.bodyFile
            ? JSON.parse(await readFile(options.bodyFile, "utf8"))
            : createWebhookFixture(type, { profile });
        const rawBody = JSON.stringify(event);
        const timestamp = String(Date.now());
        const signature = signWebhookPayload(secret, timestamp, rawBody);
        let forwardResult;
        if (options.forwardTo) {
            let response;
            try {
                response = await fetch(options.forwardTo, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-Clink-Timestamp": timestamp,
                        "X-Clink-Signature": signature,
                    },
                    body: rawBody,
                });
            }
            catch (error) {
                throw new Error(`Webhook forward to ${options.forwardTo} network error: ${formatFetchError(error)}`);
            }
            forwardResult = {
                status: response.status,
                ok: response.ok,
                body: await response.text(),
            };
        }
        printResult({
            event,
            fixtureProfile: options.bodyFile ? "custom-body" : profile,
            warnings: options.bodyFile ? [] : fixtureProfileWarnings(profile),
            timestamp,
            signature,
            headers: {
                "X-Clink-Timestamp": timestamp,
                "X-Clink-Signature": signature,
            },
            rawBody,
            forwardResult,
        }, config.outputMode, options.forwardTo
            ? `Sent signed ${type} fixture to ${options.forwardTo}`
            : `Generated signed ${type} fixture. Use --json to inspect headers and body.`);
    });
    webhook
        .command("sign")
        .description("Sign a raw webhook JSON body")
        .requiredOption("--body-file <path>", "JSON body file")
        .option("--secret <value>", "Webhook signing key literal or env:CLINK_WEBHOOK_SIGNING_KEY")
        .option("--timestamp <value>", "Timestamp to sign with", String(Date.now()))
        .action(async (options, command) => {
        const { config } = await getCommandContext(command);
        const secret = resolveSecretRef(options.secret, []).secret ?? config.webhookSigningKey;
        requireOption("--secret or CLINK_WEBHOOK_SIGNING_KEY", secret);
        const rawBody = await readFile(options.bodyFile, "utf8");
        const signature = signWebhookPayload(secret, options.timestamp, rawBody);
        printResult({
            timestamp: options.timestamp,
            signature,
            headers: {
                "X-Clink-Timestamp": options.timestamp,
                "X-Clink-Signature": signature,
            },
        }, config.outputMode, signature);
    });
    webhook
        .command("verify")
        .description("Verify a webhook signature against a raw body")
        .requiredOption("--body-file <path>", "JSON body file")
        .requiredOption("--timestamp <value>", "X-Clink-Timestamp header")
        .requiredOption("--signature <value>", "X-Clink-Signature header")
        .option("--secret <value>", "Webhook signing key literal or env:CLINK_WEBHOOK_SIGNING_KEY")
        .option("--tolerance-seconds <seconds>", "Allowed timestamp drift before rejecting", String(DEFAULT_WEBHOOK_TOLERANCE_SECONDS))
        .action(async (options, command) => {
        const { config } = await getCommandContext(command);
        const secret = resolveSecretRef(options.secret, []).secret ?? config.webhookSigningKey;
        requireOption("--secret or CLINK_WEBHOOK_SIGNING_KEY", secret);
        const rawBody = await readFile(options.bodyFile, "utf8");
        const toleranceSeconds = parseNonNegativeIntegerOption("--tolerance-seconds", options.toleranceSeconds);
        const valid = verifyWebhookPayload(secret, options.timestamp, rawBody, options.signature, { toleranceSeconds });
        printResult({ valid, toleranceSeconds }, config.outputMode, valid ? "valid" : "invalid");
        if (!valid)
            process.exitCode = 1;
    });
}
function parseWebhookFixtureProfile(value) {
    if (WEBHOOK_FIXTURE_PROFILES.includes(value))
        return value;
    throw new Error(`Option --fixture-profile must be one of: ${WEBHOOK_FIXTURE_PROFILES.join(", ")}`);
}
function warnDeprecatedFixtureProfile(profile) {
    for (const warning of fixtureProfileWarnings(profile)) {
        console.warn(`Deprecated: ${warning}`);
    }
}
function fixtureProfileWarnings(profile) {
    return isDeprecatedWebhookFixtureProfile(profile)
        ? ["The legacy webhook fixture profile is deprecated and will be removed in a future release. Migrate to merchant-webhook data.object payloads."]
        : [];
}
function parseNonNegativeIntegerOption(name, value) {
    const parsed = parseIntegerOption(name, value);
    if (parsed < 0) {
        throw new Error(`Option ${name} must be greater than or equal to 0`);
    }
    return parsed;
}
//# sourceMappingURL=webhook.js.map