import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runClink(args: string[], configPath: string, envOverrides: Record<string, string> = {}): CliResult {
  const env = {
    ...process.env,
    CLINK_CONFIG_PATH: configPath,
    CLINK_SECRET_KEY: "",
    CLINK_API_KEY: "",
    CLINK_WEBHOOK_SIGNING_KEY: "",
    CLINK_WEBHOOK_SECRET: "",
    ...envOverrides,
  };

  const result = spawnSync(process.execPath, ["--import", "tsx", "src/index.ts", ...args], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
  });

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe("auth secret set", () => {
  it("keeps legacy auth set compatible with root-level API key parsing", () => {
    const tempConfig = join(tmpdir(), `clink-auth-set-test-${process.pid}-${Date.now()}`, "config.json");
    mkdirSync(dirname(tempConfig), { recursive: true });
    const rawSecret = "sk_test_legacy_secret_1234567890";

    try {
      const setResult = runClink([
        "--json",
        "auth",
        "set",
        "--api-key",
        rawSecret,
        "--env",
        "sandbox",
      ], tempConfig);

      expect(setResult.status).toBe(0);
      expect(setResult.stderr).toBe("");
      expect(setResult.stdout).not.toContain(rawSecret);

      const statusResult = runClink(["--json", "auth", "status"], tempConfig);
      expect(statusResult.status).toBe(0);
      expect(statusResult.stdout).not.toContain(rawSecret);
      expect(JSON.parse(statusResult.stdout)).toMatchObject({
        apiKey: "sk_t...7890",
        apiKeySource: "literal",
      });
    } finally {
      rmSync(dirname(tempConfig), { recursive: true, force: true });
    }
  });

  it("stores a manually provided Secret Key and masks it in command output", () => {
    const tempConfig = join(tmpdir(), `clink-auth-secret-test-${process.pid}-${Date.now()}`, "config.json");
    mkdirSync(dirname(tempConfig), { recursive: true });
    const rawSecret = "sk_test_manual_secret_1234567890";

    try {
      const setResult = runClink([
        "--json",
        "auth",
        "secret",
        "set",
        "--api-key",
        rawSecret,
        "--env",
        "sandbox",
      ], tempConfig);

      expect(setResult.status).toBe(0);
      expect(setResult.stderr).toBe("");
      expect(setResult.stdout).not.toContain(rawSecret);
      expect(JSON.parse(setResult.stdout)).toMatchObject({
        environment: "sandbox",
        apiKey: "sk_t...7890",
        apiKeySource: "literal",
        ready: true,
      });
      if (process.platform !== "win32") {
        expect(statSync(tempConfig).mode & 0o777).toBe(0o600);
      }

      const statusResult = runClink(["--json", "auth", "status"], tempConfig);
      expect(statusResult.status).toBe(0);
      expect(statusResult.stderr).toBe("");
      expect(statusResult.stdout).not.toContain(rawSecret);
      expect(JSON.parse(statusResult.stdout)).toMatchObject({
        environment: "sandbox",
        apiKey: "sk_t...7890",
        apiKeySource: "literal",
      });
    } finally {
      rmSync(dirname(tempConfig), { recursive: true, force: true });
    }
  });

  describe.skipIf(process.platform === "win32")("POSIX config permissions", () => {
    it.each([0o600, 0o640, 0o644, 0o664, 0o777])("tightens an existing config mode of %o to 0600", (mode) => {
      const tempConfig = join(tmpdir(), `clink-auth-mode-test-${process.pid}-${Date.now()}-${mode}`, "config.json");
      mkdirSync(dirname(tempConfig), { recursive: true });
      writeFileSync(tempConfig, `${JSON.stringify({ defaultProfile: "default", profiles: {} }, null, 2)}\n`, {
        encoding: "utf8",
        mode,
      });
      chmodSync(tempConfig, mode);

      try {
        const result = runClink([
          "--json",
          "auth",
          "secret",
          "set",
          "--api-key",
          "sk_test_mode_secret_1234567890",
          "--env",
          "sandbox",
        ], tempConfig);

        expect(result.status).toBe(0);
        expect(statSync(tempConfig).mode & 0o777).toBe(0o600);
        expect(readFileSync(tempConfig, "utf8")).toContain("sk_test_mode_secret_1234567890");
      } finally {
        rmSync(dirname(tempConfig), { recursive: true, force: true });
      }
    });
  });

  it("stores env references without copying the resolved Secret Key into config", () => {
    const tempConfig = join(tmpdir(), `clink-auth-secret-env-test-${process.pid}-${Date.now()}`, "config.json");
    mkdirSync(dirname(tempConfig), { recursive: true });
    const rawSecret = "sk_test_env_secret_abcdef123456";

    try {
      const setResult = runClink([
        "--json",
        "auth",
        "secret",
        "set",
        "--api-key",
        "env:MANUAL_CLINK_SECRET",
      ], tempConfig, { MANUAL_CLINK_SECRET: rawSecret });

      expect(setResult.status).toBe(0);
      expect(setResult.stderr).toBe("");
      expect(setResult.stdout).not.toContain(rawSecret);
      expect(JSON.parse(setResult.stdout)).toMatchObject({
        apiKey: "sk_t...3456",
        apiKeySource: "env:MANUAL_CLINK_SECRET",
        ready: true,
      });

      const savedConfig = readFileSync(tempConfig, "utf8");
      expect(savedConfig).toContain("MANUAL_CLINK_SECRET");
      expect(savedConfig).not.toContain(rawSecret);
    } finally {
      rmSync(dirname(tempConfig), { recursive: true, force: true });
    }
  });
});
