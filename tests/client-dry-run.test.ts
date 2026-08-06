import { afterEach, describe, expect, it, vi } from "vitest";
import { ClinkApiClient } from "../src/api/client.js";
import type { RuntimeConfig } from "../src/types.js";

function testConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    profile: "default",
    environment: "sandbox",
    baseUrl: "https://uat-api.clinkbill.com/api/",
    apiTimeoutMs: 30_000,
    dryRun: true,
    outputMode: "json",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("dry-run request generation", () => {
  it("returns request metadata without requiring or exposing an API key", async () => {
    const client = new ClinkApiClient(testConfig());
    const body = {
      name: "Test",
      image: "oss_test",
      taxCategory: "software_service",
    };

    const result = await client.post("/product", { body });

    expect(result).toEqual({
      dryRun: true,
      request: {
        method: "POST",
        url: "https://uat-api.clinkbill.com/api/product",
        headers: {
          "X-API-KEY": "[masked]",
          "X-Timestamp": "[generated]",
          "Content-Type": "application/json",
        },
        body,
      },
    });
  });
});

describe("public API error redaction", () => {
  it("redacts secrets from non-2xx response bodies", async () => {
    const apiKey = "sk_test_public_api_key_1234567890";
    const signingSecret = "whsec_public_signing_secret_1234567890";
    const jwt = "eyJhbGciOiJIUzI1NiJ9.payload.signature";
    const genericSecret = "sk_live_other_secret_1234567890";
    const genericWebhookSecret = "whsec_other_signing_secret_1234567890";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: `apiKey=${apiKey} signing=${signingSecret} jwt=${jwt} leaked=${genericSecret} webhook=${genericWebhookSecret}`,
          }),
          { status: 400 },
        ),
      ),
    );

    const client = new ClinkApiClient(testConfig({
      dryRun: false,
      apiKey,
      webhookSigningKey: signingSecret,
    }));

    let message = "";
    try {
      await client.get("/bad-request");
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("Clink API GET /api/bad-request failed with 400");
    expect(message).not.toContain(apiKey);
    expect(message).not.toContain(signingSecret);
    expect(message).not.toContain(jwt);
    expect(message).not.toContain(genericSecret);
    expect(message).not.toContain(genericWebhookSecret);
    expect(message).toContain("sk_t...7890");
    expect(message).toContain("whse...7890");
    expect(message).toContain("[masked-secret-key]");
    expect(message).toContain("[masked-webhook-secret]");
    expect(message).toContain("[masked-jwt]");
  });

  it("redacts secrets from non-success API envelopes", async () => {
    const apiKey = "sk_test_envelope_key_1234567890";
    const signingSecret = "whsec_envelope_secret_1234567890";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            code: 401,
            msg: `invalid apiKey=${apiKey} signing=${signingSecret}`,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      ),
    );

    const client = new ClinkApiClient(testConfig({
      dryRun: false,
      apiKey,
      webhookSigningKey: signingSecret,
    }));

    let message = "";
    try {
      await client.get("/envelope-error");
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("Clink API GET /api/envelope-error returned code 401");
    expect(message).not.toContain(apiKey);
    expect(message).not.toContain(signingSecret);
    expect(message).toContain("sk_t...7890");
    expect(message).toContain("whse...7890");
  });
});
