import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { WEBHOOK_COMMERCE_EVENTS } from "../src/webhook/event-catalog.js";
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
  ensureStatus?: number;
  hangEnsure?: boolean;
  signingSecret?: string;
  listOmitsEvents?: boolean;
  detailOmitsEvents?: boolean;
  onEnsure?: () => void;
}

interface RecordedRequest {
  method: string;
  pathname: string;
  body?: Record<string, unknown>;
}

async function startMockApi(options: MockApiOptions = {}) {
  const requests: RecordedRequest[] = [];
  let endpointExists = options.existingEvents !== undefined;
  let currentEvents = [...(options.existingEvents ?? [])];
  let ensurePutCount = 0;
  const catalogEvents = options.catalogEvents ?? [...CURRENT_44_WEBHOOK_EVENTS];

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
      const rows = endpointExists
        ? [{
            id: "whk_test_123",
            url: endpointUrl,
            ...(options.listOmitsEvents ? {} : { events: currentEvents }),
            enabled: true,
          }]
        : [];
      return json(response, 200, { code: 200, data: { total: rows.length, rows } });
    }

    if (request.method === "PUT" && url.pathname === "/api/webhook/endpoints/ensure") {
      ensurePutCount += 1;
      options.onEnsure?.();
      if (options.hangEnsure) return;
      if (options.ensureStatus) {
        return json(response, options.ensureStatus, {
          code: options.ensureStatus,
          msg: `mock ensure failure signingSecret=${options.signingSecret ?? "whsec_mock_error_secret_1234567890"}`,
        });
      }
      currentEvents = Array.isArray(body?.events) ? body.events.filter((event): event is string => typeof event === "string") : [];
      const source = endpointExists ? "updated" : "created";
      endpointExists = true;
      return json(response, 200, {
        code: 200,
        data: {
          source,
          endpoint: {
            id: "whk_test_123",
            url: endpointUrl,
            events: currentEvents,
            enabled: true,
            signingSecret: options.signingSecret,
          },
        },
      });
    }

    if (request.method === "GET" && url.pathname === "/api/webhook/endpoints/whk_test_123") {
      return json(response, 200, {
        code: 200,
        data: {
          id: "whk_test_123",
          url: endpointUrl,
          events: options.detailOmitsEvents ? undefined : options.readBackEvents ?? currentEvents,
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
    endpointCount: () => endpointExists ? 1 : 0,
    currentEvents: () => [...currentEvents],
    ensurePutCount: () => ensurePutCount,
  };
}

async function runClink(
  baseUrl: string,
  args: string[],
  options: { configPath?: string; extraEnv?: Record<string, string> } = {},
) {
  const tempConfig = options.configPath ?? join(tmpdir(), `clink-webhook-endpoints-test-${process.pid}-${Date.now()}-${Math.random()}`, "config.json");
  const ownsConfig = options.configPath === undefined;
  mkdirSync(dirname(tempConfig), { recursive: true });

  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts", "--json", "--base-url", baseUrl, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CLINK_CONFIG_PATH: tempConfig,
      CLINK_SECRET_KEY: "sk_test_runtime_catalog_1234567890",
      CLINK_API_KEY: "",
      ...options.extraEnv,
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
  if (ownsConfig) rmSync(dirname(tempConfig), { recursive: true, force: true });
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
    expect(output.operation).toBe("merge");
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

  it("merges requested events by default and preserves existing extras", async () => {
    const api = await startMockApi({ existingEvents: ["order.succeeded", "invoice.void"] });
    const result = await runClink(api.baseUrl, [
      "webhook", "endpoint", "ensure", "--url", endpointUrl, "--events", "order.succeeded,refund.failed",
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const output = JSON.parse(result.stdout) as {
      operation: string;
      finalEvents: string[];
      eventDiff: { added: string[]; removed: string[]; unchanged: string[] };
    };
    expect(output.operation).toBe("merge");
    expect(output.finalEvents).toEqual(["order.succeeded", "invoice.void", "refund.failed"]);
    expect(output.eventDiff).toEqual({
      added: ["refund.failed"],
      removed: [],
      unchanged: ["order.succeeded", "invoice.void"],
    });
    expect(api.currentEvents()).toEqual(output.finalEvents);
  });

  it("loads endpoint detail before merging when the list summary omits events", async () => {
    const api = await startMockApi({
      existingEvents: ["order.succeeded", "invoice.void"],
      listOmitsEvents: true,
    });
    const result = await runClink(api.baseUrl, [
      "webhook", "endpoint", "ensure", "--url", endpointUrl, "--events", "refund.failed",
    ]);

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout) as { finalEvents: string[] };
    expect(output.finalEvents).toEqual(["order.succeeded", "invoice.void", "refund.failed"]);
    expect(api.requests.map((request) => `${request.method} ${request.pathname}`)).toEqual([
      "GET /api/webhook/events",
      "GET /api/webhook/endpoints",
      "GET /api/webhook/endpoints/whk_test_123",
      "PUT /api/webhook/endpoints/ensure",
      "GET /api/webhook/endpoints/whk_test_123",
    ]);
  });

  it("fails closed without PUT when neither endpoint summary nor detail exposes events", async () => {
    const api = await startMockApi({
      existingEvents: ["order.succeeded", "invoice.void"],
      listOmitsEvents: true,
      detailOmitsEvents: true,
    });
    const result = await runClink(api.baseUrl, [
      "webhook", "endpoint", "ensure", "--url", endpointUrl, "--events", "refund.failed",
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/did not expose its current events/);
    expect(api.ensurePutCount()).toBe(0);
    expect(api.currentEvents()).toEqual(["order.succeeded", "invoice.void"]);
  });

  it("allows explicitly authorized removal and reports added, removed, and unchanged", async () => {
    const api = await startMockApi({ existingEvents: ["order.succeeded", "invoice.void"] });
    const result = await runClink(api.baseUrl, [
      "webhook", "endpoint", "ensure", "--url", endpointUrl, "--events", "order.succeeded,refund.failed", "--allow-remove-events",
    ]);

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout) as {
      operation: string;
      finalEvents: string[];
      eventDiff: { added: string[]; removed: string[]; unchanged: string[] };
    };
    expect(output.operation).toBe("replace");
    expect(output.finalEvents).toEqual(["order.succeeded", "refund.failed"]);
    expect(output.eventDiff).toEqual({
      added: ["refund.failed"],
      removed: ["invoice.void"],
      unchanged: ["order.succeeded"],
    });
    expect(result.stderr).toMatch(/webhook_endpoint_ensure_preview/);
    expect(result.stderr).toMatch(/invoice\.void/);
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

  it("persists a returned signing secret before a failing read-back so rotation recovery is not lost", async () => {
    const tempDir = join(tmpdir(), `clink-webhook-readback-secret-${process.pid}-${Date.now()}`);
    const configPath = join(tempDir, "config.json");
    const signingSecret = "whsec_readback_recovery_secret_1234567890";
    const api = await startMockApi({
      readBackEvents: ["invoice.void"],
      signingSecret,
    });
    try {
      const result = await runClink(api.baseUrl, [
        "webhook", "endpoint", "ensure", "--url", endpointUrl,
        "--events", "order.succeeded", "--save-secret",
      ], { configPath });

      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toContain(signingSecret);
      expect(result.stderr).not.toContain(signingSecret);
      expect(readFileSync(configPath, "utf8")).toContain(signingSecret);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("runs the requested restart before reporting a read-back mismatch after secret rotation", async () => {
    const tempDir = join(tmpdir(), `clink-webhook-readback-restart-${process.pid}-${Date.now()}`);
    const configPath = join(tempDir, "config.json");
    const envFile = join(tempDir, ".env.local");
    const restartMarker = join(tempDir, "restart-complete.txt");
    const signingSecret = "whsec_readback_restart_secret_1234567890";
    const restartCommand = `"${process.execPath}" -e "require('node:fs').writeFileSync(process.argv[1], 'restarted')" "${restartMarker}"`;
    const api = await startMockApi({
      readBackEvents: ["invoice.void"],
      signingSecret,
    });
    try {
      const result = await runClink(api.baseUrl, [
        "webhook", "endpoint", "ensure", "--url", endpointUrl,
        "--events", "order.succeeded",
        "--sync-env-file", envFile,
        "--restart-command", restartCommand,
      ], { configPath });

      expect(result.status).not.toBe(0);
      expect(readFileSync(envFile, "utf8")).toContain(signingSecret);
      expect(readFileSync(restartMarker, "utf8")).toBe("restarted");
      expect(result.stderr).toMatch(/restart completed before read-back/);
      expect(result.stderr).not.toContain(signingSecret);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("refuses an explicit secret rotation when no durable or explicit output destination is selected", async () => {
    const api = await startMockApi();
    const result = await runClink(api.baseUrl, [
      "webhook", "endpoint", "ensure", "--url", endpointUrl,
      "--events", "order.succeeded", "--rotate-secret",
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/rotated secret is not discarded/);
    expect(api.ensurePutCount()).toBe(0);
  });

  it("rejects --restart-command without --sync-env-file before any PUT", async () => {
    const api = await startMockApi();
    const result = await runClink(api.baseUrl, [
      "webhook", "endpoint", "ensure", "--url", endpointUrl,
      "--events", "order.succeeded", "--restart-command", "ignored-command",
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/requires --sync-env-file/);
    expect(api.ensurePutCount()).toBe(0);
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
    expect(output.eventSelection.resolvedEvents).toEqual([...WEBHOOK_COMMERCE_EVENTS]);
    expect(output.result.data.endpoint.events).toEqual([...WEBHOOK_COMMERCE_EVENTS]);
  });

  it("is idempotent across two executions and never creates a duplicate endpoint", async () => {
    const api = await startMockApi();
    const args = [
      "webhook", "endpoint", "ensure", "--url", endpointUrl, "--events", "order.succeeded,refund.failed",
    ];
    const first = await runClink(api.baseUrl, args);
    const second = await runClink(api.baseUrl, args);

    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(api.endpointCount()).toBe(1);
    expect(api.ensurePutCount()).toBe(2);
    const firstOutput = JSON.parse(first.stdout) as { finalEvents: string[] };
    const secondOutput = JSON.parse(second.stdout) as {
      finalEvents: string[];
      eventDiff: { added: string[]; removed: string[]; unchanged: string[] };
    };
    expect(secondOutput.finalEvents).toEqual(firstOutput.finalEvents);
    expect(secondOutput.eventDiff).toEqual({
      added: [],
      removed: [],
      unchanged: ["order.succeeded", "refund.failed"],
    });
  });

  it.each([400, 500])("exits non-zero and redacts reflected secrets for ensure HTTP %s", async (status) => {
    const signingSecret = "whsec_mock_error_secret_1234567890";
    const api = await startMockApi({ ensureStatus: status, signingSecret });
    const result = await runClink(api.baseUrl, [
      "webhook", "endpoint", "ensure", "--url", endpointUrl, "--events", "order.succeeded",
    ]);

    expect(result.status).toBe(69);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(new RegExp(`failed with ${status}`));
    expect(result.stderr).not.toContain(signingSecret);
    expect(result.stderr).toContain("[masked-webhook-secret]");
  });

  it("prints the removal preview before a failing replacement PUT", async () => {
    const api = await startMockApi({
      existingEvents: ["order.succeeded", "invoice.void"],
      ensureStatus: 500,
    });
    const result = await runClink(api.baseUrl, [
      "webhook", "endpoint", "ensure", "--url", endpointUrl,
      "--events", "order.succeeded", "--allow-remove-events",
    ]);

    expect(result.status).toBe(69);
    expect(api.ensurePutCount()).toBe(1);
    expect(result.stderr).toMatch(/webhook_endpoint_ensure_preview/);
    expect(result.stderr).toMatch(/invoice\.void/);
    expect(result.stderr.indexOf("webhook_endpoint_ensure_preview")).toBeLessThan(result.stderr.indexOf('"ok": false'));
  });

  it("aborts an unresponsive ensure request at the configured timeout", async () => {
    const api = await startMockApi({ hangEnsure: true });
    const startedAt = Date.now();
    const result = await runClink(api.baseUrl, [
      "--timeout-ms", "100",
      "webhook", "endpoint", "ensure", "--url", endpointUrl, "--events", "order.succeeded",
    ]);

    expect(result.status).toBe(69);
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(result.stderr).toMatch(/network error|timeout|aborted/i);
  });

  it("exits non-zero on a network connection failure", async () => {
    const result = await runClink("http://127.0.0.1:1/api/", [
      "--timeout-ms", "250",
      "webhook", "endpoint", "ensure", "--url", endpointUrl, "--events", "order.succeeded",
    ]);
    expect(result.status).toBe(69);
    expect(result.stderr).toMatch(/network error/i);
  });

  it("updates an existing env key once and keeps the complete secret out of JSON output", async () => {
    const tempDir = join(tmpdir(), `clink-webhook-env-success-${process.pid}-${Date.now()}`);
    const configPath = join(tempDir, "config.json");
    const envFile = join(tempDir, ".env.local");
    const signingSecret = "whsec_env_success_secret_1234567890";
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(envFile, "CLINK_SECRET_KEY=placeholder\nCLINK_WEBHOOK_SIGNING_KEY=old-value\n", "utf8");
    if (process.platform !== "win32") chmodSync(envFile, 0o644);
    const api = await startMockApi({ signingSecret });
    try {
      const result = await runClink(api.baseUrl, [
        "webhook", "endpoint", "ensure", "--url", endpointUrl, "--events", "order.succeeded",
        "--sync-env-file", envFile,
      ], { configPath });

      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain(signingSecret);
      const raw = readFileSync(envFile, "utf8");
      expect(raw.match(/^CLINK_WEBHOOK_SIGNING_KEY=/gm)).toHaveLength(1);
      expect(raw).toContain(`CLINK_WEBHOOK_SIGNING_KEY=${signingSecret}`);
      expect(raw).toContain("CLINK_SECRET_KEY=placeholder");
      if (process.platform !== "win32") {
        expect(statSync(envFile).mode & 0o777).toBe(0o600);
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")("restores an env snapshot with mode 0600 when profile persistence fails", async () => {
    const tempDir = join(tmpdir(), `clink-webhook-env-rollback-${process.pid}-${Date.now()}`);
    const configPath = join(tempDir, "config.json");
    const envFile = join(tempDir, ".env.local");
    const oldSecret = "whsec_env_rollback_old_1234567890";
    const newSecret = "whsec_env_rollback_new_1234567890";
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(configPath, `${JSON.stringify({ defaultProfile: "default", profiles: {} }, null, 2)}\n`, "utf8");
    writeFileSync(envFile, `CLINK_WEBHOOK_SIGNING_KEY=${oldSecret}\n`, "utf8");
    chmodSync(configPath, 0o644);
    chmodSync(envFile, 0o644);
    const api = await startMockApi({
      signingSecret: newSecret,
      onEnsure: () => {
        rmSync(configPath, { force: true });
        mkdirSync(configPath);
      },
    });

    try {
      const result = await runClink(api.baseUrl, [
        "webhook", "endpoint", "ensure", "--url", endpointUrl, "--events", "order.succeeded",
        "--save-secret", "--sync-env-file", envFile,
      ], { configPath });

      expect(result.status).not.toBe(0);
      expect(api.ensurePutCount()).toBe(1);
      expect(result.stdout).not.toContain(newSecret);
      expect(result.stderr).not.toContain(newSecret);
      expect(readFileSync(envFile, "utf8")).toBe(`CLINK_WEBHOOK_SIGNING_KEY=${oldSecret}\n`);
      expect(statSync(envFile).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects an invalid env destination before PUT and leaves the profile untouched", async () => {
    const tempDir = join(tmpdir(), `clink-webhook-env-failure-${process.pid}-${Date.now()}`);
    const configPath = join(tempDir, "config.json");
    const invalidEnvTarget = join(tempDir, "env-is-a-directory");
    const signingSecret = "whsec_env_failure_secret_1234567890";
    mkdirSync(invalidEnvTarget, { recursive: true });
    const api = await startMockApi({ signingSecret });
    try {
      const result = await runClink(api.baseUrl, [
        "webhook", "endpoint", "ensure", "--url", endpointUrl, "--events", "order.succeeded",
        "--save-secret", "--sync-env-file", invalidEnvTarget,
      ], { configPath });

      expect(result.status).not.toBe(0);
      expect(api.ensurePutCount()).toBe(0);
      expect(result.stderr).not.toContain(signingSecret);
      expect(existsSync(configPath)).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps the profile unchanged and emits recovery guidance if a local target fails after API success", async () => {
    const tempDir = join(tmpdir(), `clink-webhook-post-api-local-failure-${process.pid}-${Date.now()}`);
    const configPath = join(tempDir, "config.json");
    const envFile = join(tempDir, ".env.local");
    const oldSecret = "whsec_old_profile_secret_1234567890";
    const newSecret = "whsec_post_api_secret_1234567890";
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(configPath, JSON.stringify({
      defaultProfile: "default",
      profiles: { default: { webhookSigningKey: oldSecret } },
    }), "utf8");
    writeFileSync(envFile, `CLINK_WEBHOOK_SIGNING_KEY=${oldSecret}\n`, "utf8");
    const api = await startMockApi({
      signingSecret: newSecret,
      onEnsure: () => {
        rmSync(envFile, { force: true });
        mkdirSync(envFile);
      },
    });
    try {
      const result = await runClink(api.baseUrl, [
        "webhook", "endpoint", "ensure", "--url", endpointUrl, "--events", "order.succeeded",
        "--save-secret", "--sync-env-file", envFile,
      ], { configPath });

      expect(result.status).not.toBe(0);
      expect(api.ensurePutCount()).toBe(1);
      const config = readFileSync(configPath, "utf8");
      expect(config).toContain(oldSecret);
      expect(config).not.toContain(newSecret);
      expect(statSync(envFile).isDirectory()).toBe(true);
      expect(result.stderr).not.toContain(newSecret);
      expect(result.stderr).toMatch(/rotate and resync the endpoint secret/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("redacts signing secrets echoed by --restart-command", async () => {
    const tempDir = join(tmpdir(), `clink-webhook-restart-redaction-${process.pid}-${Date.now()}`);
    const configPath = join(tempDir, "config.json");
    const envFile = join(tempDir, ".env.local");
    const signingSecret = "whsec_restart_secret_1234567890";
    mkdirSync(tempDir, { recursive: true });
    const restartCommand = `"${process.execPath}" -e "process.stdout.write(require('node:fs').readFileSync(process.argv[1], 'utf8'))" "${envFile}"`;
    const api = await startMockApi({ signingSecret });
    try {
      const result = await runClink(api.baseUrl, [
        "webhook", "endpoint", "ensure", "--url", endpointUrl, "--events", "order.succeeded",
        "--sync-env-file", envFile, "--restart-command", restartCommand,
      ], { configPath });

      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain(signingSecret);
      expect(result.stderr).not.toContain(signingSecret);
      const output = JSON.parse(result.stdout) as { envSync: { restart: { stdout: string } } };
      expect(output.envSync.restart.stdout).toContain("[masked-webhook-secret]");
      if (process.platform !== "win32") {
        expect(statSync(envFile).mode & 0o777).toBe(0o600);
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("shows full preset expansions and the core risk in ensure help without calling the API", async () => {
    const api = await startMockApi();
    const result = await runClink(api.baseUrl, ["webhook", "endpoint", "ensure", "--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/core \(6; compatibility only\)/);
    expect(result.stdout).toMatch(/subscriptions \(14\)/);
    expect(result.stdout).toMatch(/commerce \(31\)/);
    expect(result.stdout).toMatch(/refund\.failed/);
    expect(result.stdout).toMatch(/session\.expired/);
    expect(result.stdout).toMatch(/all \(dynamic\)/);
    expect(api.requests).toHaveLength(0);
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
    expect(output.operation).toBe("create");
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
