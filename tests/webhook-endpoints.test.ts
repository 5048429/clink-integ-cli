import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { CURRENT_44_WEBHOOK_EVENTS } from "./fixtures/webhook-runtime.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const endpointUrl = "https://merchant.example/api/clink/webhook";
const activeServers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(activeServers.splice(0).map((server) => server.close()));
});

interface MockApiOptions {
  catalogEvents?: string[];
  existingEvents?: string[];
  readBackEvents?: string[];
}

interface RecordedRequest {
  method: string;
  pathname: string;
  body?: Record<string, unknown>;
}

async function startMockApi(options: MockApiOptions = {}) {
  const requests: RecordedRequest[] = [];
  let writtenEvents: string[] = [];
  const catalogEvents = options.catalogEvents ?? [...CURRENT_44_WEBHOOK_EVENTS];
  const existingEvents = options.existingEvents ?? [];

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const body = await readJsonBody(request);
    requests.push({ method: request.method ?? "GET", pathname: url.pathname, body });

    if (request.method === "GET" && url.pathname === "/api/webhook/events") {
      return json(response, 200, {
        code: 200,
        data: {
          events: catalogEvents.map((name, index) => ({ name, code: index + 1 })),
          aliases: { server_checkout: ["session.complete", "order.succeeded"] },
        },
      });
    }

    if (request.method === "GET" && url.pathname === "/api/webhook/endpoints") {
      const rows = existingEvents.length > 0
        ? [{ id: "whk_test_123", url: endpointUrl, events: existingEvents, enabled: true }]
        : [];
      return json(response, 200, { code: 200, data: { total: rows.length, rows } });
    }

    if (request.method === "PUT" && url.pathname === "/api/webhook/endpoints/ensure") {
      writtenEvents = Array.isArray(body?.events) ? body.events.filter((event): event is string => typeof event === "string") : [];
      return json(response, 200, {
        code: 200,
        data: {
          source: existingEvents.length > 0 ? "updated" : "created",
          endpoint: { id: "whk_test_123", url: endpointUrl, events: writtenEvents, enabled: true },
        },
      });
    }

    if (request.method === "GET" && url.pathname === "/api/webhook/endpoints/whk_test_123") {
      return json(response, 200, {
        code: 200,
        data: {
          id: "whk_test_123",
          url: endpointUrl,
          events: options.readBackEvents ?? writtenEvents,
          enabled: true,
        },
      });
    }

    return json(response, 404, { code: 404, msg: "not found" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("mock API did not bind a TCP port");
  const close = () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  activeServers.push({ close });

  return {
    baseUrl: `http://127.0.0.1:${address.port}/api/`,
    requests,
  };
}

async function runClink(baseUrl: string, args: string[]) {
  const tempConfig = join(tmpdir(), `clink-webhook-endpoints-test-${process.pid}-${Date.now()}-${Math.random()}`, "config.json");
  mkdirSync(dirname(tempConfig), { recursive: true });

  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts", "--json", "--base-url", baseUrl, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CLINK_CONFIG_PATH: tempConfig,
      CLINK_SECRET_KEY: "sk_test_runtime_catalog_1234567890",
      CLINK_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const status = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  rmSync(dirname(tempConfig), { recursive: true, force: true });
  return { status, stdout, stderr };
}

describe("webhook endpoint runtime presets and safe ensure", () => {
  it("calls the runtime catalog first, prints core expansion, and verifies the final event set", async () => {
    const api = await startMockApi({ existingEvents: [...CURRENT_44_WEBHOOK_EVENTS].filter((event) => [
      "session.complete",
      "order.succeeded",
      "order.failed",
      "refund.succeeded",
      "subscription.created",
      "invoice.paid",
    ].includes(event)) });
    const result = await runClink(api.baseUrl, [
      "webhook", "endpoint", "ensure", "--url", endpointUrl, "--events", "core",
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const output = JSON.parse(result.stdout) as {
      operation: string;
      eventSelection: { resolvedEvents: string[]; warnings: string[] };
      eventDiff: { added: string[]; removed: string[]; unchanged: string[] };
      verification: { performed: boolean; status: string };
    };
    expect(output.operation).toBe("replace");
    expect(output.eventSelection.resolvedEvents).toHaveLength(6);
    expect(output.eventSelection.warnings.join(" ")).toMatch(/does not cover the complete subscription lifecycle/i);
    expect(output.eventDiff).toMatchObject({ added: [], removed: [], unchanged: expect.any(Array) });
    expect(output.verification).toEqual({ performed: true, status: "verified" });
    expect(api.requests.map((request) => `${request.method} ${request.pathname}`)).toEqual([
      "GET /api/webhook/events",
      "GET /api/webhook/endpoints",
      "PUT /api/webhook/endpoints/ensure",
      "GET /api/webhook/endpoints/whk_test_123",
    ]);
  });

  it("refuses non-interactive event removal unless --allow-remove-events is explicit", async () => {
    const api = await startMockApi({ existingEvents: ["order.succeeded", "invoice.void"] });
    const result = await runClink(api.baseUrl, [
      "webhook", "endpoint", "ensure", "--url", endpointUrl, "--events", "order.succeeded",
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/replace semantics/);
    expect(result.stderr).toMatch(/invoice\.void/);
    expect(result.stderr).toMatch(/--allow-remove-events/);
    expect(api.requests.map((request) => request.method)).toEqual(["GET", "GET"]);
  });

  it("allows explicitly authorized removal and reports added, removed, and unchanged", async () => {
    const api = await startMockApi({ existingEvents: ["order.succeeded", "invoice.void"] });
    const result = await runClink(api.baseUrl, [
      "webhook", "endpoint", "ensure", "--url", endpointUrl, "--events", "order.succeeded,refund.failed", "--allow-remove-events",
    ]);

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout) as {
      eventDiff: { added: string[]; removed: string[]; unchanged: string[] };
    };
    expect(output.eventDiff).toEqual({
      added: ["refund.failed"],
      removed: ["invoice.void"],
      unchanged: ["order.succeeded"],
    });
  });

  it("fails when a preset event is absent from the runtime catalog", async () => {
    const api = await startMockApi({
      catalogEvents: CURRENT_44_WEBHOOK_EVENTS.filter((event) => event !== "invoice.void"),
    });
    const result = await runClink(api.baseUrl, [
      "webhook", "endpoint", "ensure", "--url", endpointUrl, "--events", "subscriptions",
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/invoice\.void/);
    expect(api.requests.map((request) => `${request.method} ${request.pathname}`)).toEqual([
      "GET /api/webhook/events",
    ]);
  });

  it("fails when the endpoint read-back event set does not exactly match", async () => {
    const api = await startMockApi({ readBackEvents: ["order.succeeded"] });
    const result = await runClink(api.baseUrl, [
      "webhook", "endpoint", "ensure", "--url", endpointUrl, "--events", "order.succeeded,refund.failed",
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/read-back mismatch/);
    expect(result.stderr).toMatch(/refund\.failed/);
  });

  it("resolves the combined commerce preset to the current 31 runtime-supported events", async () => {
    const api = await startMockApi();
    const result = await runClink(api.baseUrl, [
      "webhook", "endpoint", "ensure", "--url", endpointUrl, "--events", "commerce",
    ]);

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout) as {
      eventSelection: { resolvedEvents: string[] };
      result: { data: { endpoint: { events: string[] } } };
    };
    expect(output.eventSelection.resolvedEvents).toHaveLength(31);
    expect(output.result.data.endpoint.events).toHaveLength(31);
  });

  it("keeps dashboard webhook ensure as a compatibility alias for the same safe runtime flow", async () => {
    const api = await startMockApi();
    const result = await runClink(api.baseUrl, [
      "dashboard", "webhook", "ensure", "--merchant-id", "merchant_legacy_script", "--url", endpointUrl, "--events", "checkout",
    ]);

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout) as {
      ignoredMerchantId: string;
      operation: string;
      eventSelection: { resolvedEvents: string[] };
    };
    expect(output.ignoredMerchantId).toBe("merchant_legacy_script");
    expect(output.operation).toBe("replace");
    expect(output.eventSelection.resolvedEvents).toHaveLength(9);
    expect(api.requests[0]).toMatchObject({ method: "GET", pathname: "/api/webhook/events" });
  });
});

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}
