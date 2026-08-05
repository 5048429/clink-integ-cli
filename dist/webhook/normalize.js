export const LEGACY_WEBHOOK_WARNING_CODE = "clink.webhook.legacy_payload";
export function normalizeWebhookEvent(payload, options = {}) {
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
        const legacyIdentity = { id, type };
        if (options.onLegacy) {
            options.onLegacy(legacyIdentity);
        }
        else {
            reportLegacyPayload(legacyIdentity);
        }
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
    throw new Error(`Unrecognized Clink webhook payload ${id}/${type}: data.object must be a resource object or a legacy resource type string.`);
}
function reportLegacyPayload(event) {
    console.warn(JSON.stringify({
        code: LEGACY_WEBHOOK_WARNING_CODE,
        eventId: event.id,
        eventType: event.type,
    }));
}
function normalizeCreated(value, id, type) {
    if (typeof value === "number" && Number.isInteger(value))
        return value;
    if (typeof value === "string") {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed))
            return parsed;
    }
    throw new Error(`Unrecognized Clink webhook payload ${id}/${type}: event.created must be Unix milliseconds or an ISO timestamp.`);
}
function requireString(value, field) {
    if (typeof value === "string" && value.length > 0)
        return value;
    throw new Error(`Unrecognized Clink webhook payload: ${field} must be a non-empty string.`);
}
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
//# sourceMappingURL=normalize.js.map