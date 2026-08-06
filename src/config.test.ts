import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveRuntimeConfig } from "./config.js";
import type { StoredConfig } from "./types.js";

let tempDir: string;
let configPath: string;
const savedEnv: Record<string, string | undefined> = {};

function setEnv(name: string, value: string | undefined): void {
  if (!(name in savedEnv)) savedEnv[name] = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function writeConfig(config: StoredConfig): void {
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "clink-cfg-"));
  configPath = join(tempDir, "config.json");
  setEnv("CLINK_CONFIG_PATH", configPath);
  setEnv("CLINK_ENV", undefined);
  setEnv("CLINK_BASE_URL", undefined);
  setEnv("CLINK_SECRET_KEY", undefined);
  setEnv("CLINK_API_KEY", undefined);
  setEnv("CLINK_WEBHOOK_SIGNING_KEY", undefined);
  setEnv("CLINK_WEBHOOK_SECRET", undefined);
  setEnv("CLINK_API_TIMEOUT_MS", undefined);
});

afterEach(() => {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  for (const key of Object.keys(savedEnv)) delete savedEnv[key];
  rmSync(tempDir, { recursive: true, force: true });
});

describe("resolveRuntimeConfig environments", () => {
  it("defaults to sandbox when no config exists", async () => {
    const config = await resolveRuntimeConfig({});
    expect(config.environment).toBe("sandbox");
    expect(config.baseUrl).toBe("https://uat-api.clinkbill.com/api/");
    expect(config.dashboardEndpoints.baseUrl).toBe("https://uat-dashboard.clinkbill.com/prod-api/");
    expect(config.apiTimeoutMs).toBe(30_000);
  });

  it("supports a bounded API timeout from options or CLINK_API_TIMEOUT_MS", async () => {
    setEnv("CLINK_API_TIMEOUT_MS", "2500");
    expect((await resolveRuntimeConfig({})).apiTimeoutMs).toBe(2500);
    expect((await resolveRuntimeConfig({ timeoutMs: "75" })).apiTimeoutMs).toBe(75);
    await expect(resolveRuntimeConfig({ timeoutMs: "0" })).rejects.toThrow(/positive integer/);
  });

  it("uses prod base with UAT dashboard fallback for production", async () => {
    const config = await resolveRuntimeConfig({ env: "production" });
    expect(config.baseUrl).toBe("https://api.clinkbill.com/api/");
    expect(config.dashboardEndpoints.baseUrl).toBe("https://uat-dashboard.clinkbill.com/prod-api/");
  });

  it("resolves a custom environment's API base and dashboard endpoints", async () => {
    writeConfig({
      defaultProfile: "default",
      profiles: {},
      environments: {
        staging: {
          apiBaseUrl: "https://staging-api.clinkbill.com/api/",
          dashboardBaseUrl: "https://staging-dashboard.clinkbill.com/prod-api/",
          dashboardLoginUrl: "https://staging-dashboard.clinkbill.com/auth/login",
          dashboardClientId: "staging-client-id",
        },
      },
    });
    const config = await resolveRuntimeConfig({ env: "staging" });
    expect(config.environment).toBe("staging");
    expect(config.baseUrl).toBe("https://staging-api.clinkbill.com/api/");
    expect(config.dashboardEndpoints).toEqual({
      baseUrl: "https://staging-dashboard.clinkbill.com/prod-api/",
      loginUrl: "https://staging-dashboard.clinkbill.com/auth/login",
      clientId: "staging-client-id",
    });
  });

  it("honors CLINK_ENV for custom environment names", async () => {
    writeConfig({
      defaultProfile: "default",
      profiles: {},
      environments: { staging: { apiBaseUrl: "https://staging-api.clinkbill.com/api/" } },
    });
    setEnv("CLINK_ENV", "staging");
    const config = await resolveRuntimeConfig({});
    expect(config.environment).toBe("staging");
    expect(config.baseUrl).toBe("https://staging-api.clinkbill.com/api/");
  });

  it("lets --base-url override the environment registry", async () => {
    writeConfig({
      defaultProfile: "default",
      profiles: {},
      environments: { staging: { apiBaseUrl: "https://staging-api.clinkbill.com/api/" } },
    });
    const config = await resolveRuntimeConfig({ env: "staging", baseUrl: "https://override.example.com/api" });
    expect(config.baseUrl).toBe("https://override.example.com/api/");
  });

  it("lets CLINK_BASE_URL override the environment registry", async () => {
    setEnv("CLINK_BASE_URL", "https://env-override.example.com/api/");
    const config = await resolveRuntimeConfig({ env: "production" });
    expect(config.baseUrl).toBe("https://env-override.example.com/api/");
  });

  it("falls back to sandbox base for unknown environment names", async () => {
    const config = await resolveRuntimeConfig({ env: "ghost" });
    expect(config.environment).toBe("ghost");
    expect(config.baseUrl).toBe("https://uat-api.clinkbill.com/api/");
  });
});
