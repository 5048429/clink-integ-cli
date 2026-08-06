import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { writePrivateTextFileAtomically } from "./atomic-write.js";
import { BASE_URLS, DEFAULT_PROFILE } from "./constants.js";
import { getEnvironmentDefinition, resolveDashboardEndpoints } from "./environments.js";
import type { ClinkEnvironment, GlobalOptions, RuntimeConfig, StoredConfig, StoredProfile } from "./types.js";

function emptyConfig(): StoredConfig {
  return {
    defaultProfile: DEFAULT_PROFILE,
    profiles: {},
  };
}

export function getConfigPath(): string {
  return process.env.CLINK_CONFIG_PATH || defaultConfigPath();
}

export async function readStoredConfig(): Promise<StoredConfig> {
  try {
    const raw = await readFile(getConfigPath(), "utf8");
    const parsed = JSON.parse(raw) as StoredConfig;
    return {
      defaultProfile: parsed.defaultProfile ?? DEFAULT_PROFILE,
      profiles: parsed.profiles ?? {},
      environments: parsed.environments ?? {},
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      if (!process.env.CLINK_CONFIG_PATH) {
        return readLegacyStoredConfig();
      }
      return emptyConfig();
    }
    throw error;
  }
}

async function readLegacyStoredConfig(): Promise<StoredConfig> {
  try {
    const raw = await readFile(legacyConfigPath(), "utf8");
    const parsed = JSON.parse(raw) as StoredConfig;
    return {
      defaultProfile: parsed.defaultProfile ?? DEFAULT_PROFILE,
      profiles: parsed.profiles ?? {},
      environments: parsed.environments ?? {},
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyConfig();
    }
    throw error;
  }
}

function defaultConfigPath(): string {
  return join(homedir(), ".clink-integ-cli", "config.json");
}

function legacyConfigPath(): string {
  return join(homedir(), ".clink-dev-cli", "config.json");
}

export async function writeStoredConfig(config: StoredConfig): Promise<void> {
  const configPath = getConfigPath();
  await writePrivateTextFileAtomically(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

export function resolveSecretRef(
  value: string | undefined,
  envFallbacks: string[],
): { secret?: string; source?: string; envName?: string; literal?: string } {
  if (value) {
    if (value.startsWith("env:")) {
      const envName = value.slice("env:".length);
      return { secret: process.env[envName], source: `env:${envName}`, envName };
    }
    return { secret: value, source: "literal", literal: value };
  }

  for (const envName of envFallbacks) {
    if (process.env[envName]) {
      return { secret: process.env[envName], source: `env:${envName}`, envName };
    }
  }

  return {};
}

export async function getProfile(name: string): Promise<StoredProfile> {
  const config = await readStoredConfig();
  return config.profiles[name] ?? {};
}

export async function saveProfile(name: string, profile: StoredProfile): Promise<void> {
  const config = await readStoredConfig();
  config.defaultProfile = config.defaultProfile ?? DEFAULT_PROFILE;
  config.profiles[name] = {
    ...(config.profiles[name] ?? {}),
    ...profile,
  };
  await writeStoredConfig(config);
}

export async function resolveRuntimeConfig(options: GlobalOptions): Promise<RuntimeConfig> {
  const profileName = options.profile ?? DEFAULT_PROFILE;
  const stored = await readStoredConfig();
  const profile = stored.profiles[profileName] ?? {};

  const environment = options.env ?? profile.environment ?? readEnvironmentFromEnv() ?? "sandbox";
  const envDef = getEnvironmentDefinition(stored, environment);
  const baseUrl = normalizeBaseUrl(
    options.baseUrl ?? profile.baseUrl ?? process.env.CLINK_BASE_URL ?? envDef?.apiBaseUrl ?? BASE_URLS.sandbox,
  );
  const dashboardEndpoints = resolveDashboardEndpoints(envDef);

  const apiKeyRef = resolveSecretRef(options.apiKey, ["CLINK_SECRET_KEY", "CLINK_API_KEY"]);
  const profileApiKey = profile.apiKeyEnv
    ? resolveSecretRef(`env:${profile.apiKeyEnv}`, [])
    : resolveSecretRef(profile.apiKey, []);
  const apiKey = apiKeyRef.secret ?? profileApiKey.secret;
  const apiKeySource = apiKeyRef.source ?? profileApiKey.source;

  const profileWebhookKey = profile.webhookSigningKeyEnv
    ? resolveSecretRef(`env:${profile.webhookSigningKeyEnv}`, [])
    : resolveSecretRef(profile.webhookSigningKey, []);
  const envWebhookKey = resolveSecretRef(undefined, ["CLINK_WEBHOOK_SIGNING_KEY", "CLINK_WEBHOOK_SECRET"]);

  return {
    profile: profileName,
    environment,
    baseUrl,
    apiKey,
    apiKeySource,
    dashboard: profile.dashboard,
    dashboardEndpoints,
    webhookSigningKey: profileWebhookKey.secret ?? envWebhookKey.secret,
    webhookSigningKeySource: profileWebhookKey.source ?? envWebhookKey.source,
    apiTimeoutMs: parseApiTimeoutMs(options.timeoutMs ?? process.env.CLINK_API_TIMEOUT_MS),
    dryRun: Boolean(options.dryRun),
    outputMode: options.json ? "json" : "pretty",
  };
}

function parseApiTimeoutMs(value: string | undefined): number {
  if (value === undefined) return 30_000;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("Option --timeout-ms must be a positive integer");
  }
  return parsed;
}

function readEnvironmentFromEnv(): ClinkEnvironment | undefined {
  const raw = process.env.CLINK_ENV?.trim();
  return raw ? raw : undefined;
}

export function normalizeBaseUrl(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}
