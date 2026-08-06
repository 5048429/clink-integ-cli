import { readFile } from "node:fs/promises";
import { ClinkApiClient } from "../api/client.js";
import { resolveClinkApiUrl } from "../api/url.js";
import { resolveRuntimeConfig } from "../config.js";
export async function getCommandContext(command) {
    const options = command.optsWithGlobals();
    const config = await resolveRuntimeConfig(options);
    return {
        config,
        client: new ClinkApiClient(config),
    };
}
export function parseMetadata(values) {
    if (!values || values.length === 0)
        return undefined;
    const metadata = {};
    for (const value of values) {
        const [key, ...rest] = value.split("=");
        if (!key || rest.length === 0) {
            throw new Error(`Invalid metadata "${value}". Use key=value.`);
        }
        metadata[key] = rest.join("=");
    }
    return metadata;
}
export function collect(value, previous) {
    previous.push(value);
    return previous;
}
export async function readJsonInput(options) {
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
export function parseQuery(values) {
    if (!values || values.length === 0)
        return undefined;
    const query = {};
    for (const value of values) {
        const [key, ...rest] = value.split("=");
        if (!key || rest.length === 0) {
            throw new Error(`Invalid query "${value}". Use key=value.`);
        }
        query[key] = coerceScalar(rest.join("="));
    }
    return query;
}
export function buildUrl(baseUrl, path, query) {
    return resolveClinkApiUrl(baseUrl, path, query).href;
}
function parseJson(raw, source) {
    try {
        return JSON.parse(raw);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid JSON in ${source}: ${message}`);
    }
}
function coerceScalar(value) {
    if (value === "true")
        return true;
    if (value === "false")
        return false;
    if (value !== "" && /^-?\d+(\.\d+)?$/.test(value))
        return Number(value);
    return value;
}
//# sourceMappingURL=helpers.js.map