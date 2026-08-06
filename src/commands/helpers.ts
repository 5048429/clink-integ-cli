import type { Command } from "commander";
import { readFile } from "node:fs/promises";
import { ClinkApiClient } from "../api/client.js";
import { resolveClinkApiUrl } from "../api/url.js";
import { resolveRuntimeConfig } from "../config.js";
import type { GlobalOptions, RuntimeConfig } from "../types.js";

export async function getCommandContext(command: Command): Promise<{
  config: RuntimeConfig;
  client: ClinkApiClient;
}> {
  const options = command.optsWithGlobals<GlobalOptions>();
  const config = await resolveRuntimeConfig(options);
  return {
    config,
    client: new ClinkApiClient(config),
  };
}

export function parseMetadata(values: string[] | undefined): Record<string, string> | undefined {
  if (!values || values.length === 0) return undefined;
  const metadata: Record<string, string> = {};

  for (const value of values) {
    const [key, ...rest] = value.split("=");
    if (!key || rest.length === 0) {
      throw new Error(`Invalid metadata "${value}". Use key=value.`);
    }
    metadata[key] = rest.join("=");
  }

  return metadata;
}

export function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

export async function readJsonInput(options: { data?: string; dataFile?: string }): Promise<unknown | undefined> {
  if (options.data && options.dataFile) {
    throw new Error("Use either --data or --data-file, not both");
  }

  if (options.dataFile) {
    return parseJson(await readFile(options.dataFile, "utf8"), `file ${options.dataFile}`);
  }

  if (options.data) {
    return parseJson(options.data, "--data");
  }

  return undefined;
}

export function parseQuery(values: string[] | undefined): Record<string, string | number | boolean> | undefined {
  if (!values || values.length === 0) return undefined;
  const query: Record<string, string | number | boolean> = {};
  for (const value of values) {
    const [key, ...rest] = value.split("=");
    if (!key || rest.length === 0) {
      throw new Error(`Invalid query "${value}". Use key=value.`);
    }
    query[key] = coerceScalar(rest.join("="));
  }
  return query;
}

export function buildUrl(baseUrl: string, path: string, query?: Record<string, string | number | boolean | undefined>): string {
  return resolveClinkApiUrl(baseUrl, path, query).href;
}

function parseJson(raw: string, source: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${source}: ${message}`);
  }
}

function coerceScalar(value: string): string | number | boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value !== "" && /^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}
