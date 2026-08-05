import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function runFixture(profile?: string) {
  const tempDir = join(tmpdir(), `clink-webhook-fixture-cli-${process.pid}-${Date.now()}-${Math.random()}`);
  mkdirSync(tempDir, { recursive: true });
  const out = join(tempDir, "invoice-paid.json");
  const args = ["--import", "tsx", "src/index.ts", "--json", "webhook", "fixture", "invoice.paid", "--out", out];
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

  it("requires explicit legacy selection and prints a deprecated warning", () => {
    const { result, fixture } = runFixture("legacy");
    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/Deprecated:/);
    expect(fixture).toMatchObject({
      id: expect.stringMatching(/^evt_/),
      livemode: false,
      data: { object: "invoice" },
    });
  });
});
