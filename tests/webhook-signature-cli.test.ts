import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyWebhookPayload } from "../src/webhook/signature.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
let tempDir: string;
let bodyFile: string;

beforeEach(() => {
  tempDir = join(tmpdir(), `clink-webhook-signature-cli-${process.pid}-${Date.now()}-${Math.random()}`);
  mkdirSync(tempDir, { recursive: true });
  bodyFile = join(tempDir, "event.json");
  writeFileSync(bodyFile, '{"id":"event_signature_test","object":"event"}\n', "utf8");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function run(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", "src/index.ts", "--json", ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      CLINK_CONFIG_PATH: join(tempDir, "config.json"),
      CLINK_WEBHOOK_SIGNING_KEY: "",
    },
    encoding: "utf8",
  });
}

describe("webhook signature CLI", () => {
  it("signs the exact raw file, returns matching headers, and never prints the secret", () => {
    const secret = "local_signature_secret_1234567890";
    const timestamp = String(Date.now());
    const result = run([
      "webhook", "sign", "--body-file", bodyFile, "--secret", secret, "--timestamp", timestamp,
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain(secret);
    expect(result.stderr).not.toContain(secret);
    const output = JSON.parse(result.stdout) as {
      timestamp: string;
      signature: string;
      headers: Record<string, string>;
    };
    expect(output.timestamp).toBe(timestamp);
    expect(output.headers["X-Clink-Timestamp"]).toBe(timestamp);
    expect(output.headers["X-Clink-Signature"]).toBe(output.signature);
    expect(verifyWebhookPayload(secret, timestamp, readFileSync(bodyFile, "utf8"), output.signature, {
      nowMs: Number(timestamp),
    })).toBe(true);
  });

  it("accepts the original body/secret and rejects body, timestamp, and secret tampering", () => {
    const secret = "local_signature_secret_1234567890";
    const timestamp = String(Date.now());
    const signed = run([
      "webhook", "sign", "--body-file", bodyFile, "--secret", secret, "--timestamp", timestamp,
    ]);
    const signature = (JSON.parse(signed.stdout) as { signature: string }).signature;

    const valid = run([
      "webhook", "verify", "--body-file", bodyFile, "--secret", secret,
      "--timestamp", timestamp, "--signature", signature,
    ]);
    expect(valid.status).toBe(0);
    expect(JSON.parse(valid.stdout)).toMatchObject({ valid: true });

    writeFileSync(bodyFile, '{"id":"event_signature_tampered","object":"event"}\n', "utf8");
    const tamperedBody = run([
      "webhook", "verify", "--body-file", bodyFile, "--secret", secret,
      "--timestamp", timestamp, "--signature", signature,
    ]);
    expect(tamperedBody.status).not.toBe(0);
    expect(JSON.parse(tamperedBody.stdout)).toMatchObject({ valid: false });

    writeFileSync(bodyFile, '{"id":"event_signature_test","object":"event"}\n', "utf8");
    const tamperedTimestamp = run([
      "webhook", "verify", "--body-file", bodyFile, "--secret", secret,
      "--timestamp", String(Number(timestamp) + 1), "--signature", signature,
    ]);
    expect(tamperedTimestamp.status).not.toBe(0);

    const wrongSecret = run([
      "webhook", "verify", "--body-file", bodyFile, "--secret", "wrong_signature_secret_1234567890",
      "--timestamp", timestamp, "--signature", signature,
    ]);
    expect(wrongSecret.status).not.toBe(0);
  }, 15_000);
});
