import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const REQUIRED_ACCEPTANCE_FIXTURES = [
  "order.succeeded",
  "order.failed",
  "refund.succeeded",
  "subscription.activated",
  "subscription.updated.renewed",
  "subscription.past_due",
  "subscription.cancelled",
  "invoice.open",
  "invoice.paid",
  "invoice.void",
  "dispute.created",
] as const;

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

  it("executes all 11 acceptance fixture commands and parses canonical JSON files", () => {
    for (const type of REQUIRED_ACCEPTANCE_FIXTURES) {
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
    }
  }, 20_000);

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
    expect(result.stdout).toMatch(/dispute\.created/);
    expect(result.stdout).toMatch(/only for compatibility with old tests/);
  });
});
