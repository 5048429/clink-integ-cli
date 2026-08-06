import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { maskSecret } from "../output.js";
export class ClinkApiClient {
    config;
    constructor(config) {
        this.config = config;
    }
    async delete(path, options = {}) {
        return this.request("DELETE", path, options);
    }
    async get(path, options = {}) {
        return this.request("GET", path, options);
    }
    async post(path, options = {}) {
        return this.request("POST", path, options);
    }
    async patch(path, options = {}) {
        return this.request("PATCH", path, options);
    }
    async put(path, options = {}) {
        return this.request("PUT", path, options);
    }
    async request(method, path, options = {}) {
        if (options.executeInDryRun && method !== "GET") {
            throw new Error("executeInDryRun is restricted to read-only GET requests.");
        }
        if (!this.config.apiKey && (!this.config.dryRun || options.executeInDryRun)) {
            throw new Error("Missing Clink Secret Key. Set CLINK_SECRET_KEY or run clink auth secret set --api-key env:CLINK_SECRET_KEY");
        }
        const url = new URL(path.replace(/^\//, ""), this.config.baseUrl);
        for (const [key, value] of Object.entries(options.query ?? {})) {
            if (value !== undefined) {
                url.searchParams.set(key, String(value));
            }
        }
        const headers = new Headers({
            "X-API-KEY": this.config.apiKey ?? "dry_run_missing_key",
            "X-Timestamp": String(Date.now()),
        });
        let body;
        if (options.multipart) {
            body = options.multipart;
        }
        else if (options.body !== undefined) {
            headers.set("Content-Type", "application/json");
            body = JSON.stringify(options.body);
        }
        if (this.config.dryRun && !options.executeInDryRun) {
            return {
                dryRun: true,
                request: {
                    method,
                    url: url.toString(),
                    headers: {
                        "X-API-KEY": "[masked]",
                        "X-Timestamp": "[generated]",
                        ...(headers.has("Content-Type") ? { "Content-Type": headers.get("Content-Type") } : {}),
                    },
                    body: options.body ?? (options.multipart ? "[multipart]" : undefined),
                },
            };
        }
        let response;
        try {
            response = await fetch(url, {
                method,
                headers,
                body,
                signal: AbortSignal.timeout(this.config.apiTimeoutMs),
            });
        }
        catch (error) {
            throw new Error(`Clink API ${method} ${url.pathname} network error: ${formatFetchError(error)}`);
        }
        const text = await response.text();
        const data = parseResponseBody(text);
        if (!response.ok) {
            throw new Error(`Clink API ${method} ${url.pathname} failed with ${response.status}: ${sanitizeApiText(text, this.config)}`);
        }
        assertSuccessfulApiEnvelope(method, url.pathname, data, this.config);
        return data;
    }
}
export async function createImageUploadForm(filePath) {
    const buffer = await readFile(filePath);
    const form = new FormData();
    const blob = new Blob([buffer]);
    form.append("file", blob, basename(filePath));
    return form;
}
function parseResponseBody(text) {
    if (!text)
        return {};
    try {
        return JSON.parse(text);
    }
    catch {
        return text;
    }
}
function assertSuccessfulApiEnvelope(method, path, data, config) {
    if (!data || typeof data !== "object")
        return;
    const envelope = data;
    if (typeof envelope.code !== "number" || envelope.code === 200)
        return;
    const message = typeof envelope.msg === "string" ? envelope.msg : JSON.stringify(data);
    throw new Error(`Clink API ${method} ${path} returned code ${envelope.code}: ${sanitizeApiText(message, config)}`);
}
function formatFetchError(error) {
    if (!(error instanceof Error))
        return String(error);
    const cause = error.cause;
    if (cause && typeof cause === "object") {
        const code = "code" in cause && typeof cause.code === "string" ? cause.code : undefined;
        const host = "host" in cause && typeof cause.host === "string" ? cause.host : undefined;
        const port = "port" in cause && (typeof cause.port === "number" || typeof cause.port === "string") ? String(cause.port) : undefined;
        const details = [code, host ? `host=${host}` : undefined, port ? `port=${port}` : undefined].filter(Boolean).join(" ");
        return details ? `${error.message} (${details})` : error.message;
    }
    return error.message;
}
function sanitizeApiText(value, config) {
    let sanitized = value;
    for (const secret of [config.apiKey, config.webhookSigningKey]) {
        if (secret) {
            sanitized = sanitized.split(secret).join(maskSecret(secret) ?? "[masked]");
        }
    }
    return sanitized
        .replace(/\bsk_(?:(?:test|live|uat|prod)_)?[A-Za-z0-9_-]{8,}\b/g, "[masked-secret-key]")
        .replace(/\bwhsec_[A-Za-z0-9_-]{8,}\b/g, "[masked-webhook-secret]")
        .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[masked-jwt]");
}
//# sourceMappingURL=client.js.map