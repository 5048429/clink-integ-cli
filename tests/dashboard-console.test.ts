import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DashboardConsoleClient,
  buildDashboardHeaders,
  extractDashboardApiKeyRecords,
  extractDashboardMerchantRecords,
  extractDashboardWebhookRecords,
  findDashboardSecretKey,
  maskDashboardHeaders,
  maskDashboardApiKeyRecord,
  maskDashboardProfile,
  maskDashboardWebhookRecord,
} from "../src/dashboard-console.js";
import { ExitCode } from "../src/exit-codes.js";
import type { StoredConfig } from "../src/types.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runClink(args: string[], storedConfig?: StoredConfig): CliResult {
  const tempConfig = join(tmpdir(), `clink-dashboard-cli-test-${process.pid}-${Date.now()}`, "config.json");
  mkdirSync(dirname(tempConfig), { recursive: true });

  if (storedConfig) {
    writeFileSync(tempConfig, `${JSON.stringify(storedConfig, null, 2)}\n`, "utf8");
  }

  const env = {
    ...process.env,
    CLINK_CONFIG_PATH: tempConfig,
    CLINK_SECRET_KEY: "",
    CLINK_API_KEY: "",
    CLINK_WEBHOOK_SIGNING_KEY: "",
    CLINK_WEBHOOK_SECRET: "",
  };

  const result = spawnSync(process.execPath, ["--import", "tsx", "src/index.ts", ...args], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
  });

  rmSync(dirname(tempConfig), { recursive: true, force: true });

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe("Dashboard Console token masking", () => {
  it("masks Authorization headers and stored profile output", () => {
    const rawToken = "satoken_dashboard_access_token_1234567890";
    const headers = buildDashboardHeaders({
      accessToken: rawToken,
      clientId: "client_123",
    });

    expect(maskDashboardHeaders(headers)).toMatchObject({
      Authorization: "Bearer [masked]",
      ClientID: "client_123",
      "Accept-Language": "zh_CN",
      "Content-Language": "zh_CN",
    });

    const maskedProfile = maskDashboardProfile({
      baseUrl: "https://uat-dashboard.clinkbill.com/prod-api/",
      clientId: "client_123",
      accessToken: rawToken,
      savedAt: "2026-06-17T00:00:00Z",
    });

    expect(JSON.stringify(maskedProfile)).not.toContain(rawToken);
    expect(maskedProfile.accessToken).toBe("sato...7890");
  });

  it("masks Dashboard tokens echoed by error responses", async () => {
    const rawToken = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.payload.signature";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            code: 401,
            msg: `token has been frozen: ${rawToken}`,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    const client = new DashboardConsoleClient({
      baseUrl: "https://uat-dashboard.clinkbill.com/prod-api/",
      accessToken: rawToken,
      clientId: "client_123",
    });

    let message = "";
    try {
      await client.getInfo();
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("Dashboard API GET /platform/user/getInfo returned code 401");
    expect(message).not.toContain(rawToken);
    expect(message).toContain("eyJ0...ture");
  });
});

describe("Dashboard Console whoami dry-run", () => {
  it("prints masked getInfo headers from the saved dashboard profile", async () => {
    const rawToken = "satoken_dashboard_access_token_abcdef1234567890";
    const client = new DashboardConsoleClient(
      {
        baseUrl: "https://uat-dashboard.clinkbill.com/prod-api/",
        accessToken: rawToken,
        clientId: "client_123",
      },
      true,
    );

    await expect(client.getInfo()).resolves.toEqual({
      dryRun: true,
      request: {
        method: "GET",
        url: "https://uat-dashboard.clinkbill.com/prod-api/platform/user/getInfo",
        headers: {
          Authorization: "Bearer [masked]",
          ClientID: "client_123",
          "Accept-Language": "zh_CN",
          "Content-Language": "zh_CN",
        },
      },
    });

    const result = runClink(
      ["--json", "--dry-run", "dashboard", "whoami"],
      {
        defaultProfile: "default",
        profiles: {
          default: {
            dashboard: {
              baseUrl: "https://uat-dashboard.clinkbill.com/prod-api/",
              clientId: "client_123",
              accessToken: rawToken,
              savedAt: "2026-06-17T00:00:00Z",
            },
          },
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain(rawToken);

    const output = JSON.parse(result.stdout) as {
      result: { request: { headers: Record<string, string> } };
    };
    expect(output.result.request.headers).toMatchObject({
      Authorization: "Bearer [masked]",
      ClientID: "client_123",
      "Accept-Language": "zh_CN",
      "Content-Language": "zh_CN",
    });
  });
});

describe("Dashboard API key helpers", () => {
  it("extracts Secret Key records and masks key values", () => {
    const rawSecret = "sk_uat_secret_1234567890";
    const records = extractDashboardApiKeyRecords({
      rows: [
        {
          apikeyId: "key_pk",
          apikeyName: "Publishable Key",
          keyType: "PK",
          keyValue: "pk_uat_public_1234567890",
        },
        {
          apikeyId: "key_sk",
          apikeyName: "Secret Key",
          keyType: "SK",
          keyValue: rawSecret,
        },
      ],
    });

    expect(findDashboardSecretKey(records)).toMatchObject({
      apikeyId: "key_sk",
      keyValue: rawSecret,
    });

    const masked = maskDashboardApiKeyRecord(records[1]);
    expect(JSON.stringify(masked)).not.toContain(rawSecret);
    expect(masked.keyValue).toBe("sk_u...7890");
  });

  it("generates dry-run requests for Dashboard API key endpoints", async () => {
    const client = new DashboardConsoleClient(
      {
        baseUrl: "https://uat-dashboard.clinkbill.com/prod-api/",
        accessToken: "satoken_dashboard_access_token_abcdef1234567890",
        clientId: "client_123",
      },
      true,
    );

    await expect(client.listApiKeys()).resolves.toMatchObject({
      dryRun: true,
      request: {
        method: "GET",
        url: "https://uat-dashboard.clinkbill.com/prod-api/platform/apikey/list",
        headers: {
          Authorization: "Bearer [masked]",
          ClientID: "client_123",
        },
      },
    });

    await expect(client.initializeStandardApiKeys()).resolves.toMatchObject({
      dryRun: true,
      request: {
        method: "POST",
        url: "https://uat-dashboard.clinkbill.com/prod-api/platform/apikey/standard",
        headers: {
          Authorization: "Bearer [masked]",
          ClientID: "client_123",
        },
      },
    });
  });

  it("prints a masked ensure-secret dry-run plan", () => {
    const rawToken = "satoken_dashboard_access_token_abcdef1234567890";
    const result = runClink(
      ["--json", "--dry-run", "dashboard", "apikey", "ensure-secret", "--save"],
      {
        defaultProfile: "default",
        profiles: {
          default: {
            dashboard: {
              baseUrl: "https://uat-dashboard.clinkbill.com/prod-api/",
              clientId: "client_123",
              accessToken: rawToken,
              savedAt: "2026-06-17T00:00:00Z",
            },
          },
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain(rawToken);
    const output = JSON.parse(result.stdout) as { plan: Array<{ step: string; result?: { request?: { headers?: Record<string, string> } } }> };
    expect(output.plan.map((step) => step.step)).toEqual([
      "list_api_keys",
      "initialize_standard_keys_if_missing",
      "save_secret_key",
    ]);
    expect(output.plan[0].result?.request?.headers?.Authorization).toBe("Bearer [masked]");
  });
});

describe("Dashboard merchant and webhook helpers", () => {
  it("extracts merchants and masks webhook signing keys", () => {
    const merchants = extractDashboardMerchantRecords({
      data: {
        rows: [
          {
            merchantId: "mcht_123",
            merchantName: "Demo Merchant",
          },
        ],
      },
    });
    expect(merchants).toEqual([
      {
        merchantId: "mcht_123",
        merchantName: "Demo Merchant",
      },
    ]);

    const rawSignKey = "whsec_uat_secret_1234567890";
    const webhooks = extractDashboardWebhookRecords({
      rows: [
        {
          webhookKeyId: "whk_123",
          endpoint: "https://example.com/api/clink/webhook",
          eventType: "order.succeeded,invoice.paid",
          signKey: rawSignKey,
        },
      ],
    });

    expect(webhooks[0]).toMatchObject({
      webhookKeyId: "whk_123",
      signKey: rawSignKey,
    });

    const masked = maskDashboardWebhookRecord(webhooks[0]);
    expect(JSON.stringify(masked)).not.toContain(rawSignKey);
    expect(masked.signKey).toBe("whse...7890");
  });

  it("generates dry-run requests for Dashboard webhook endpoints", async () => {
    const client = new DashboardConsoleClient(
      {
        baseUrl: "https://uat-dashboard.clinkbill.com/prod-api/",
        accessToken: "satoken_dashboard_access_token_abcdef1234567890",
        clientId: "client_123",
      },
      true,
    );

    await expect(client.listMerchants()).resolves.toMatchObject({
      dryRun: true,
      request: {
        method: "GET",
        url: "https://uat-dashboard.clinkbill.com/prod-api/platform/merchant/list",
        headers: {
          Authorization: "Bearer [masked]",
          ClientID: "client_123",
        },
      },
    });

    await expect(client.listWebhooks("mcht_123")).resolves.toMatchObject({
      dryRun: true,
      request: {
        method: "GET",
        url: "https://uat-dashboard.clinkbill.com/prod-api/platform/webhook/list?merchantId=mcht_123",
        headers: {
          Authorization: "Bearer [masked]",
          ClientID: "client_123",
        },
      },
    });

    await expect(
      client.createWebhook({
        endpoint: "https://example.com/api/clink/webhook",
        remark: "Created by test",
        eventType: "order.succeeded",
        status: 0,
      }),
    ).resolves.toMatchObject({
      dryRun: true,
      request: {
        method: "POST",
        url: "https://uat-dashboard.clinkbill.com/prod-api/platform/webhook",
        headers: {
          Authorization: "Bearer [masked]",
          ClientID: "client_123",
          "Content-Type": "application/json",
        },
        body: {
          endpoint: "https://example.com/api/clink/webhook",
          eventType: "order.succeeded",
          status: 0,
        },
      },
    });
  });

  it("generates dry-run requests to enable Dashboard webhooks", () => {
    const rawToken = "satoken_dashboard_access_token_abcdef1234567890";
    const result = runClink(
      ["--json", "--dry-run", "dashboard", "webhook", "enable", "whk_123"],
      {
        defaultProfile: "default",
        profiles: {
          default: {
            dashboard: {
              baseUrl: "https://uat-dashboard.clinkbill.com/prod-api/",
              clientId: "client_123",
              accessToken: rawToken,
              savedAt: "2026-06-17T00:00:00Z",
            },
          },
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain(rawToken);
    expect(JSON.parse(result.stdout)).toMatchObject({
      endpointId: "whk_123",
      result: {
        request: {
          method: "POST",
          url: "https://uat-api.clinkbill.com/api/webhook/endpoints/whk_123/enable",
          headers: {
            "X-API-KEY": "[masked]",
            "X-Timestamp": "[generated]",
          },
        },
      },
    });
  });

});

describe("Dashboard Console missing token", () => {
  it("returns an auth-required JSON error when no dashboard token is saved", () => {
    const result = runClink(["--json", "dashboard", "whoami"]);

    expect(result.status).toBe(ExitCode.AUTH_REQUIRED);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({
      ok: false,
      exitCode: ExitCode.AUTH_REQUIRED,
    });
  });
});
