export interface WebhookRuntimeEvent {
  name: string;
  code?: number | string;
  description?: string;
}

export interface WebhookRuntimeCatalog {
  events: WebhookRuntimeEvent[];
  aliases: Record<string, string[]>;
}

export interface WebhookEventSelection {
  input: string;
  tokens: string[];
  presets: string[];
  presetExpansions: Record<string, string[]>;
  resolvedEvents: string[];
  warnings: string[];
  runtimeCatalogEventCount: number;
}

export interface ResolveWebhookEventOptions {
  allowUnknownEvents?: boolean;
}

export const WEBHOOK_CORE_EVENTS = [
  "session.complete",
  "order.succeeded",
  "order.failed",
  "refund.succeeded",
  "subscription.created",
  "invoice.paid",
] as const;

export const WEBHOOK_CHECKOUT_EVENTS = [
  "session.complete",
  "session.expired",
  "order.created",
  "order.succeeded",
  "order.failed",
  "order.next_action",
  "refund.created",
  "refund.succeeded",
  "refund.failed",
] as const;

export const WEBHOOK_SUBSCRIPTION_EVENTS = [
  "subscription.created",
  "subscription.trialing",
  "subscription.activated",
  "subscription.incomplete_expired",
  "subscription.past_due",
  "subscription.cancelled",
  "subscription.updated.plan_changed",
  "subscription.updated.plan_change_canceled",
  "subscription.updated.renewed",
  "subscription.updated.cancel_at_period_end_set",
  "subscription.updated.cancel_at_period_end_revoked",
  "invoice.open",
  "invoice.paid",
  "invoice.void",
] as const;

export const WEBHOOK_DISPUTE_EVENTS = [
  "dispute.created",
  "dispute.updated",
  "dispute.won",
  "dispute.lost",
  "dispute.closed",
] as const;

export const WEBHOOK_PAYMENT_METHOD_EVENTS = [
  "payment_method.added",
  "payment_method.default_change",
  "payment_method.update",
] as const;

export const WEBHOOK_COMMERCE_EVENTS = [
  ...WEBHOOK_CHECKOUT_EVENTS,
  ...WEBHOOK_SUBSCRIPTION_EVENTS,
  ...WEBHOOK_DISPUTE_EVENTS,
  ...WEBHOOK_PAYMENT_METHOD_EVENTS,
] as const;

const REQUIRED_PRESET_EVENTS: Record<string, readonly string[]> = {
  core: WEBHOOK_CORE_EVENTS,
  checkout: WEBHOOK_CHECKOUT_EVENTS,
  subscriptions: WEBHOOK_SUBSCRIPTION_EVENTS,
  disputes: WEBHOOK_DISPUTE_EVENTS,
  "payment-methods": WEBHOOK_PAYMENT_METHOD_EVENTS,
  commerce: WEBHOOK_COMMERCE_EVENTS,
};

export const WEBHOOK_PRESET_NAMES = ["core", "checkout", "subscriptions", "disputes", "payment-methods", "commerce", "all"] as const;

const CORE_WARNING = [
  `core expands to exactly ${WEBHOOK_CORE_EVENTS.length} compatibility events: ${WEBHOOK_CORE_EVENTS.join(", ")}.`,
  "It does not cover the complete subscription lifecycle, dunning/past_due, cancellation, disputes/chargebacks, refund.failed, or session.expired.",
].join(" ");

export function parseWebhookRuntimeCatalog(result: unknown): WebhookRuntimeCatalog {
  const data = getEnvelopeData(result);
  const source = isRecord(data) ? data : isRecord(result) ? result : undefined;
  const rawEvents = source?.events;
  if (!Array.isArray(rawEvents)) {
    throw new Error("GET /webhook/events did not return data.events; refusing to resolve webhook presets from a stale local catalog.");
  }

  const events = rawEvents
    .map(parseRuntimeEvent)
    .filter((event): event is WebhookRuntimeEvent => Boolean(event));
  if (events.length === 0) {
    throw new Error("GET /webhook/events returned an empty event catalog; refusing to update webhook endpoint events.");
  }

  return {
    events: dedupeEvents(events),
    aliases: parseRuntimeAliases(source?.aliases),
  };
}

export function resolveWebhookEventSelection(
  value: string | undefined,
  catalog: WebhookRuntimeCatalog,
  options: ResolveWebhookEventOptions = {},
): WebhookEventSelection {
  if (!value) throw new Error("Missing required option: --events");
  const tokens = value
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) {
    throw new Error(`Option --events must include event names or presets: ${WEBHOOK_PRESET_NAMES.join(", ")}.`);
  }

  const numericEvents = tokens.filter((event) => /^\d+$/.test(event));
  if (numericEvents.length > 0) {
    throw new Error(`Webhook endpoint Secret Key API accepts event names, not numeric event codes: ${numericEvents.join(", ")}`);
  }

  const runtimeEvents = new Set(catalog.events.map((event) => event.name));
  const resolvedEvents: string[] = [];
  const presets: string[] = [];
  const presetExpansions: Record<string, string[]> = {};
  const missingByToken = new Map<string, string[]>();

  for (const token of tokens) {
    let expansion: string[];
    if (token === "all") {
      expansion = catalog.events.map((event) => event.name);
      presets.push(token);
    } else if (REQUIRED_PRESET_EVENTS[token]) {
      const required = [...REQUIRED_PRESET_EVENTS[token]];
      expansion = required;
      presets.push(token);
      const missing = required.filter((event) => !runtimeEvents.has(event));
      if (missing.length > 0) missingByToken.set(token, missing);
    } else if (catalog.aliases[token]) {
      expansion = catalog.aliases[token];
      presets.push(token);
      const missing = expansion.filter((event) => !runtimeEvents.has(event));
      if (missing.length > 0) missingByToken.set(token, missing);
    } else {
      expansion = [token];
      if (!runtimeEvents.has(token)) missingByToken.set(token, [token]);
    }

    if (presets.includes(token)) presetExpansions[token] = dedupe(expansion);
    resolvedEvents.push(...expansion);
  }

  if (missingByToken.size > 0) {
    const details = [...missingByToken.entries()]
      .map(([token, missing]) => `${token}: ${missing.join(", ")}`)
      .join("; ");
    throw new Error(
      `Webhook event selection is not supported by the runtime GET /webhook/events catalog. Missing events: ${details}. No events were written.`,
    );
  }

  const warnings: string[] = [];
  if (tokens.includes("core")) warnings.push(CORE_WARNING);
  if (options.allowUnknownEvents) {
    warnings.push("--allow-unknown-events is deprecated and no longer bypasses runtime GET /webhook/events validation.");
  }

  return {
    input: value,
    tokens,
    presets: dedupe(presets),
    presetExpansions,
    resolvedEvents: dedupe(resolvedEvents),
    warnings,
    runtimeCatalogEventCount: catalog.events.length,
  };
}

export function describeWebhookPresets(catalog: WebhookRuntimeCatalog): Record<string, string[]> {
  return Object.fromEntries(
    WEBHOOK_PRESET_NAMES.map((name) => [name, resolveWebhookEventSelection(name, catalog).resolvedEvents]),
  );
}

function parseRuntimeEvent(value: unknown): WebhookRuntimeEvent | undefined {
  if (typeof value === "string" && value.length > 0) return { name: value };
  if (!isRecord(value) || typeof value.name !== "string" || value.name.length === 0) return undefined;
  return {
    name: value.name,
    code: typeof value.code === "number" || typeof value.code === "string" ? value.code : undefined,
    description: typeof value.description === "string" ? value.description : undefined,
  };
}

function parseRuntimeAliases(value: unknown): Record<string, string[]> {
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([name, events]) => [name.toLowerCase(), normalizeAliasEvents(events)] as const)
        .filter((entry) => entry[1].length > 0),
    );
  }

  if (Array.isArray(value)) {
    const aliases: Record<string, string[]> = {};
    for (const item of value) {
      if (!isRecord(item) || typeof item.name !== "string") continue;
      const events = normalizeAliasEvents(item.events);
      if (events.length > 0) aliases[item.name.toLowerCase()] = events;
    }
    return aliases;
  }

  return {};
}

function normalizeAliasEvents(value: unknown): string[] {
  const events = Array.isArray(value)
    ? value.filter((event): event is string => typeof event === "string")
    : typeof value === "string"
      ? value.split(",")
      : [];
  return dedupe(events.map((event) => event.trim()).filter(Boolean));
}

function dedupeEvents(events: WebhookRuntimeEvent[]): WebhookRuntimeEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    if (seen.has(event.name)) return false;
    seen.add(event.name);
    return true;
  });
}

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function getEnvelopeData(result: unknown): unknown {
  return isRecord(result) && "data" in result ? result.data : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
