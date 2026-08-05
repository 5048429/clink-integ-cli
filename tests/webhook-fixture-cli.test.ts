import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WEBHOOK_FIXTURE_TYPES } from "../src/webhook/fixtures.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function runFixture(type = "invoice.paid", profile?: string) {
  const tempDir = join(tmpdir(), `clink-webhook-fixture-cli-${process.pid}-${Date.now()}-${Math.random()}`);
  mkdirSync(tempDir, { recursive: true });
  const out = join(tempDir, `${type.replace(/[^a-z0-9]+/gi, "-")}.json`);
  const args = ["--import", "tsx", "src/index.ts", "--json", "webhook", "fixture", type, "--out", out];
  if (profile) args.push("--fixture-profile", profile);
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env: { ...process.env, CLINK_CONFIG_PATH: join(tempDir, "config.json") },
    encoding: "utf8",
  });
  const fixture = result.status === 0 ? JSON.parse(readFileSync(out, "utf8")) as Record<string, unknown> : undefined;
  rmSync(tempDir, { recursive: true, force: true });
  return { result, fixture };
}

function runFixtureWithoutOut(type: string, json = false) {
  const tempDir = join(tmpdir(), `clink-webhook-fixture-cli-stdout-${process.pid}-${Date.now()}-${Math.random()}`);
  mkdirSync(tempDir, { recursive: true });
  const args = ["--import", "tsx", "src/index.ts"];
  if (json) args.push("--json");
  args.push("webhook", "fixture", type);
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env: { ...process.env, CLINK_CONFIG_PATH: join(tempDir, "config.json") },
    encoding: "utf8",
  });
  const fixture = result.status === 0 ? JSON.parse(result.stdout) as Record<string, unknown> : undefined;
  rmSync(tempDir, { recursive: true, force: true });
  return { result, fixture };
}

describe("webhook fixture CLI profiles", () => {
  it("uses merchant-webhook by default", () => {
    const { result, fixture } = runFixture();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(fixture).toMatchObject({
      id: expect.stringMatching(/^event_/),
      object: "event",
      created: expect.any(Number),
      type: "invoice.paid",
      data: { object: expect.any(Object) },
    });
    expect(fixture).not.toHaveProperty("livemode");
  });

  it("executes all 31 stable commerce fixture commands and parses canonical JSON files", () => {
    for (const type of WEBHOOK_FIXTURE_TYPES) {
      const { result, fixture } = runFixture(type);
      expect(result.status, `${type}: ${result.stderr}`).toBe(0);
      expect(result.stderr).toBe("");
      expect(fixture).toMatchObject({
        id: expect.stringMatching(/^event_/),
        object: "event",
        created: expect.any(Number),
        type,
        data: { object: expect.any(Object) },
      });
      const data = fixture?.data as { object: Record<string, unknown> };
      expect(Number.isInteger(fixture?.created)).toBe(true);
      expect(data.object).not.toBeNull();
      expect(Array.isArray(data.object)).toBe(false);
      expect(data.object).not.toHaveProperty("object");
    }
  }, 60_000);

  it("prints production-shaped dispute and payment-method resources", () => {
    for (const type of [
      "dispute.created",
      "dispute.updated",
      "dispute.won",
      "dispute.lost",
      "dispute.closed",
    ] as const) {
      const { result, fixture } = runFixtureWithoutOut(type);
      expect(result.status, `${type}: ${result.stderr}`).toBe(0);
      const resource = (fixture?.data as { object: Record<string, unknown> }).object;
      expect(resource.evidenceDeadline).toEqual(expect.any(Number));
      expect(resource.channelDisputeTime).toEqual(expect.any(Number));
      expect(Number.isInteger(resource.evidenceDeadline)).toBe(true);
      expect(Number.isInteger(resource.channelDisputeTime)).toBe(true);
      expect(resource).not.toHaveProperty("channelCode");
    }

    const expectations = {
      "payment_method.added": undefined,
      "payment_method.default_change": undefined,
      "payment_method.update": true,
    } as const;
    for (const [type, visaRegistrationSucceeded] of Object.entries(expectations)) {
      const { result, fixture } = runFixtureWithoutOut(type);
      expect(result.status, `${type}: ${result.stderr}`).toBe(0);
      const resource = (fixture?.data as { object: Record<string, unknown> }).object;
      expect(resource.type).toBe("CARD");
      expect(resource).not.toHaveProperty("isDefault");
      if (visaRegistrationSucceeded === undefined) {
        expect(resource).not.toHaveProperty("visaRegistrationSucceeded");
      } else {
        expect(resource.visaRegistrationSucceeded).toBe(true);
      }
    }
  }, 30_000);

  it("prints install-smoke fixtures as JSON when --out is omitted", () => {
    for (const type of [
      "invoice.paid",
      "subscription.past_due",
      "refund.failed",
      "dispute.closed",
      "payment_method.update",
    ] as const) {
      const { result, fixture } = runFixtureWithoutOut(type);
      expect(result.status, `${type}: ${result.stderr}`).toBe(0);
      expect(result.stderr).toBe("");
      expect(fixture).toMatchObject({
        id: expect.stringMatching(/^event_/),
        object: "event",
        created: expect.any(Number),
        type,
        data: { object: expect.any(Object) },
      });
    }
  }, 20_000);

  it("prints the fixture itself with --json when --out is omitted", () => {
    const { result, fixture } = runFixtureWithoutOut("invoice.paid", true);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(fixture).toMatchObject({
      id: expect.stringMatching(/^event_/),
      object: "event",
      type: "invoice.paid",
      data: { object: { invoiceId: "inv_test_123" } },
    });
    expect(fixture).not.toHaveProperty("fixture");
  });

  it("requires explicit legacy selection and prints a deprecated warning", () => {
    const { result, fixture } = runFixture("invoice.paid", "legacy");
    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/Deprecated:/);
    expect(fixture).toMatchObject({
      id: expect.stringMatching(/^evt_/),
      livemode: false,
      data: { object: "invoice" },
    });
  });

  it("documents the canonical contract, supported types, and old-test-only legacy mode in help", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "src/index.ts", "webhook", "fixture", "--help"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Default merchant-webhook contract/);
    expect(result.stdout).toMatch(/refund\.succeeded/);
    expect(result.stdout).toMatch(/refund\.failed/);
    expect(result.stdout).toMatch(/dispute\.created/);
    expect(result.stdout).toMatch(/payment_method\.update/);
    expect(result.stdout).toMatch(/without it the fixture\s+is printed/);
    expect(result.stdout).toMatch(/only for compatibility with old tests/);
  });
});
