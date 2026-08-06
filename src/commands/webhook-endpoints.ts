import { exec } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { promisify } from "node:util";
import type { Command } from "commander";
import type { ClinkApiClient } from "../api/client.js";
import { assertAtomicTextFileTarget, writeTextFileAtomically } from "../atomic-write.js";
import { getConfigPath, saveProfile } from "../config.js";
import { maskSecret, parseIntegerOption, printResult, requireOption } from "../output.js";
import {
  WEBHOOK_CHECKOUT_EVENTS,
  WEBHOOK_COMMERCE_EVENTS,
  WEBHOOK_CORE_EVENTS,
  WEBHOOK_DISPUTE_EVENTS,
  WEBHOOK_PAYMENT_METHOD_EVENTS,
  WEBHOOK_PRESET_NAMES,
  WEBHOOK_SUBSCRIPTION_EVENTS,
  parseWebhookRuntimeCatalog,
  resolveWebhookEventSelection,
  type WebhookEventSelection,
  type WebhookRuntimeCatalog,
} from "../webhook/event-catalog.js";
import { getCommandContext } from "./helpers.js";

const WEBHOOK_ENDPOINT_PATH = "/webhook/endpoints";
const WEBHOOK_SIGNING_KEY_ENV = "CLINK_WEBHOOK_SIGNING_KEY";
const execAsync = promisify(exec);
const ENDPOINT_EVENT_PRESET_HELP = [
  "",
  "Preset expansion (validated against the selected environment's GET /webhook/events):",
  `  core (${WEBHOOK_CORE_EVENTS.length}; compatibility only): ${WEBHOOK_CORE_EVENTS.join(", ")}`,
  "    Warning: core omits the full subscription lifecycle, dunning/past_due, cancellation, disputes/chargebacks, refund.failed, and session.expired.",
  `  checkout (${WEBHOOK_CHECKOUT_EVENTS.length}): ${WEBHOOK_CHECKOUT_EVENTS.join(", ")}`,
  `  subscriptions (${WEBHOOK_SUBSCRIPTION_EVENTS.length}): ${WEBHOOK_SUBSCRIPTION_EVENTS.join(", ")}`,
  `  disputes (${WEBHOOK_DISPUTE_EVENTS.length}): ${WEBHOOK_DISPUTE_EVENTS.join(", ")}`,
  `  payment-methods (${WEBHOOK_PAYMENT_METHOD_EVENTS.length}): ${WEBHOOK_PAYMENT_METHOD_EVENTS.join(", ")}`,
  `  commerce (${WEBHOOK_COMMERCE_EVENTS.length}): ${WEBHOOK_COMMERCE_EVENTS.join(", ")}`,
  "  all (dynamic): every event returned by the runtime catalog, including future additions.",
].join("\n");

type WebhookEndpoint = {
  id?: string;
  url?: string;
  events?: string[];
  enabled?: boolean;
  signingSecret?: string | null;
  maskedSigningSecret?: string | null;
  description?: string | null;
  createdAt?: number | null;
  updatedAt?: number | null;
};

type WebhookEndpointEnvelope<T = unknown> = {
  code?: number;
  msg?: string;
  data?: T;
};

type WebhookEndpointListResponse = {
  total?: number;
  rows?: WebhookEndpoint[];
  code?: number;
  msg?: string;
};

type WebhookEndpointEnsureData = {
  source?: string;
  endpoint?: WebhookEndpoint;
  signingSecretAvailable?: boolean;
  signingSecretUnavailableReason?: string | null;
  nextAction?: string | null;
};

type RegisterWebhookEndpointOptions = {
  legacyDashboardOptions?: boolean;
};

type EventOptions = {
  allowUnknownEvents?: boolean;
};

type CommonWriteOptions = EventOptions & {
  url?: string;
  events?: string;
  description?: string;
  remark?: string;
  disabled?: boolean;
  showSecret?: boolean;
  saveSecret?: boolean;
  merchantId?: string;
  syncEnvFile?: string;
  restartCommand?: string;
};

type EnsureOptions = CommonWriteOptions & {
  rotateSecret?: boolean;
  rotateSecretIfUnavailable?: boolean;
  returnSigningSecret?: boolean;
  allowRemoveEvents?: boolean;
};

type WebhookEventDiff = {
  added: string[];
  removed: string[];
  unchanged: string[];
};

type EnvSyncResult = {
  envFile: string;
  key: typeof WEBHOOK_SIGNING_KEY_ENV;
  dryRun?: boolean;
  written?: boolean;
  restartRequired?: boolean;
  restart?: {
    command: string;
    ok: boolean;
    stdout?: string;
    stderr?: string;
  };
};

type SigningSecretPersistence = {
  saved: boolean;
  signingSecret?: string;
  envSync?: EnvSyncResult;
};

type EnvFileSnapshot = {
  filePath: string;
  existed: boolean;
  raw: string;
};

export function registerWebhookEndpointSubcommands(parent: Command, options: RegisterWebhookEndpointOptions = {}): void {
  parent
    .command("events")
    .description("List the runtime webhook event catalog, aliases, and CLI presets")
    .addHelpText("after", ENDPOINT_EVENT_PRESET_HELP)
    .action(async function (this: Command) {
      const { config, client } = await getCommandContext(this);
      const { result, catalog } = await loadRuntimeWebhookCatalog(client);
      const presets = describeRuntimePresets(catalog);
      printResult(
        {
          result,
          events: catalog.events,
          aliases: catalog.aliases,
          presets,
        },
        config.outputMode,
        [formatEventCatalog(catalog.events), "", formatPresetCatalog(presets)].join("\n"),
      );
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
  list.action(async function (
    this: Command,
    listOptions: { page: string; pageSize: string; enabled?: string; url?: string; merchantId?: string; showSecret?: boolean },
  ) {
    const { config, client } = await getCommandContext(this);
    const query = {
      pageNum: parsePositiveIntegerOption("--page", listOptions.page),
      pageSize: parsePageSizeOption(listOptions.pageSize),
      enabled: parseOptionalBoolean("--enabled", listOptions.enabled),
      url: listOptions.url,
    };
    const result = await client.get<WebhookEndpointListResponse>(WEBHOOK_ENDPOINT_PATH, { query });
    const safeResult = maskWebhookSecrets(result, false);
    printResult(
      {
        profile: config.profile,
        ignoredMerchantId: listOptions.merchantId,
        ignoredShowSecret: listOptions.showSecret,
        result: safeResult,
      },
      config.outputMode,
      config.dryRun ? "Webhook endpoint list dry-run generated. Use --json to view request metadata." : formatEndpointList(result),
    );
  });

  parent
    .command("get <endpoint-id>")
    .description("Get a webhook endpoint by ID")
    .action(async function (this: Command, endpointId: string) {
      requireOption("endpoint-id", endpointId);
      const { config, client } = await getCommandContext(this);
      const result = await client.get<WebhookEndpointEnvelope<WebhookEndpoint>>(`${WEBHOOK_ENDPOINT_PATH}/${encodeURIComponent(endpointId)}`);
      printResult(
        {
          profile: config.profile,
          result: maskWebhookSecrets(result, false),
        },
        config.outputMode,
        config.dryRun ? "Webhook endpoint get dry-run generated. Use --json to view request metadata." : formatEndpointLine(extractEndpoint(result)),
      );
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
    .option("--disabled", "Create the webhook but leave it disabled")
    .addHelpText("after", ENDPOINT_EVENT_PRESET_HELP);
  addEnvSyncOptions(create);
  addLegacyDashboardOptions(create, options);
  create.action(async function (this: Command, createOptions: CommonWriteOptions) {
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
    await preflightSigningSecretDestinations(createOptions, config.dryRun);
    const result = await client.post<WebhookEndpointEnvelope<WebhookEndpoint>, typeof body>(WEBHOOK_ENDPOINT_PATH, { body });
    const persistence = await persistSigningSecretDestinations(config.profile, createOptions, result, config.dryRun);
    const envSync = await finishRestartAfterPersistence(createOptions, persistence, config.dryRun);
    const endpoint = extractEndpoint(result);
    printResult(
      {
        profile: config.profile,
        ignoredMerchantId: createOptions.merchantId,
        eventSelection,
        saved: persistence.saved,
        envSync,
        endpoint: maskWebhookSecrets(endpoint, Boolean(createOptions.showSecret)),
        result: maskWebhookSecrets(result, Boolean(createOptions.showSecret)),
      },
      config.outputMode,
      [
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
        .join("\n"),
    );
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
    .option("--show-secret", "Print the full rotated signing secret in command output")
    .addHelpText("after", ENDPOINT_EVENT_PRESET_HELP);
  addEnvSyncOptions(update);
  addLegacyDashboardOptions(update, options);
  update.action(async function (
    this: Command,
    endpointId: string,
    updateOptions: CommonWriteOptions & { enabled?: string; rotateSecret?: boolean },
  ) {
    requireOption("endpoint-id", endpointId);
    const { config, client } = await getCommandContext(this);
    const eventSelection = updateOptions.events
      ? resolveWebhookEventSelection(
          updateOptions.events,
          (await loadRuntimeWebhookCatalog(client)).catalog,
          { allowUnknownEvents: Boolean(updateOptions.allowUnknownEvents) },
        )
      : undefined;
    const body = buildUpdateBody(updateOptions, eventSelection?.resolvedEvents);
    const shouldRotate = Boolean(updateOptions.rotateSecret || updateOptions.saveSecret || updateOptions.showSecret || updateOptions.syncEnvFile);
    if (Object.keys(body).length === 0 && !shouldRotate) {
      throw new Error("Provide at least one of --url, --events, --description, --remark, --enabled, --disabled, or --rotate-secret.");
    }
    await preflightSigningSecretDestinations(updateOptions, config.dryRun);

    const updateResult = Object.keys(body).length > 0
      ? await client.patch<WebhookEndpointEnvelope<WebhookEndpoint>, typeof body>(`${WEBHOOK_ENDPOINT_PATH}/${encodeURIComponent(endpointId)}`, { body })
      : undefined;
    const rotateResult = shouldRotate
      ? await client.post<WebhookEndpointEnvelope<WebhookEndpoint>>(`${WEBHOOK_ENDPOINT_PATH}/${encodeURIComponent(endpointId)}/rotate-secret`)
      : undefined;
    const result = rotateResult ?? updateResult;
    const persistence = await persistSigningSecretDestinations(config.profile, updateOptions, result, config.dryRun);
    const envSync = await finishRestartAfterPersistence(updateOptions, persistence, config.dryRun);
    const endpoint = extractEndpoint(result);
    printResult(
      {
        profile: config.profile,
        ignoredMerchantId: updateOptions.merchantId,
        eventSelection,
        saved: persistence.saved,
        envSync,
        updateResult: maskWebhookSecrets(updateResult, false),
        rotateResult: maskWebhookSecrets(rotateResult, Boolean(updateOptions.showSecret)),
        endpoint: maskWebhookSecrets(endpoint, Boolean(updateOptions.showSecret)),
      },
      config.outputMode,
      [
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
        .join("\n"),
    );
  });

  parent
    .command("delete <endpoint-id>")
    .description("Delete a webhook endpoint")
    .action(async function (this: Command, endpointId: string) {
      requireOption("endpoint-id", endpointId);
      const { config, client } = await getCommandContext(this);
      const result = await client.delete<WebhookEndpointEnvelope<null>>(`${WEBHOOK_ENDPOINT_PATH}/${encodeURIComponent(endpointId)}`);
      printResult(
        {
          profile: config.profile,
          endpointId,
          result,
        },
        config.outputMode,
        config.dryRun ? "Webhook endpoint delete dry-run generated. Use --json to view request metadata." : `Deleted webhook endpoint: ${endpointId}`,
      );
    });

  parent
    .command("enable <endpoint-id>")
    .description("Enable a webhook endpoint")
    .action(async function (this: Command, endpointId: string) {
      await updateEndpointEnabled(this, endpointId, true);
    });

  parent
    .command("disable <endpoint-id>")
    .description("Disable a webhook endpoint")
    .action(async function (this: Command, endpointId: string) {
      await updateEndpointEnabled(this, endpointId, false);
    });

  const rotateSecret = parent
    .command("rotate-secret <endpoint-id>")
    .description("Rotate a webhook endpoint signing secret")
    .option("--save-secret", "Save the rotated signing secret into the current clink profile")
    .option("--show-secret", "Print the full signing secret in command output");
  addEnvSyncOptions(rotateSecret);
  rotateSecret.action(async function (this: Command, endpointId: string, rotateOptions: { saveSecret?: boolean; showSecret?: boolean; syncEnvFile?: string; restartCommand?: string }) {
      requireOption("endpoint-id", endpointId);
      const { config, client } = await getCommandContext(this);
      await preflightSigningSecretDestinations(rotateOptions, config.dryRun);
      const result = await client.post<WebhookEndpointEnvelope<WebhookEndpoint>>(`${WEBHOOK_ENDPOINT_PATH}/${encodeURIComponent(endpointId)}/rotate-secret`);
      const persistence = await persistSigningSecretDestinations(config.profile, rotateOptions, result, config.dryRun);
      const envSync = await finishRestartAfterPersistence(rotateOptions, persistence, config.dryRun);
      const endpoint = extractEndpoint(result);
      printResult(
        {
          profile: config.profile,
          saved: persistence.saved,
          envSync,
          endpoint: maskWebhookSecrets(endpoint, Boolean(rotateOptions.showSecret)),
          result: maskWebhookSecrets(result, Boolean(rotateOptions.showSecret)),
        },
        config.outputMode,
        config.dryRun
          ? "Webhook signing secret rotate dry-run generated. Use --json to view request metadata."
          : [
              `Rotated webhook signing secret: ${endpoint?.url ?? endpointId}`,
              `Endpoint ID: ${endpoint?.id ?? endpointId}`,
              formatSigningSecretLine(endpoint, Boolean(rotateOptions.showSecret)),
              rotateOptions.saveSecret ? `Saved signing secret into profile "${config.profile}".` : "Signing secret was not saved. Re-run with --save-secret to store it.",
              formatEnvSyncLine(envSync),
            ]
              .filter(Boolean)
              .join("\n"),
      );
    });

  const ensure = parent
    .command("ensure")
    .description("Create or merge a webhook endpoint by URL; use --allow-remove-events for explicit replacement")
    .requiredOption("--url <https-url>", "HTTPS webhook endpoint URL")
    .requiredOption("--events <events>", "Event names or combinable presets: core, checkout, subscriptions, disputes, payment-methods, commerce, all")
    .option("--description <text>", "Webhook endpoint description")
    .option("--remark <text>", "Alias for --description")
    .option("--save-secret", "Save the resolved signing secret into the current clink profile")
    .option("--show-secret", "Print the full signing secret in command output")
    .option("--allow-unknown-events", "Deprecated; runtime GET /webhook/events validation is always enforced")
    .option("--allow-remove-events", "Replace the endpoint event set and explicitly allow removal of existing events")
    .option("--disabled", "Create or update the webhook but leave it disabled")
    .option("--return-signing-secret", "Request plaintext signing secret when available")
    .option("--rotate-secret", "Always rotate the signing secret for an existing endpoint")
    .option("--no-rotate-secret-if-unavailable", "Do not rotate existing endpoints when plaintext secret is unavailable")
    .addHelpText("after", ENDPOINT_EVENT_PRESET_HELP);
  addEnvSyncOptions(ensure);
  addLegacyDashboardOptions(ensure, options);
  ensure.action(async function (this: Command, ensureOptions: EnsureOptions) {
    const { config, client } = await getCommandContext(this);
    const { catalog } = await loadRuntimeWebhookCatalog(client);
    const eventSelection = resolveWebhookEventSelection(ensureOptions.events, catalog, {
      allowUnknownEvents: Boolean(ensureOptions.allowUnknownEvents),
    });
    const endpointUrl = parseHttpsEndpoint(ensureOptions.url);
    const preflight = await findWebhookEndpointByUrl(client, endpointUrl);
    const existingEvents = preflight.endpoint?.events ?? [];
    const operation = preflight.endpoint
      ? ensureOptions.allowRemoveEvents ? "replace" : "merge"
      : "create";
    const finalEvents = operation === "replace"
      ? eventSelection.resolvedEvents
      : mergeWebhookEvents(existingEvents, eventSelection.resolvedEvents);
    const eventDiff = diffWebhookEvents(existingEvents, finalEvents);
    if (eventDiff.removed.length > 0) {
      printEnsureRemovalPreview(config.outputMode, eventDiff, finalEvents);
    }
    await authorizeEventRemoval(eventDiff, operation === "replace");

    const hasSecretDestination = Boolean(
      ensureOptions.saveSecret ||
      ensureOptions.showSecret ||
      ensureOptions.syncEnvFile,
    );
    if ((ensureOptions.returnSigningSecret || ensureOptions.rotateSecret) && !hasSecretDestination) {
      throw new Error(
        "Options --return-signing-secret and --rotate-secret require --save-secret, --sync-env-file, or explicit --show-secret so a rotated secret is not discarded.",
      );
    }
    await preflightSigningSecretDestinations(ensureOptions, config.dryRun);
    const wantsSigningSecret = hasSecretDestination;
    const body = {
      url: endpointUrl,
      events: finalEvents,
      description: getDescription(ensureOptions),
      enabled: !ensureOptions.disabled,
      returnSigningSecret: wantsSigningSecret || undefined,
      rotateSecretIfUnavailable: wantsSigningSecret && ensureOptions.rotateSecretIfUnavailable !== false ? true : undefined,
      rotateSecret: ensureOptions.rotateSecret || undefined,
    };
    const result = await client.put<WebhookEndpointEnvelope<WebhookEndpointEnsureData>, typeof body>(
      `${WEBHOOK_ENDPOINT_PATH}/ensure`,
      { body },
    );
    const data = result.data;
    const endpoint = data?.endpoint;
    const persistence = await persistSigningSecretDestinations(
      config.profile,
      ensureOptions,
      result,
      config.dryRun,
    );
    const envSync = await finishRestartAfterPersistence(ensureOptions, persistence, config.dryRun);

    let verifiedEndpoint: WebhookEndpoint | undefined;
    const verification = config.dryRun
      ? { performed: false, status: "skipped-dry-run" }
      : { performed: true, status: "verified" };
    if (!config.dryRun) {
      try {
        verifiedEndpoint = await readBackWebhookEndpoint(client, endpoint, endpointUrl);
        assertWebhookEventsMatch(verifiedEndpoint?.events, finalEvents, endpointUrl);
      } catch (error) {
        if (ensureOptions.showSecret && persistence.signingSecret) {
          process.stderr.write(`Signing secret recovery (explicit --show-secret): ${persistence.signingSecret}\n`);
        }
        const persistenceNotice = envSync?.restart
          ? "The returned signing secret was persisted and the requested restart completed before read-back."
          : envSync?.restartRequired
            ? "The returned signing secret was persisted before read-back; restart or redeploy the application now."
            : persistence.saved
              ? "The returned signing secret was saved to the CLI profile before read-back; synchronize the application runtime if needed."
              : undefined;
        throw new Error([
          error instanceof Error ? error.message : String(error),
          persistenceNotice,
        ].filter(Boolean).join(" "));
      }
    }

    printResult(
      {
        profile: config.profile,
        ignoredMerchantId: ensureOptions.merchantId,
        operation,
        eventSelection,
        requestedEvents: eventSelection.resolvedEvents,
        finalEvents,
        eventDiff,
        allowRemoveEvents: Boolean(ensureOptions.allowRemoveEvents),
        existingEndpoint: maskWebhookSecrets(preflight.endpoint, false),
        preflightResult: maskWebhookSecrets(preflight.result, false),
        verification,
        verifiedEndpoint: maskWebhookSecrets(verifiedEndpoint, false),
        saved: persistence.saved,
        envSync,
        source: data?.source,
        signingSecretAvailable: data?.signingSecretAvailable,
        signingSecretUnavailableReason: data?.signingSecretUnavailableReason,
        nextAction: data?.nextAction,
        endpoint: maskWebhookSecrets(endpoint, Boolean(ensureOptions.showSecret)),
        result: maskWebhookSecrets(result, Boolean(ensureOptions.showSecret)),
      },
      config.outputMode,
          [
            formatEventSelection(eventSelection),
            formatEnsureEventBehavior(operation),
            formatEventDiff(eventDiff),
            config.dryRun ? "Dry run: no endpoint was written and read-back verification was skipped." : undefined,
            `${formatEnsureSource(data?.source)} webhook endpoint: ${endpoint?.url ?? body.url}`,
            `Endpoint ID: ${endpoint?.id ?? "unknown"}`,
            `Events: ${(endpoint?.events ?? body.events).join(", ")}`,
            `Enabled: ${endpoint?.enabled ?? body.enabled}`,
            config.dryRun ? undefined : "Read-back verification: final event set exactly matches the computed target events.",
            formatSigningSecretLine(endpoint, Boolean(ensureOptions.showSecret)),
            ensureOptions.saveSecret ? `Saved signing secret into profile "${config.profile}".` : "Signing secret was not saved. Re-run with --save-secret to store it.",
            formatEnvSyncLine(envSync),
            data?.nextAction ? `Next action: ${data.nextAction}` : undefined,
          ]
            .filter(Boolean)
            .join("\n"),
    );
  });
}

function addLegacyDashboardOptions(command: Command, options: RegisterWebhookEndpointOptions): void {
  if (!options.legacyDashboardOptions) return;
  command.option("--merchant-id <id>", "Ignored; the Secret Key selects the current merchant");
}

function addEnvSyncOptions(command: Command): void {
  command
    .option("--sync-env-file <path>", `Write ${WEBHOOK_SIGNING_KEY_ENV} to an env file after resolving the plaintext signing secret`)
    .option("--restart-command <command>", "Run this shell command after --sync-env-file is updated");
}

async function updateEndpointEnabled(command: Command, endpointId: string, enabled: boolean): Promise<void> {
  requireOption("endpoint-id", endpointId);
  const { config, client } = await getCommandContext(command);
  const result = await client.post<WebhookEndpointEnvelope<WebhookEndpoint>>(
    `${WEBHOOK_ENDPOINT_PATH}/${encodeURIComponent(endpointId)}/${enabled ? "enable" : "disable"}`,
  );
  const endpoint = extractEndpoint(result);
  printResult(
    {
      profile: config.profile,
      endpointId,
      endpoint: maskWebhookSecrets(endpoint, false),
      result: maskWebhookSecrets(result, false),
    },
    config.outputMode,
    config.dryRun
      ? `Webhook endpoint ${enabled ? "enable" : "disable"} dry-run generated. Use --json to view request metadata.`
      : `${enabled ? "Enabled" : "Disabled"} webhook endpoint: ${endpoint?.url ?? endpointId}`,
  );
}

function buildUpdateBody(
  options: CommonWriteOptions & { enabled?: string },
  resolvedEvents?: string[],
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (options.url) body.url = parseHttpsEndpoint(options.url);
  if (options.events) {
    if (!resolvedEvents) throw new Error("Internal error: webhook events were not resolved from the runtime catalog.");
    body.events = resolvedEvents;
  }
  const description = getDescription(options);
  if (description !== undefined) body.description = description;
  const enabled = parseEndpointEnabled(options);
  if (enabled !== undefined) body.enabled = enabled;
  return body;
}

function parseEndpointEnabled(options: { enabled?: string; disabled?: boolean }): boolean | undefined {
  if (options.enabled !== undefined && options.disabled) {
    throw new Error("Use either --enabled or --disabled, not both.");
  }
  if (options.disabled) return false;
  return parseOptionalBoolean("--enabled", options.enabled);
}

function getDescription(options: { description?: string; remark?: string }): string | undefined {
  if (options.description !== undefined && options.remark !== undefined && options.description !== options.remark) {
    throw new Error("Use either --description or --remark, not both.");
  }
  return options.description ?? options.remark;
}

function parseHttpsEndpoint(value: string | undefined): string {
  requireOption("--url", value);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
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

function isBlockedWebhookHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^169\.254\./.test(host) || /^192\.168\./.test(host)) return true;
  const match = /^172\.(\d+)\./.exec(host);
  if (match) {
    const second = Number(match[1]);
    if (second >= 16 && second <= 31) return true;
  }
  const firstOctet = /^(\d+)\./.exec(host);
  if (firstOctet) {
    const first = Number(firstOctet[1]);
    if (first >= 224 && first <= 239) return true;
  }
  return false;
}

async function loadRuntimeWebhookCatalog(client: ClinkApiClient): Promise<{
  result: WebhookEndpointEnvelope;
  catalog: WebhookRuntimeCatalog;
}> {
  const result = await client.get<WebhookEndpointEnvelope>("/webhook/events", { executeInDryRun: true });
  return { result, catalog: parseWebhookRuntimeCatalog(result) };
}

function describeRuntimePresets(catalog: WebhookRuntimeCatalog): Record<string, string[] | { unavailable: string }> {
  const presets: Record<string, string[] | { unavailable: string }> = {};
  for (const name of WEBHOOK_PRESET_NAMES) {
    try {
      presets[name] = resolveWebhookEventSelection(name, catalog).resolvedEvents;
    } catch (error) {
      presets[name] = { unavailable: error instanceof Error ? error.message : String(error) };
    }
  }
  return presets;
}

async function findWebhookEndpointByUrl(
  client: ClinkApiClient,
  url: string,
): Promise<{ result: WebhookEndpointListResponse; endpoint?: WebhookEndpoint }> {
  const result = await client.get<WebhookEndpointListResponse>(WEBHOOK_ENDPOINT_PATH, {
    query: { pageNum: 1, pageSize: 100, url },
    executeInDryRun: true,
  });
  const endpoint = extractEndpointRows(result).find((candidate) => sameEndpointUrl(candidate.url, url));
  if (!endpoint || Array.isArray(endpoint.events)) return { result, endpoint };

  if (endpoint.id) {
    const detailResult = await client.get<WebhookEndpointEnvelope<WebhookEndpoint>>(
      `${WEBHOOK_ENDPOINT_PATH}/${encodeURIComponent(endpoint.id)}`,
      { executeInDryRun: true },
    );
    const detailed = extractEndpoint(detailResult);
    if (detailed && Array.isArray(detailed.events)) {
      return { result, endpoint: detailed };
    }
  }

  throw new Error(
    `Existing webhook endpoint at ${url} did not expose its current events; refusing to merge or replace an unknown event set.`,
  );
}

export function diffWebhookEvents(existing: string[], resolved: string[]): WebhookEventDiff {
  const existingSet = new Set(existing);
  const resolvedSet = new Set(resolved);
  return {
    added: resolved.filter((event) => !existingSet.has(event)),
    removed: existing.filter((event) => !resolvedSet.has(event)),
    unchanged: resolved.filter((event) => existingSet.has(event)),
  };
}

export function mergeWebhookEvents(existing: string[], requested: string[]): string[] {
  return [...new Set([...existing, ...requested])];
}

function printEnsureRemovalPreview(
  mode: "pretty" | "json",
  diff: WebhookEventDiff,
  finalEvents: string[],
): void {
  if (mode === "json") {
    process.stderr.write(`${JSON.stringify({
      kind: "webhook_endpoint_ensure_preview",
      operation: "replace",
      eventDiff: diff,
      finalEvents,
    })}\n`);
    return;
  }
  process.stderr.write(`Webhook endpoint replacement preview. ${formatEventDiff(diff)} Final events (${finalEvents.length}): ${finalEvents.join(", ")}\n`);
}

async function authorizeEventRemoval(diff: WebhookEventDiff, allowRemoveEvents: boolean): Promise<void> {
  if (diff.removed.length === 0) return;
  if (!allowRemoveEvents) {
    throw new Error(
      [
        "The computed webhook endpoint target would remove existing events.",
        formatEventDiff(diff),
        "Use --allow-remove-events to select explicit replacement semantics. No endpoint update was sent.",
      ].join(" "),
    );
  }

  if (!process.stdin.isTTY || !process.stderr.isTTY) return;
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await prompt.question(
      `Ensure will remove ${diff.removed.length} event(s): ${diff.removed.join(", ")}. Continue? [y/N] `,
    );
    if (!/^(?:y|yes)$/i.test(answer.trim())) {
      throw new Error("Webhook endpoint ensure cancelled; no endpoint update was sent.");
    }
  } finally {
    prompt.close();
  }
}

async function readBackWebhookEndpoint(
  client: ClinkApiClient,
  endpoint: WebhookEndpoint | undefined,
  url: string,
): Promise<WebhookEndpoint> {
  if (endpoint?.id) {
    const result = await client.get<WebhookEndpointEnvelope<WebhookEndpoint>>(
      `${WEBHOOK_ENDPOINT_PATH}/${encodeURIComponent(endpoint.id)}`,
      { executeInDryRun: true },
    );
    const detailed = extractEndpoint(result);
    if (detailed) return detailed;
  }

  const fromList = await findWebhookEndpointByUrl(client, url);
  if (fromList.endpoint) return fromList.endpoint;
  throw new Error(`Webhook endpoint ensure could not read back the endpoint at ${url}; final event set is unverified.`);
}

function assertWebhookEventsMatch(actual: string[] | undefined, expected: string[], url: string): void {
  const actualNormalized = normalizeEventSet(actual ?? []);
  const expectedNormalized = normalizeEventSet(expected);
  if (actualNormalized.join("\n") === expectedNormalized.join("\n")) return;
  throw new Error(
    [
      `Webhook endpoint ensure read-back mismatch for ${url}.`,
      `Expected: ${expectedNormalized.join(", ") || "(none)"}.`,
      `Actual: ${actualNormalized.join(", ") || "(none)"}.`,
      "The endpoint update response is not accepted as verified.",
    ].join(" "),
  );
}

function extractEndpointRows(result: unknown): WebhookEndpoint[] {
  if (isRecord(result) && Array.isArray(result.rows)) return result.rows.filter(isRecord) as WebhookEndpoint[];
  const data = getEnvelopeData(result);
  if (Array.isArray(data)) return data.filter(isRecord) as WebhookEndpoint[];
  if (isRecord(data) && Array.isArray(data.rows)) return data.rows.filter(isRecord) as WebhookEndpoint[];
  if (isRecord(data) && Array.isArray(data.endpoints)) return data.endpoints.filter(isRecord) as WebhookEndpoint[];
  return [];
}

function sameEndpointUrl(left: string | undefined, right: string): boolean {
  if (!left) return false;
  try {
    return new URL(left).toString() === new URL(right).toString();
  } catch {
    return left === right;
  }
}

function normalizeEventSet(events: string[]): string[] {
  return [...new Set(events)].sort();
}

function parseOptionalBoolean(name: string, value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Option ${name} must be true or false`);
}

function parsePositiveIntegerOption(name: string, value: string | number | undefined): number {
  const parsed = parseIntegerOption(name, value);
  if (parsed <= 0) {
    throw new Error(`Option ${name} must be greater than 0`);
  }
  return parsed;
}

function parsePageSizeOption(value: string | number | undefined): number {
  const parsed = parsePositiveIntegerOption("--page-size", value);
  if (parsed > 100) {
    throw new Error("Option --page-size must be less than or equal to 100");
  }
  return parsed;
}

function extractEndpoint(result: unknown): WebhookEndpoint | undefined {
  const data = getEnvelopeData(result);
  if (isRecord(data) && isRecord(data.endpoint)) return data.endpoint as WebhookEndpoint;
  return isRecord(data) ? data as WebhookEndpoint : undefined;
}

function getEnvelopeData(result: unknown): unknown {
  return isRecord(result) && "data" in result ? result.data : undefined;
}

function extractSigningSecret(result: unknown): string | undefined {
  const endpoint = extractEndpoint(result);
  return typeof endpoint?.signingSecret === "string" && endpoint.signingSecret.length > 0 ? endpoint.signingSecret : undefined;
}

async function preflightSigningSecretDestinations(
  options: { saveSecret?: boolean; syncEnvFile?: string; restartCommand?: string },
  dryRun: boolean,
): Promise<void> {
  if (options.restartCommand && !options.syncEnvFile) {
    throw new Error("Option --restart-command requires --sync-env-file.");
  }
  if (dryRun) return;
  if (options.saveSecret) {
    await assertAtomicTextFileTarget(getConfigPath());
  }
  if (options.syncEnvFile) {
    await assertAtomicTextFileTarget(options.syncEnvFile);
  }
}

async function persistSigningSecretDestinations(
  profile: string,
  options: { saveSecret?: boolean; syncEnvFile?: string; restartCommand?: string },
  result: unknown,
  dryRun: boolean,
): Promise<SigningSecretPersistence> {
  const shouldSave = Boolean(options.saveSecret);
  const shouldSync = Boolean(options.syncEnvFile);
  if (!shouldSave && !shouldSync) {
    return { saved: false, signingSecret: extractSigningSecret(result) };
  }

  if (dryRun) {
    return {
      saved: false,
      envSync: options.syncEnvFile
        ? {
            envFile: options.syncEnvFile,
            key: WEBHOOK_SIGNING_KEY_ENV,
            dryRun: true,
            restartRequired: !options.restartCommand,
            restart: options.restartCommand
              ? { command: sanitizeSensitiveText(options.restartCommand), ok: true }
              : undefined,
          }
        : undefined,
    };
  }

  const signingSecret = requireSigningSecret(result);
  let envSnapshot: EnvFileSnapshot | undefined;
  try {
    if (options.syncEnvFile) {
      envSnapshot = await writeEnvFileValue(options.syncEnvFile, WEBHOOK_SIGNING_KEY_ENV, signingSecret);
    }
    if (shouldSave) {
      await saveProfile(profile, { webhookSigningKey: signingSecret });
    }
  } catch (error) {
    if (envSnapshot) {
      try {
        await restoreEnvFileSnapshot(envSnapshot);
      } catch (rollbackError) {
        throw new Error(
          `Signing secret persistence failed and env rollback also failed: ${sanitizeErrorMessage(error, signingSecret)}; rollback: ${sanitizeErrorMessage(rollbackError, signingSecret)}`,
        );
      }
    }
    throw new Error(
      `Signing secret persistence failed: ${sanitizeErrorMessage(error, signingSecret)} Remote endpoint state may already have changed; fix the local destination, then rotate and resync the endpoint secret before accepting webhooks.`,
    );
  }

  return {
    saved: shouldSave,
    signingSecret,
    envSync: options.syncEnvFile
      ? {
          envFile: options.syncEnvFile,
          key: WEBHOOK_SIGNING_KEY_ENV,
          written: true,
          restartRequired: !options.restartCommand,
        }
      : undefined,
  };
}

async function finishRestartAfterPersistence(
  options: { restartCommand?: string },
  persistence: SigningSecretPersistence,
  dryRun: boolean,
): Promise<EnvSyncResult | undefined> {
  const envSync = persistence.envSync;
  if (!envSync || dryRun || !options.restartCommand) return envSync;
  if (!persistence.signingSecret) {
    throw new Error("Internal error: restart requested without a resolved webhook signing secret.");
  }
  envSync.restart = await runRestartCommand(options.restartCommand, persistence.signingSecret);
  envSync.restartRequired = false;
  return envSync;
}

function requireSigningSecret(result: unknown): string {
  const signingSecret = extractSigningSecret(result);
  if (signingSecret) return signingSecret;

  const data = getEnvelopeData(result);
  const nextAction = isRecord(data) && typeof data.nextAction === "string"
    ? data.nextAction
    : undefined;
  throw new Error(
    [
      "Clink did not return a plaintext webhook signing secret.",
      nextAction ? `Next action: ${nextAction}.` : "Use rotate-secret, or retry ensure with --rotate-secret.",
    ].join(" "),
  );
}

async function writeEnvFileValue(filePath: string, key: string, value: string): Promise<EnvFileSnapshot> {
  let raw = "";
  let existed = true;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    existed = false;
  }

  await writeTextFileAtomically(filePath, upsertEnvValue(raw, key, value));
  return { filePath, existed, raw };
}

async function restoreEnvFileSnapshot(snapshot: EnvFileSnapshot): Promise<void> {
  if (snapshot.existed) {
    await writeTextFileAtomically(snapshot.filePath, snapshot.raw);
  } else {
    await rm(snapshot.filePath, { force: true });
  }
}

export function upsertEnvValue(raw: string, key: string, value: string): string {
  const line = `${key}=${formatEnvValue(value)}`;
  const pattern = new RegExp(`^(\\s*(?:export\\s+)?${escapeRegExp(key)}\\s*=).*$`, "m");
  if (pattern.test(raw)) {
    return raw.replace(pattern, (_match, prefix: string) => `${prefix}${formatEnvValue(value)}`);
  }
  const prefix = raw.length === 0 || raw.endsWith("\n") ? raw : `${raw}\n`;
  return `${prefix}${line}\n`;
}

function formatEnvValue(value: string): string {
  return /^[A-Za-z0-9_./:=+-]+$/.test(value) ? value : JSON.stringify(value);
}

async function runRestartCommand(command: string, signingSecret: string): Promise<NonNullable<EnvSyncResult["restart"]>> {
  try {
    const { stdout, stderr } = await execAsync(command, { windowsHide: true });
    return {
      command: sanitizeSensitiveText(command, signingSecret),
      ok: true,
      stdout: truncateCommandOutput(sanitizeSensitiveText(stdout, signingSecret)),
      stderr: truncateCommandOutput(sanitizeSensitiveText(stderr, signingSecret)),
    };
  } catch (error) {
    throw new Error(`Restart command failed: ${sanitizeErrorMessage(error, signingSecret)}`);
  }
}

function sanitizeErrorMessage(error: unknown, signingSecret?: string): string {
  return sanitizeSensitiveText(error instanceof Error ? error.message : String(error), signingSecret);
}

function sanitizeSensitiveText(value: string, signingSecret?: string): string {
  let sanitized = value;
  if (signingSecret) {
    sanitized = sanitized.split(signingSecret).join("[masked-webhook-secret]");
  }
  return sanitized
    .replace(/\bwhsec_[A-Za-z0-9_-]{8,}\b/g, "[masked-webhook-secret]")
    .replace(/\bsk_(?:(?:test|live|uat|prod)_)?[A-Za-z0-9_-]{8,}\b/g, "[masked-secret-key]");
}

function truncateCommandOutput(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 1000 ? `${trimmed.slice(0, 1000)}...` : trimmed;
}

function formatEnvSyncLine(envSync: EnvSyncResult | undefined): string | undefined {
  if (!envSync) return undefined;
  if (envSync.dryRun) {
    return `Dry run: would write ${envSync.key} to ${envSync.envFile}.`;
  }
  const restart = envSync.restart
    ? ` Restart command completed: ${envSync.restart.command}`
    : " Restart or redeploy the app before verifying webhooks.";
  return `Synced ${envSync.key} to ${envSync.envFile}.${restart}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function maskWebhookSecrets(value: unknown, showSecret: boolean): unknown {
  if (showSecret) return value;
  if (Array.isArray(value)) return value.map((item) => maskWebhookSecrets(item, false));
  if (!isRecord(value)) return value;
  const result: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (key === "signingSecret" && typeof nestedValue === "string") {
      result[key] = maskSecret(nestedValue);
    } else {
      result[key] = maskWebhookSecrets(nestedValue, false);
    }
  }
  return result;
}

function formatEventCatalog(events: ReadonlyArray<{ readonly name: string; readonly code?: number | string; readonly description?: string }>): string {
  return events
    .map((event) => [event.name, event.code, event.description].filter((value) => value !== undefined).join("\t"))
    .join("\n");
}

function formatPresetCatalog(presets: Record<string, string[] | { unavailable: string }>): string {
  return Object.entries(presets)
    .map(([name, value]) => Array.isArray(value)
      ? `${name}\t${value.length}\t${value.join(", ")}`
      : `${name}\tunavailable\t${value.unavailable}`)
    .join("\n");
}

function formatEventSelection(selection: WebhookEventSelection): string {
  return [
    `Resolved events (${selection.resolvedEvents.length}): ${selection.resolvedEvents.join(", ")}`,
    ...Object.entries(selection.presetExpansions).map(
      ([name, events]) => `Preset ${name} expands to ${events.length}: ${events.join(", ")}`,
    ),
    ...selection.warnings.map((warning) => `Warning: ${warning}`),
  ].join("\n");
}

function formatEventDiff(diff: WebhookEventDiff): string {
  return [
    `Added (${diff.added.length}): ${diff.added.join(", ") || "(none)"}.`,
    `Removed (${diff.removed.length}): ${diff.removed.join(", ") || "(none)"}.`,
    `Unchanged (${diff.unchanged.length}): ${diff.unchanged.join(", ") || "(none)"}.`,
  ].join(" ");
}

function formatEnsureEventBehavior(operation: "create" | "merge" | "replace"): string {
  if (operation === "replace") {
    return "Ensure event behavior: explicit replace (--allow-remove-events authorized removal of events outside the resolved selection).";
  }
  if (operation === "merge") {
    return "Ensure event behavior: safe merge (existing events are preserved and resolved events are added).";
  }
  return "Ensure event behavior: create (the new endpoint receives the resolved event set).";
}

function formatEndpointList(result: WebhookEndpointListResponse): string {
  const rows = extractEndpointRows(result);
  if (rows.length === 0) return "No webhook endpoints found.";
  return rows.map((endpoint) => formatEndpointLine(endpoint)).join("\n");
}

function formatEndpointLine(endpoint: WebhookEndpoint | undefined): string {
  if (!endpoint) return "Webhook endpoint response received.";
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

function formatEnsureSource(source: string | undefined): string {
  if (source === "created") return "Created";
  if (source === "updated") return "Updated";
  if (source === "rotated") return "Rotated";
  if (source === "updated_rotated") return "Updated and rotated";
  return "Found";
}

function formatSigningSecretLine(endpoint: WebhookEndpoint | undefined, showSecret: boolean): string | undefined {
  const secret = endpoint?.signingSecret;
  if (typeof secret === "string" && secret.length > 0) {
    return `Signing secret: ${showSecret ? secret : maskSecret(secret)}`;
  }
  if (endpoint?.maskedSigningSecret) {
    return `Signing secret: ${endpoint.maskedSigningSecret}`;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
