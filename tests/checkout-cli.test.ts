import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ExitCode } from "../src/exit-codes.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runClink(args: string[]): CliResult {
  const tempConfig = join(tmpdir(), `clink-checkout-cli-test-${process.pid}-${Date.now()}`, "config.json");
  mkdirSync(dirname(tempConfig), { recursive: true });

  const env = {
    ...process.env,
    CLINK_CONFIG_PATH: tempConfig,
    CLINK_SECRET_KEY: "",
    CLINK_API_KEY: "",
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

describe("checkout create dry-run", () => {
  it("documents amount and currency as required for both checkout modes", () => {
    const result = runClink(["checkout", "create", "--help"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const help = result.stdout.replace(/\s+/g, " ");
    expect(help).toMatch(/--amount <amount>.*required for registered and inline checkout/);
    expect(help).toMatch(/--currency <currency>.*required for registered and inline checkout/);
  });

  it("builds inline priceDataList with amount equal to unitAmount times quantity", () => {
    const result = runClink([
      "--json",
      "--dry-run",
      "checkout",
      "create",
      "--customer-email",
      "buyer@example.com",
      "--amount",
      "20",
      "--currency",
      "USD",
      "--name",
      "Two seats",
      "--quantity",
      "2",
      "--unit-amount",
      "10",
      "--success-url",
      "https://example.com/success",
      "--cancel-url",
      "https://example.com/cancel",
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const output = JSON.parse(result.stdout) as {
      mode: string;
      result: { request: { body: Record<string, unknown> } };
    };
    expect(output.mode).toBe("inline");
    expect(output.result.request.body).toMatchObject({
      customerEmail: "buyer@example.com",
      originalAmount: 20,
      originalCurrency: "USD",
      showPromotionCode: true,
      localPriceOnly: false,
      priceDataList: [
        {
          name: "Two seats",
          quantity: 2,
          unitAmount: 10,
          currency: "USD",
        },
      ],
    });
  });

  it("builds registered product and price payloads", () => {
    const result = runClink([
      "--json",
      "--dry-run",
      "checkout",
      "create",
      "--customer-email",
      "buyer@example.com",
      "--amount",
      "10",
      "--currency",
      "USD",
      "--product-id",
      "prd_xxx",
      "--price-id",
      "price_xxx",
    ]);

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout) as {
      mode: string;
      result: { request: { body: Record<string, unknown> } };
    };
    expect(output.mode).toBe("registered");
    expect(output.result.request.body).toMatchObject({
      productId: "prd_xxx",
      priceId: "price_xxx",
      originalAmount: 10,
      originalCurrency: "USD",
      showPromotionCode: true,
      localPriceOnly: false,
    });
    expect(output.result.request.body).not.toHaveProperty("priceDataList");
  });

  it("rejects product ID without price ID", () => {
    const result = runClink([
      "--json",
      "--dry-run",
      "checkout",
      "create",
      "--customer-email",
      "buyer@example.com",
      "--amount",
      "10",
      "--currency",
      "USD",
      "--product-id",
      "prd_xxx",
    ]);

    expect(result.status).toBe(ExitCode.USAGE);
    expect(JSON.parse(result.stderr)).toMatchObject({
      ok: false,
      exitCode: ExitCode.USAGE,
    });
  });

  it("rejects inline amount mismatches", () => {
    const result = runClink([
      "--json",
      "--dry-run",
      "checkout",
      "create",
      "--customer-email",
      "buyer@example.com",
      "--amount",
      "20",
      "--currency",
      "USD",
      "--quantity",
      "3",
      "--unit-amount",
      "10",
    ]);

    expect(result.status).toBe(ExitCode.USAGE);
    expect(JSON.parse(result.stderr)).toMatchObject({
      ok: false,
      exitCode: ExitCode.USAGE,
    });
  });
});

describe("checkout get dry-run", () => {
  it("accepts a hosted checkout URL and extracts the session ID", () => {
    const result = runClink([
      "--json",
      "--dry-run",
      "checkout",
      "get",
      "https://uat-checkout.clinkbill.com/pay/sess_abc123xyz",
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const output = JSON.parse(result.stdout) as {
      sessionId: string;
      result: { request: { method: string; url: string } };
    };
    expect(output).toMatchObject({
      sessionId: "sess_abc123xyz",
      result: {
        request: {
          method: "GET",
          url: "https://uat-api.clinkbill.com/api/checkout/session/sess_abc123xyz",
        },
      },
    });
  });
});
