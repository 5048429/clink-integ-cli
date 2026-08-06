import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { maskSecret } from "../output.js";
import type { RuntimeConfig } from "../types.js";
import {
  assertValidatedClinkApiUrlMatchesBase,
  isValidatedClinkApiUrl,
  resolveClinkApiUrl,
  type ValidatedClinkApiUrl,
} from "./url.js";

type QueryValue = string | number | boolean | undefined;

export interface RequestOptions<TBody = unknown, TQuery extends object = Record<string, QueryValue>> {
  query?: TQuery;
  body?: TBody;
  multipart?: FormData;
  /** Execute a read-only GET even when the command uses --dry-run. */
  executeInDryRun?: boolean;
}

export class ClinkApiClient {
  constructor(private readonly config: RuntimeConfig) {}

  async delete<T = unknown, TQuery extends object = Record<string, QueryValue>>(
    path: string | ValidatedClinkApiUrl,
    options: RequestOptions<never, TQuery> = {},
  ): Promise<T> {
    return this.request<T, never, TQuery>("DELETE", path, options);
  }

  async get<T = unknown, TQuery extends object = Record<string, QueryValue>>(
    path: string | ValidatedClinkApiUrl,
    options: RequestOptions<never, TQuery> = {},
  ): Promise<T> {
    return this.request<T, never, TQuery>("GET", path, options);
  }

  async post<T = unknown, TBody = unknown, TQuery extends object = Record<string, QueryValue>>(
    path: string | ValidatedClinkApiUrl,
    options: RequestOptions<TBody, TQuery> = {},
  ): Promise<T> {
    return this.request<T, TBody, TQuery>("POST", path, options);
  }

  async patch<T = unknown, TBody = unknown, TQuery extends object = Record<string, QueryValue>>(
    path: string | ValidatedClinkApiUrl,
    options: RequestOptions<TBody, TQuery> = {},
  ): Promise<T> {
    return this.request<T, TBody, TQuery>("PATCH", path, options);
  }

  async put<T = unknown, TBody = unknown, TQuery extends object = Record<string, QueryValue>>(
    path: string | ValidatedClinkApiUrl,
    options: RequestOptions<TBody, TQuery> = {},
  ): Promise<T> {
    return this.request<T, TBody, TQuery>("PUT", path, options);
  }

  async request<T = unknown, TBody = unknown, TQuery extends object = Record<string, QueryValue>>(
    method: string,
    path: string | ValidatedClinkApiUrl,
    options: RequestOptions<TBody, TQuery> = {},
  ): Promise<T> {
    if (options.executeInDryRun && method !== "GET") {
      throw new Error("executeInDryRun is restricted to read-only GET requests.");
    }
    if (!this.config.apiKey && (!this.config.dryRun || options.executeInDryRun)) {
      throw new Error("Missing Clink Secret Key. Set CLINK_SECRET_KEY or run clink auth secret set --api-key env:CLINK_SECRET_KEY");
    }

    if (isValidatedClinkApiUrl(path) && options.query !== undefined) {
      throw new Error("Query parameters are already included in the validated Clink API URL.");
    }
    if (isValidatedClinkApiUrl(path)) {
      assertValidatedClinkApiUrlMatchesBase(path, this.config.baseUrl);
    }
    const url = isValidatedClinkApiUrl(path)
      ? path
      : resolveClinkApiUrl(this.config.baseUrl, path, options.query);

    const headers = new Headers({
      "X-API-KEY": this.config.apiKey ?? "dry_run_missing_key",
      "X-Timestamp": String(Date.now()),
    });

    let body: BodyInit | undefined;
    if (options.multipart) {
      body = options.multipart;
    } else if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(options.body);
    }

    if (this.config.dryRun && !options.executeInDryRun) {
      return {
        dryRun: true,
        request: {
          method,
          url: url.href,
          headers: {
            "X-API-KEY": "[masked]",
            "X-Timestamp": "[generated]",
            ...(headers.has("Content-Type") ? { "Content-Type": headers.get("Content-Type") } : {}),
          },
          body: options.body ?? (options.multipart ? "[multipart]" : undefined),
        },
      } as T;
    }

    let response: Response;
    try {
      response = await fetch(url.href, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(this.config.apiTimeoutMs),
      });
    } catch (error) {
      throw new Error(`Clink API ${method} ${url.pathname} network error: ${formatFetchError(error)}`);
    }
    const text = await response.text();
    const data = parseResponseBody(text);

    if (!response.ok) {
      throw new Error(`Clink API ${method} ${url.pathname} failed with ${response.status}: ${sanitizeApiText(text, this.config)}`);
    }

    assertSuccessfulApiEnvelope(method, url.pathname, data, this.config);

    return data as T;
  }
}

export async function createImageUploadForm(filePath: string): Promise<FormData> {
  const buffer = await readFile(filePath);
  const form = new FormData();
  const blob = new Blob([buffer]);
  form.append("file", blob, basename(filePath));
  return form;
}

function parseResponseBody(text: string): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function assertSuccessfulApiEnvelope(method: string, path: string, data: unknown, config: RuntimeConfig): void {
  if (!data || typeof data !== "object") return;
  const envelope = data as { code?: unknown; msg?: unknown };
  if (typeof envelope.code !== "number" || envelope.code === 200) return;
  const message = typeof envelope.msg === "string" ? envelope.msg : JSON.stringify(data);
  throw new Error(`Clink API ${method} ${path} returned code ${envelope.code}: ${sanitizeApiText(message, config)}`);
}

function formatFetchError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
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

function sanitizeApiText(value: string, config: RuntimeConfig): string {
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
