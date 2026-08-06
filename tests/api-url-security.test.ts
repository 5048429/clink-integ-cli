import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClinkApiClient } from "../src/api/client.js";
import { resolveClinkApiUrl } from "../src/api/url.js";
import { buildUrl } from "../src/commands/helpers.js";
import type { RuntimeConfig } from "../src/types.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const rejectedPaths = [
  "https://attacker.example/steal",
  "http://attacker.example/steal",
  "https://user:password@attacker.example/steal",
  "//attacker.example/steal",
  "\\\\attacker.example\\steal",
  "/\\attacker.example/steal",
  "/https://attacker.example/steal",
  "../steal",
  "orders/../steal",
  "%2e%2e/steal",
  "%252e%252e/steal",
  "orders%2fsteal",
  "orders%255csteal",
  "orders?redirect=https://attacker.example",
  "orders#fragment",
  "orders\nnext",
  "orders%0anext",
] as const;

function testConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    profile: "default",
    environment: "sandbox",
    baseUrl: "https://uat-api.clinkbill.com/api/",
    apiKey: "sk_test_url_security_1234567890",
    apiTimeoutMs: 30_000,
    dryRun: false,
    outputMode: "json",
    ...overrides,
  };
}

function runClink(path: string, extraArgs: string[] = []): { status: number | null; stdout: string; stderr: string } {
  const tempConfig = join(tmpdir(), `clink-api-url-test-${process.pid}-${Date.now()}-${Math.random()}`, "config.json");
  mkdirSync(dirname(tempConfig), { recursive: true });
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/index.ts", "--json", "--dry-run", "api", "request", "POST", path, ...extraArgs],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        CLINK_CONFIG_PATH: tempConfig,
        CLINK_SECRET_KEY: "sk_test_url_security_cli_1234567890",
        CLINK_API_KEY: "",
      },
      encoding: "utf8",
    },
  );
  rmSync(dirname(tempConfig), { recursive: true, force: true });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Clink API URL resolution", () => {
  it.each([
    ["order/123", "https://api.example.test/api/order/123"],
    ["/order/123", "https://api.example.test/api/order/123"],
  ])("keeps %s under a base pathname with no trailing slash", (path, expected) => {
    expect(resolveClinkApiUrl("https://api.example.test/api", path).toString()).toBe(expected);
  });

  it("adds query parameters only from the separate query object", () => {
    const url = resolveClinkApiUrl("https://api.example.test/custom/api/", "/order/123", {
      expand: true,
      page: 2,
      omitted: undefined,
    });

    expect(url.toString()).toBe("https://api.example.test/custom/api/order/123?expand=true&page=2");
    expect(buildUrl("https://api.example.test/custom/api/", "/order/123", { expand: true, page: 2 }))
      .toBe(url.toString());
  });

  it.each(rejectedPaths)("rejects unsafe path %j", (path) => {
    expect(() => resolveClinkApiUrl("https://api.example.test/api/", path)).toThrow("Invalid Clink API path");
  });

  it.each([
    "https://user:password@api.example.test/api/",
    "https://api.example.test/api/?redirect=https://attacker.example",
    "https://api.example.test/api/#fragment",
  ])("rejects unsafe base configuration %j", (baseUrl) => {
    expect(() => resolveClinkApiUrl(baseUrl, "/order/123")).toThrow("Invalid Clink API base URL");
  });

  it("rejects an unsafe URL before constructing headers or calling fetch", async () => {
    const headersConstructor = vi.fn();
    const fetchSpy = vi.fn();
    vi.stubGlobal("Headers", headersConstructor);
    vi.stubGlobal("fetch", fetchSpy);

    const client = new ClinkApiClient(testConfig());
    await expect(client.get("https://attacker.example/steal")).rejects.toThrow("Invalid Clink API path");

    expect(headersConstructor).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("binds a validated URL to the base that created it", async () => {
    const headersConstructor = vi.fn();
    const fetchSpy = vi.fn();
    vi.stubGlobal("Headers", headersConstructor);
    vi.stubGlobal("fetch", fetchSpy);

    const client = new ClinkApiClient(testConfig());
    const attackerUrl = resolveClinkApiUrl("https://attacker.example/api/", "/steal");

    await expect(client.get(attackerUrl)).rejects.toThrow("does not match the configured API base URL");
    expect(headersConstructor).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rechecks the branded href so a copied brand cannot bypass base confinement", async () => {
    const headersConstructor = vi.fn();
    const fetchSpy = vi.fn();
    vi.stubGlobal("Headers", headersConstructor);
    vi.stubGlobal("fetch", fetchSpy);

    const client = new ClinkApiClient(testConfig());
    const legitimate = resolveClinkApiUrl("https://uat-api.clinkbill.com/api/", "/order/123");
    const forged = {
      ...legitimate,
      href: "https://attacker.example/steal",
      pathname: "/steal",
      toString: () => "https://attacker.example/steal",
    };

    await expect(client.get(forged)).rejects.toThrow("does not match the configured API base URL");
    expect(headersConstructor).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("accepts a validated URL created for the client's configured base", async () => {
    const client = new ClinkApiClient(testConfig({ dryRun: true }));
    const requestUrl = resolveClinkApiUrl("https://uat-api.clinkbill.com/api/", "/order/123", { expand: true });

    await expect(client.get(requestUrl)).resolves.toMatchObject({
      request: {
        url: "https://uat-api.clinkbill.com/api/order/123?expand=true",
      },
    });
  });
});

describe("api request URL security", () => {
  it.each([
    "https://attacker.example/steal",
    "//attacker.example/steal",
    "\\\\attacker.example\\steal",
    "../steal",
    "%252e%252e/steal",
    "orders%2fsteal",
    "orders?redirect=https://attacker.example",
  ])("fails closed for %j without exposing the Secret Key", (path) => {
    const result = runClink(path);

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("Invalid Clink API path");
    expect(`${result.stdout}${result.stderr}`).not.toContain("sk_test_url_security_cli_1234567890");
    expect(`${result.stdout}${result.stderr}`).not.toContain("attacker.example/steal\" -H");
  });

  it("uses the same confined URL for dry-run metadata and curl output", () => {
    const result = runClink("order/123", ["--query", "expand=true", "--data", "{}"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const output = JSON.parse(result.stdout) as {
      path: string;
      result: { request: { url: string } };
      curl: string;
    };
    expect(output.path).toBe("/api/order/123");
    expect(output.result.request.url).toBe("https://uat-api.clinkbill.com/api/order/123?expand=true");
    expect(output.curl).toContain('"https://uat-api.clinkbill.com/api/order/123?expand=true"');
  });
});
