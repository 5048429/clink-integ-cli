import { exec } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { promisify } from "node:util";
import { saveProfile } from "../config.js";
import { maskSecret, parseIntegerOption, printResult, requireOption } from "../output.js";
import { WEBHOOK_PRESET_NAMES, parseWebhookRuntimeCatalog, resolveWebhookEventSelection, } from "../webhook/event-catalog.js";
import { getCommandContext } from "./helpers.js";
const WEBHOOK_ENDPOINT_PATH = "/webhook/endpoints";
const WEBHOOK_SIGNING_KEY_ENV = "CLINK_WEBHOOK_SIGNING_KEY";
const execAsync = promisify(exec);
export function registerWebhookEndpointSubcommands(parent, options = {}) {
    parent
        .command("events")
        .description("List the runtime webhook event catalog, aliases, and CLI presets")
        .action(async function () {
        const { config, client } = await getCommandContext(this);
        const { result, catalog } = await loadRuntimeWebhookCatalog(client);
        const presets = describeRuntimePresets(catalog);
        printResult({
            result,
            events: catalog.events,
            aliases: catalog.aliases,
            presets,
        }, config.outputMode, [formatEventCatalog(catalog.events), "", formatPresetCatalog(presets)].join("\n"));
    });
    const list = parent
        .command("list")
        .description("List webhook endpoints for the current Secret Key merchant")
        .option("--page <number>", "Page number", "1")
        .option("--page-size <number>", "Page size", "20")
        .option("--enabled <boolean>", "Filter by enabled status")
        .option("--url <https-url>", "Filter by exact endpoint URL");
    if (options.legacyDashboardOptions) {
        list.option("--show-secret", "Ignored; Secret Key API list responses do not return plaintext signing secrets");
    }
    addLegacyDashboardOptions(list, options);
    list.action(async function (listOptions) {
        const { config, client } = await getCommandContext(this);
        const query = {
            pageNum: parsePositiveIntegerOption("--page", listOptions.page),
            pageSize: parsePageSizeOption(listOptions.pageSize),
            enabled: parseOptionalBoolean("--enabled", listOptions.enabled),
            url: listOptions.url,
        };
        const result = await client.get(WEBHOOK_ENDPOINT_PATH, { query });
        const safeResult = maskWebhookSecrets(result, false);
        printResult({
            profile: config.profile,
            ignoredMerchantId: listOptions.merchantId,
            ignoredShowSecret: listOptions.showSecret,
            result: safeResult,
        }, config.outputMode, config.dryRun ? "Webhook endpoint list dry-run generated. Use --json to view request metadata." : formatEndpointList(result));
    });
    parent
        .command("get <endpoint-id>")
        .description("Get a webhook endpoint by ID")
        .action(async function (endpointId) {
        requireOption("endpoint-id", endpointId);
        const { config, client } = await getCommandContext(this);
        const result = await client.get(`${WEBHOOK_ENDPOINT_PATH}/${encodeURIComponent(endpointId)}`);
        printResult({
            profile: config.profile,
            result: maskWebhookSecrets(result, false),
        }, config.outputMode, config.dryRun ? "Webhook endpoint get dry-run generated. Use --json to view request metadata." : formatEndpointLine(extractEndpoint(result)));
    });
    const create = parent
        .command("create")
        .description("Create a webhook endpoint with the Secret Key API")
        .requiredOption("--url <https-url>", "HTTPS webhook endpoint URL")
        .requiredOption("--events <events>", "Event names or combinable presets: core, checkout, subscriptions, disputes, payment-methods, commerce, all")
        .option("--description <text>", "Webhook endpoint description")
        .option("--remark <text>", "Alias for --description")
        .option("--save-secret", "Save the returned signing secret into the current clink profile")
        .option("--show-secret", "Print the full signing secret in command output")
        .option("--allow-unknown-events", "Deprecated; runtime GET /webhook/events validation is always enforced")
        .option("--disabled", "Create the webhook but leave it disabled");
    addEnvSyncOptions(create);
    addLegacyDashboardOptions(create, options);
    create.action(async function (createOptions) {
        const { config, client } = await getCommandContext(this);
        const { catalog } = await loadRuntimeWebhookCatalog(client);
        const eventSelection = resolveWebhookEventSelection(createOptions.events, catalog, {
            allowUnknownEvents: Boolean(createOptions.allowUnknownEvents),
        });
        const body = {
            url: parseHttpsEndpoint(createOptions.url),
            events: eventSelection.resolvedEvents,
            description: getDescription(createOptions),
            enabled: !createOptions.disabled,
        };
        const result = await client.post(WEBHOOK_ENDPOINT_PATH, { body });
        await saveSigningSecretIfRequested(config.profile, result, Boolean(createOptions.saveSecret), config.dryRun);
        const envSync = await syncEnvAndRestartIfRequested(createOptions, result, config.dryRun);
        const endpoint = extractEndpoint(result);
        printResult({
            profile: config.profile,
            ignoredMerchantId: createOptions.merchantId,
            eventSelection,
            saved: Boolean(createOptions.saveSecret),
            envSync,
            endpoint: maskWebhookSecrets(endpoint, Boolean(createOptions.showSecret)),
            result: maskWebhookSecrets(result, Boolean(createOptions.showSecret)),
        }, config.outputMode, [
            formatEventSelection(eventSelection),
            config.dryRun
                ? "Dry run: webhook endpoint create request generated; no endpoint was written."
                : `Created webhook endpoint: ${endpoint?.url ?? body.url}`,
            `Endpoint ID: ${endpoint?.id ?? "unknown"}`,
            `Events: ${(endpoint?.events ?? body.events).join(", ")}`,
            formatSigningSecretLine(endpoint, Boolean(createOptions.showSecret)),
            createOptions.saveSecret ? `Saved signing secret into profile "${config.profile}".` : "Signing secret was not saved. Re-run with --save-secret to store it.",
            formatEnvSyncLine(envSync),
        ]
            .filter(Boolean)
            .join("\n"));
    });
    const update = parent
        .command("update <endpoint-id>")
        .description("Update a webhook endpoint with the Secret Key API")
        .option("--url <https-url>", "HTTPS webhook endpoint URL")
        .option("--events <events>", "Event names or combinable presets: core, checkout, subscriptions, disputes, payment-methods, commerce, all")
        .option("--description <text>", "Webhook endpoint description")
        .option("--remark <text>", "Alias for --description")
        .option("--enabled <boolean>", "Set enabled status")
        .option("--disabled", "Disable the webhook endpoint")
        .option("--allow-unknown-events", "Deprecated; runtime GET /webhook/events validation is always enforced")
        .option("--rotate-secret", "Rotate the signing secret after updating")
        .option("--save-secret", "Save the rotated signing secret into the current clink profile")
        .option("--show-secret", "Print the full rotated signing secret in command output");
    addEnvSyncOptions(update);
    addLegacyDashboardOptions(update, options);
    update.action(async function (endpointId, updateOptions) {
        requireOption("endpoint-id", endpointId);
        const { config, client } = await getCommandContext(this);
        const eventSelection = updateOptions.events
            ? resolveWebhookEventSelection(updateOptions.events, (await loadRuntimeWebhookCatalog(client)).catalog, { allowUnknownEvents: Boolean(updateOptions.allowUnknownEvents) })
            : undefined;
        const body = buildUpdateBody(updateOptions, eventSelection?.resolvedEvents);
        const shouldRotate = Boolean(updateOptions.rotateSecret || updateOptions.saveSecret || updateOptions.showSecret || updateOptions.syncEnvFile);
        if (Object.keys(body).length === 0 && !shouldRotate) {
            throw new Error("Provide at least one of --url, --events, --description, --remark, --enabled, --disabled, or --rotate-secret.");
        }
        const updateResult = Object.keys(body).length > 0
            ? await client.patch(`${WEBHOOK_ENDPOINT_PATH}/${encodeURIComponent(endpointId)}`, { body })
            : undefined;
        const rotateResult = shouldRotate
            ? await client.post(`${WEBHOOK_ENDPOINT_PATH}/${encodeURIComponent(endpointId)}/rotate-secret`)
            : undefined;
        await saveSigningSecretIfRequested(config.profile, rotateResult ?? updateResult, Boolean(updateOptions.saveSecret), config.dryRun);
        const result = rotateResult ?? updateResult;
        const envSync = await syncEnvAndRestartIfRequested(updateOptions, result, config.dryRun);
        const endpoint = extractEndpoint(result);
        printResult({
            profile: config.profile,
            ignoredMerchantId: updateOptions.merchantId,
            eventSelection,
            saved: Boolean(updateOptions.saveSecret),
            envSync,
            updateResult: maskWebhookSecrets(updateResult, false),
            rotateResult: maskWebhookSecrets(rotateResult, Boolean(updateOptions.showSecret)),
            endpoint: maskWebhookSecrets(endpoint, Boolean(updateOptions.showSecret)),
        }, config.outputMode, [
            eventSelection ? formatEventSelection(eventSelection) : undefined,
            config.dryRun
                ? "Dry run: webhook endpoint update request generated; no endpoint was written."
                : `Updated webhook endpoint: ${endpoint?.url ?? endpointId}`,
            `Endpoint ID: ${endpoint?.id ?? endpointId}`,
            endpoint?.events ? `Events: ${endpoint.events.join(", ")}` : undefined,
            formatSigningSecretLine(endpoint, Boolean(updateOptions.showSecret)),
            updateOptions.saveSecret ? `Saved signing secret into profile "${config.profile}".` : undefined,
            formatEnvSyncLine(envSync),
        ]
            .filter(Boolean)
            .join("\n"));
    });
    parent
        .command("delete <endpoint-id>")
        .description("Delete a webhook endpoint")
        .action(async function (endpointId) {
        requireOption("endpoint-id", endpointId);
        const { config, client } = await getCommandContext(this);
        const result = await client.delete(`${WEBHOOK_ENDPOINT_PATH}/${encodeURIComponent(endpointId)}`);
        printResult({
            profile: config.profile,
            endpointId,
            result,
        }, config.outputMode, config.dryRun ? "Webhook endpoint delete dry-run generated. Use --json to view request metadata." : `Deleted webhook endpoint: ${endpointId}`);
    });
    parent
        .command("enable <endpoint-id>")
        .description("Enable a webhook endpoint")
        .action(async function (endpointId) {
        await updateEndpointEnabled(this, endpointId, true);
    });
    parent
        .command("disable <endpoint-id>")
        .description("Disable a webhook endpoint")
        .action(async function (endpointId) {
        await updateEndpointEnabled(this, endpointId, false);
    });
    const rotateSecret = parent
        .command("rotate-secret <endpoint-id>")
        .description("Rotate a webhook endpoint signing secret")
        .option("--save-secret", "Save the rotated signing secret into the current clink profile")
        .option("--show-secret", "Print the full signing secret in command output");
    addEnvSyncOptions(rotateSecret);
    rotateSecret.action(async function (endpointId, rotateOptions) {
        requireOption("endpoint-id", endpointId);
        const { config, client } = await getCommandContext(this);
        const result = await client.post(`${WEBHOOK_ENDPOINT_PATH}/${encodeURIComponent(endpointId)}/rotate-secret`);
        await saveSigningSecretIfRequested(config.profile, result, Boolean(rotateOptions.saveSecret), config.dryRun);
        const envSync = await syncEnvAndRestartIfRequested(rotateOptions, result, config.dryRun);
        const endpoint = extractEndpoint(result);
        printResult({
            profile: config.profile,
            saved: Boolean(rotateOptions.saveSecret),
            envSync,
            endpoint: maskWebhookSecrets(endpoint, Boolean(rotateOptions.showSecret)),
            result: maskWebhookSecrets(result, Boolean(rotateOptions.showSecret)),
        }, config.outputMode, config.dryRun
            ? "Webhook signing secret rotate dry-run generated. Use --json to view request metadata."
            : [
                `Rotated webhook signing secret: ${endpoint?.url ?? endpointId}`,
                `Endpoint ID: ${endpoint?.id ?? endpointId}`,
                formatSigningSecretLine(endpoint, Boolean(rotateOptions.showSecret)),
                rotateOptions.saveSecret ? `Saved signing secret into profile "${config.profile}".` : "Signing secret was not saved. Re-run with --save-secret to store it.",
                formatEnvSyncLine(envSync),
            ]
                .filter(Boolean)
                .join("\n"));
    });
    const ensure = parent
        .command("ensure")
        .description("Create or replace a webhook endpoint by URL; event selection uses replace semantics, not merge")
        .requiredOption("--url <https-url>", "HTTPS webhook endpoint URL")
        .requiredOption("--events <events>", "Event names or combinable presets: core, checkout, subscriptions, disputes, payment-methods, commerce, all")
        .option("--description <text>", "Webhook endpoint description")
        .option("--remark <text>", "Alias for --description")
        .option("--save-secret", "Save the resolved signing secret into the current clink profile")
        .option("--show-secret", "Print the full signing secret in command output")
        .option("--allow-unknown-events", "Deprecated; runtime GET /webhook/events validation is always enforced")
        .option("--allow-remove-events", "Explicitly allow ensure to remove events already subscribed on the endpoint")
        .option("--disabled", "Create or update the webhook but leave it disabled")
        .option("--return-signing-secret", "Request plaintext signing secret when available")
        .option("--rotate-secret", "Always rotate the signing secret for an existing endpoint")
        .option("--no-rotate-secret-if-unavailable", "Do not rotate existing endpoints when plaintext secret is unavailable");
    addEnvSyncOptions(ensure);
    addLegacyDashboardOptions(ensure, options);
    ensure.action(async function (ensureOptions) {
        const { config, client } = await getCommandContext(this);
        const { catalog } = await loadRuntimeWebhookCatalog(client);
        const eventSelection = resolveWebhookEventSelection(ensureOptions.events, catalog, {
            allowUnknownEvents: Boolean(ensureOptions.allowUnknownEvents),
        });
        const endpointUrl = parseHttpsEndpoint(ensureOptions.url);
        const preflight = await findWebhookEndpointByUrl(client, endpointUrl);
        const eventDiff = diffWebhookEvents(preflight.endpoint?.events ?? [], eventSelection.resolvedEvents);
        await authorizeEventRemoval(eventDiff, Boolean(ensureOptions.allowRemoveEvents));
        const wantsSigningSecret = Boolean(ensureOptions.saveSecret ||
            ensureOptions.showSecret ||
            ensureOptions.returnSigningSecret ||
            ensureOptions.rotateSecret ||
            ensureOptions.syncEnvFile);
        const body = {
            url: endpointUrl,
            events: eventSelection.resolvedEvents,
            description: getDescription(ensureOptions),
            enabled: !ensureOptions.disabled,
            returnSigningSecret: wantsSigningSecret || undefined,
            rotateSecretIfUnavailable: wantsSigningSecret && ensureOptions.rotateSecretIfUnavailable !== false ? true : undefined,
            rotateSecret: ensureOptions.rotateSecret || undefined,
        };
        const result = await client.put(`${WEBHOOK_ENDPOINT_PATH}/ensure`, { body });
        const data = result.data;
        const endpoint = data?.endpoint;
        let verifiedEndpoint;
        const verification = config.dryRun
            ? { performed: false, status: "skipped-dry-run" }
            : { performed: true, status: "verified" };
        if (!config.dryRun) {
            verifiedEndpoint = await readBackWebhookEndpoint(client, endpoint, endpointUrl);
            assertWebhookEventsMatch(verifiedEndpoint?.events, eventSelection.resolvedEvents, endpointUrl);
        }
        await saveSigningSecretIfRequested(config.profile, result, Boolean(ensureOptions.saveSecret), config.dryRun);
        const envSync = await syncEnvAndRestartIfRequested(ensureOptions, result, config.dryRun);
        printResult({
            profile: config.profile,
            ignoredMerchantId: ensureOptions.merchantId,
            operation: "replace",
            eventSelection,
            eventDiff,
            allowRemoveEvents: Boolean(ensureOptions.allowRemoveEvents),
            existingEndpoint: maskWebhookSecrets(preflight.endpoint, false),
            preflightResult: maskWebhookSecrets(preflight.result, false),
            verification,
            verifiedEndpoint: maskWebhookSecrets(verifiedEndpoint, false),
            saved: Boolean(ensureOptions.saveSecret),
            envSync,
            source: data?.source,
            signingSecretAvailable: data?.signingSecretAvailable,
            signingSecretUnavailableReason: data?.signingSecretUnavailableReason,
            nextAction: data?.nextAction,
            endpoint: maskWebhookSecrets(endpoint, Boolean(ensureOptions.showSecret)),
            result: maskWebhookSecrets(result, Boolean(ensureOptions.showSecret)),
        }, config.outputMode, [
            formatEventSelection(eventSelection),
            "Ensure event behavior: replace (the resolved event set replaces the endpoint event set; it is not merged).",
            formatEventDiff(eventDiff),
            config.dryRun ? "Dry run: no endpoint was written and read-back verification was skipped." : undefined,
            `${formatEnsureSource(data?.source)} webhook endpoint: ${endpoint?.url ?? body.url}`,
            `Endpoint ID: ${endpoint?.id ?? "unknown"}`,
            `Events: ${(endpoint?.events ?? body.events).join(", ")}`,
            `Enabled: ${endpoint?.enabled ?? body.enabled}`,
            config.dryRun ? undefined : "Read-back verification: final event set exactly matches the resolved events.",
            formatSigningSecretLine(endpoint, Boolean(ensureOptions.showSecret)),
            ensureOptions.saveSecret ? `Saved signing secret into profile "${config.profile}".` : "Signing secret was not saved. Re-run with --save-secret to store it.",
            formatEnvSyncLine(envSync),
            data?.nextAction ? `Next action: ${data.nextAction}` : undefined,
        ]
            .filter(Boolean)
            .join("\n"));
    });
}
function addLegacyDashboardOptions(command, options) {
    if (!options.legacyDashboardOptions)
        return;
    command.option("--merchant-id <id>", "Ignored; the Secret Key selects the current merchant");
}
function addEnvSyncOptions(command) {
    command
        .option("--sync-env-file <path>", `Write ${WEBHOOK_SIGNING_KEY_ENV} to an env file after resolving the plaintext signing secret`)
        .option("--restart-command <command>", "Run this shell command after --sync-env-file is updated");
}
async function updateEndpointEnabled(command, endpointId, enabled) {
    requireOption("endpoint-id", endpointId);
    const { config, client } = await getCommandContext(command);
    const result = await client.post(`${WEBHOOK_ENDPOINT_PATH}/${encodeURIComponent(endpointId)}/${enabled ? "enable" : "disable"}`);
    const endpoint = extractEndpoint(result);
    printResult({
        profile: config.profile,
        endpointId,
        endpoint: maskWebhookSecrets(endpoint, false),
        result: maskWebhookSecrets(result, false),
    }, config.outputMode, config.dryRun
        ? `Webhook endpoint ${enabled ? "enable" : "disable"} dry-run generated. Use --json to view request metadata.`
        : `${enabled ? "Enabled" : "Disabled"} webhook endpoint: ${endpoint?.url ?? endpointId}`);
}
function buildUpdateBody(options, resolvedEvents) {
    const body = {};
    if (options.url)
        body.url = parseHttpsEndpoint(options.url);
    if (options.events) {
        if (!resolvedEvents)
            throw new Error("Internal error: webhook events were not resolved from the runtime catalog.");
        body.events = resolvedEvents;
    }
    const description = getDescription(options);
    if (description !== undefined)
        body.description = description;
    const enabled = parseEndpointEnabled(options);
    if (enabled !== undefined)
        body.enabled = enabled;
    return body;
}
function parseEndpointEnabled(options) {
    if (options.enabled !== undefined && options.disabled) {
        throw new Error("Use either --enabled or --disabled, not both.");
    }
    if (options.disabled)
        return false;
    return parseOptionalBoolean("--enabled", options.enabled);
}
function getDescription(options) {
    if (options.description !== undefined && options.remark !== undefined && options.description !== options.remark) {
        throw new Error("Use either --description or --remark, not both.");
    }
    return options.description ?? options.remark;
}
function parseHttpsEndpoint(value) {
    requireOption("--url", value);
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new Error("Option --url must be a valid HTTPS URL");
    }
    if (url.protocol !== "https:") {
        throw new Error("Option --url must start with https:// because Clink webhook endpoints require HTTPS.");
    }
    if (isBlockedWebhookHost(url.hostname)) {
        throw new Error("Option --url must not use localhost, loopback, private, link-local, or multicast hosts.");
    }
    return url.toString();
}
function isBlockedWebhookHost(hostname) {
    const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (host === "localhost" || host === "::1" || host === "0:0:0:0:0:0:0:1")
        return true;
    if (/^127\./.test(host) || /^10\./.test(host) || /^169\.254\./.test(host) || /^192\.168\./.test(host))
        return true;
    const match = /^172\.(\d+)\./.exec(host);
    if (match) {
        const second = Number(match[1]);
        if (second >= 16 && second <= 31)
            return true;
    }
    const firstOctet = /^(\d+)\./.exec(host);
    if (firstOctet) {
        const first = Number(firstOctet[1]);
        if (first >= 224 && first <= 239)
            return true;
    }
    return false;
}
async function loadRuntimeWebhookCatalog(client) {
    const result = await client.get("/webhook/events", { executeInDryRun: true });
    return { result, catalog: parseWebhookRuntimeCatalog(result) };
}
function describeRuntimePresets(catalog) {
    const presets = {};
    for (const name of WEBHOOK_PRESET_NAMES) {
        try {
            presets[name] = resolveWebhookEventSelection(name, catalog).resolvedEvents;
        }
        catch (error) {
            presets[name] = { unavailable: error instanceof Error ? error.message : String(error) };
        }
    }
    return presets;
}
async function findWebhookEndpointByUrl(client, url) {
    const result = await client.get(WEBHOOK_ENDPOINT_PATH, {
        query: { pageNum: 1, pageSize: 100, url },
        executeInDryRun: true,
    });
    const endpoint = extractEndpointRows(result).find((candidate) => sameEndpointUrl(candidate.url, url));
    return { result, endpoint };
}
export function diffWebhookEvents(existing, resolved) {
    const existingSet = new Set(existing);
    const resolvedSet = new Set(resolved);
    return {
        added: resolved.filter((event) => !existingSet.has(event)),
        removed: existing.filter((event) => !resolvedSet.has(event)),
        unchanged: resolved.filter((event) => existingSet.has(event)),
    };
}
async function authorizeEventRemoval(diff, allowRemoveEvents) {
    if (diff.removed.length === 0)
        return;
    if (!allowRemoveEvents) {
        throw new Error([
            "Webhook endpoint ensure uses replace semantics and would remove existing events.",
            formatEventDiff(diff),
            "Re-run with --allow-remove-events to authorize removal. No endpoint update was sent.",
        ].join(" "));
    }
    if (!process.stdin.isTTY || !process.stderr.isTTY)
        return;
    const prompt = createInterface({ input: process.stdin, output: process.stderr });
    try {
        const answer = await prompt.question(`Ensure will remove ${diff.removed.length} event(s): ${diff.removed.join(", ")}. Continue? [y/N] `);
        if (!/^(?:y|yes)$/i.test(answer.trim())) {
            throw new Error("Webhook endpoint ensure cancelled; no endpoint update was sent.");
        }
    }
    finally {
        prompt.close();
    }
}
async function readBackWebhookEndpoint(client, endpoint, url) {
    if (endpoint?.id) {
        const result = await client.get(`${WEBHOOK_ENDPOINT_PATH}/${encodeURIComponent(endpoint.id)}`, { executeInDryRun: true });
        const detailed = extractEndpoint(result);
        if (detailed)
            return detailed;
    }
    const fromList = await findWebhookEndpointByUrl(client, url);
    if (fromList.endpoint)
        return fromList.endpoint;
    throw new Error(`Webhook endpoint ensure could not read back the endpoint at ${url}; final event set is unverified.`);
}
function assertWebhookEventsMatch(actual, expected, url) {
    const actualNormalized = normalizeEventSet(actual ?? []);
    const expectedNormalized = normalizeEventSet(expected);
    if (actualNormalized.join("\n") === expectedNormalized.join("\n"))
        return;
    throw new Error([
        `Webhook endpoint ensure read-back mismatch for ${url}.`,
        `Expected: ${expectedNormalized.join(", ") || "(none)"}.`,
        `Actual: ${actualNormalized.join(", ") || "(none)"}.`,
        "The endpoint update response is not accepted as verified.",
    ].join(" "));
}
function extractEndpointRows(result) {
    if (isRecord(result) && Array.isArray(result.rows))
        return result.rows.filter(isRecord);
    const data = getEnvelopeData(result);
    if (Array.isArray(data))
        return data.filter(isRecord);
    if (isRecord(data) && Array.isArray(data.rows))
        return data.rows.filter(isRecord);
    if (isRecord(data) && Array.isArray(data.endpoints))
        return data.endpoints.filter(isRecord);
    return [];
}
function sameEndpointUrl(left, right) {
    if (!left)
        return false;
    try {
        return new URL(left).toString() === new URL(right).toString();
    }
    catch {
        return left === right;
    }
}
function normalizeEventSet(events) {
    return [...new Set(events)].sort();
}
function parseOptionalBoolean(name, value) {
    if (value === undefined)
        return undefined;
    if (value === "true")
        return true;
    if (value === "false")
        return false;
    throw new Error(`Option ${name} must be true or false`);
}
function parsePositiveIntegerOption(name, value) {
    const parsed = parseIntegerOption(name, value);
    if (parsed <= 0) {
        throw new Error(`Option ${name} must be greater than 0`);
    }
    return parsed;
}
function parsePageSizeOption(value) {
    const parsed = parsePositiveIntegerOption("--page-size", value);
    if (parsed > 100) {
        throw new Error("Option --page-size must be less than or equal to 100");
    }
    return parsed;
}
function extractEndpoint(result) {
    const data = getEnvelopeData(result);
    if (isRecord(data) && isRecord(data.endpoint))
        return data.endpoint;
    return isRecord(data) ? data : undefined;
}
function getEnvelopeData(result) {
    return isRecord(result) && "data" in result ? result.data : undefined;
}
function extractSigningSecret(result) {
    const endpoint = extractEndpoint(result);
    return typeof endpoint?.signingSecret === "string" && endpoint.signingSecret.length > 0 ? endpoint.signingSecret : undefined;
}
async function saveSigningSecretIfRequested(profile, result, enabled, dryRun) {
    if (!enabled)
        return extractSigningSecret(result);
    if (dryRun)
        return undefined;
    const signingSecret = requireSigningSecret(result);
    await saveProfile(profile, { webhookSigningKey: signingSecret });
    return signingSecret;
}
async function syncEnvAndRestartIfRequested(options, result, dryRun) {
    if (!options.syncEnvFile)
        return undefined;
    if (dryRun) {
        return {
            envFile: options.syncEnvFile,
            key: WEBHOOK_SIGNING_KEY_ENV,
            dryRun: true,
            restartRequired: !options.restartCommand,
            restart: options.restartCommand ? { command: options.restartCommand, ok: true } : undefined,
        };
    }
    const signingSecret = requireSigningSecret(result);
    await writeEnvFileValue(options.syncEnvFile, WEBHOOK_SIGNING_KEY_ENV, signingSecret);
    const envSync = {
        envFile: options.syncEnvFile,
        key: WEBHOOK_SIGNING_KEY_ENV,
        written: true,
        restartRequired: !options.restartCommand,
    };
    if (options.restartCommand) {
        envSync.restart = await runRestartCommand(options.restartCommand);
        envSync.restartRequired = false;
    }
    return envSync;
}
function requireSigningSecret(result) {
    const signingSecret = extractSigningSecret(result);
    if (signingSecret)
        return signingSecret;
    const data = getEnvelopeData(result);
    const nextAction = isRecord(data) && typeof data.nextAction === "string"
        ? data.nextAction
        : undefined;
    throw new Error([
        "Clink did not return a plaintext webhook signing secret.",
        nextAction ? `Next action: ${nextAction}.` : "Use rotate-secret, or retry ensure with --rotate-secret.",
    ].join(" "));
}
async function writeEnvFileValue(filePath, key, value) {
    let raw = "";
    try {
        raw = await readFile(filePath, "utf8");
    }
    catch (error) {
        if (error.code !== "ENOENT")
            throw error;
    }
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, upsertEnvValue(raw, key, value), "utf8");
}
export function upsertEnvValue(raw, key, value) {
    const line = `${key}=${formatEnvValue(value)}`;
    const pattern = new RegExp(`^(\\s*(?:export\\s+)?${escapeRegExp(key)}\\s*=).*$`, "m");
    if (pattern.test(raw)) {
        return raw.replace(pattern, (_match, prefix) => `${prefix}${formatEnvValue(value)}`);
    }
    const prefix = raw.length === 0 || raw.endsWith("\n") ? raw : `${raw}\n`;
    return `${prefix}${line}\n`;
}
function formatEnvValue(value) {
    return /^[A-Za-z0-9_./:=+-]+$/.test(value) ? value : JSON.stringify(value);
}
async function runRestartCommand(command) {
    const { stdout, stderr } = await execAsync(command, { windowsHide: true });
    return {
        command,
        ok: true,
        stdout: truncateCommandOutput(stdout),
        stderr: truncateCommandOutput(stderr),
    };
}
function truncateCommandOutput(value) {
    if (!value)
        return undefined;
    const trimmed = value.trim();
    return trimmed.length > 1000 ? `${trimmed.slice(0, 1000)}...` : trimmed;
}
function formatEnvSyncLine(envSync) {
    if (!envSync)
        return undefined;
    if (envSync.dryRun) {
        return `Dry run: would write ${envSync.key} to ${envSync.envFile}.`;
    }
    const restart = envSync.restart
        ? ` Restart command completed: ${envSync.restart.command}`
        : " Restart or redeploy the app before verifying webhooks.";
    return `Synced ${envSync.key} to ${envSync.envFile}.${restart}`;
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function maskWebhookSecrets(value, showSecret) {
    if (showSecret)
        return value;
    if (Array.isArray(value))
        return value.map((item) => maskWebhookSecrets(item, false));
    if (!isRecord(value))
        return value;
    const result = {};
    for (const [key, nestedValue] of Object.entries(value)) {
        if (key === "signingSecret" && typeof nestedValue === "string") {
            result[key] = maskSecret(nestedValue);
        }
        else {
            result[key] = maskWebhookSecrets(nestedValue, false);
        }
    }
    return result;
}
function formatEventCatalog(events) {
    return events
        .map((event) => [event.name, event.code, event.description].filter((value) => value !== undefined).join("\t"))
        .join("\n");
}
function formatPresetCatalog(presets) {
    return Object.entries(presets)
        .map(([name, value]) => Array.isArray(value)
        ? `${name}\t${value.length}\t${value.join(", ")}`
        : `${name}\tunavailable\t${value.unavailable}`)
        .join("\n");
}
function formatEventSelection(selection) {
    return [
        `Resolved events (${selection.resolvedEvents.length}): ${selection.resolvedEvents.join(", ")}`,
        ...Object.entries(selection.presetExpansions).map(([name, events]) => `Preset ${name} expands to ${events.length}: ${events.join(", ")}`),
        ...selection.warnings.map((warning) => `Warning: ${warning}`),
    ].join("\n");
}
function formatEventDiff(diff) {
    return [
        `Added (${diff.added.length}): ${diff.added.join(", ") || "(none)"}.`,
        `Removed (${diff.removed.length}): ${diff.removed.join(", ") || "(none)"}.`,
        `Unchanged (${diff.unchanged.length}): ${diff.unchanged.join(", ") || "(none)"}.`,
    ].join(" ");
}
function formatEndpointList(result) {
    const rows = extractEndpointRows(result);
    if (rows.length === 0)
        return "No webhook endpoints found.";
    return rows.map((endpoint) => formatEndpointLine(endpoint)).join("\n");
}
function formatEndpointLine(endpoint) {
    if (!endpoint)
        return "Webhook endpoint response received.";
    return [
        endpoint.id ?? "unknown",
        endpoint.url ?? "unknown-url",
        endpoint.events ? `${endpoint.events.length} events` : undefined,
        endpoint.enabled === undefined ? undefined : `enabled=${endpoint.enabled}`,
        endpoint.maskedSigningSecret ? `signingSecret=${endpoint.maskedSigningSecret}` : undefined,
    ]
        .filter(Boolean)
        .join(" ");
}
function formatEnsureSource(source) {
    if (source === "created")
        return "Created";
    if (source === "updated")
        return "Updated";
    if (source === "rotated")
        return "Rotated";
    if (source === "updated_rotated")
        return "Updated and rotated";
    return "Found";
}
function formatSigningSecretLine(endpoint, showSecret) {
    const secret = endpoint?.signingSecret;
    if (typeof secret === "string" && secret.length > 0) {
        return `Signing secret: ${showSecret ? secret : maskSecret(secret)}`;
    }
    if (endpoint?.maskedSigningSecret) {
        return `Signing secret: ${endpoint.maskedSigningSecret}`;
    }
    return undefined;
}
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
//# sourceMappingURL=webhook-endpoints.js.map