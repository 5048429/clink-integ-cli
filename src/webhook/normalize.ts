export interface CanonicalWebhookEvent {
  id: string;
  object: "event";
  created: number;
  type: string;
  data: {
    object: Record<string, unknown>;
  };
}

export interface NormalizeWebhookOptions {
  onLegacy?: (event: { id: string; type: string }) => void;
}

export function normalizeWebhookEvent(payload: unknown, options: NormalizeWebhookOptions = {}): CanonicalWebhookEvent {
  if (!isRecord(payload)) {
    throw new Error("Unrecognized Clink webhook payload: expected a JSON object.");
  }

  const id = requireString(payload.id, "event.id");
  const type = requireString(payload.type, "event.type");
  if (payload.object !== "event") {
    throw new Error(`Unrecognized Clink webhook payload ${id}/${type}: event.object must be "event".`);
  }
  if (!isRecord(payload.data)) {
    throw new Error(`Unrecognized Clink webhook payload ${id}/${type}: event.data must be an object.`);
  }

  if (isRecord(payload.data.object)) {
    return {
      id,
      object: "event",
      created: normalizeCreated(payload.created, id, type),
      type,
      data: {
        object: payload.data.object,
      },
    };
  }

  if (typeof payload.data.object === "string") {
    const resource = Object.fromEntries(Object.entries(payload.data).filter(([key]) => key !== "object"));
    if (Array.isArray(resource.lineItems) && resource.items === undefined) {
      resource.items = resource.lineItems;
      delete resource.lineItems;
    }
    options.onLegacy?.({ id, type });
    return {
      id,
      object: "event",
      created: normalizeCreated(payload.created, id, type),
      type,
      data: {
        object: resource,
      },
    };
  }

  throw new Error(
    `Unrecognized Clink webhook payload ${id}/${type}: data.object must be a resource object or a legacy resource type string.`,
  );
}

function normalizeCreated(value: unknown, id: string, type: string): number {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error(`Unrecognized Clink webhook payload ${id}/${type}: event.created must be Unix milliseconds or an ISO timestamp.`);
}

function requireString(value: unknown, field: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error(`Unrecognized Clink webhook payload: ${field} must be a non-empty string.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
