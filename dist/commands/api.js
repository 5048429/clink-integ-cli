import { resolveClinkApiUrl } from "../api/url.js";
import { curlForJsonRequest } from "../curl.js";
import { printResult } from "../output.js";
import { collect, getCommandContext, parseQuery, readJsonInput } from "./helpers.js";
export function registerApi(program) {
    const api = program
        .command("api")
        .description("Call official Clink API endpoints with CLINK_SECRET_KEY authentication");
    api
        .command("request <method> <path>")
        .description("Call any official Clink API path using X-API-KEY and X-Timestamp")
        .option("--data <json>", "JSON request body")
        .option("--data-file <path>", "Read JSON request body from a file")
        .option("--query <key=value...>", "Query parameter", collect, [])
        .action(async (methodInput, path, options, command) => {
        const { config, client } = await getCommandContext(command);
        const method = parseMethod(methodInput);
        const query = parseQuery(options.query);
        const body = await readJsonInput(options);
        if ((method === "GET" || method === "DELETE") && body !== undefined) {
            throw new Error(`${method} requests cannot include --data or --data-file`);
        }
        const requestUrl = resolveClinkApiUrl(config.baseUrl, path, query);
        const result = await client.request(method, requestUrl, { body });
        printResult({
            method,
            path: requestUrl.pathname,
            result,
            curl: method === "GET" || method === "DELETE"
                ? undefined
                : curlForJsonRequest(method, requestUrl.href, body),
        }, config.outputMode, `Clink API ${method} ${requestUrl.pathname} completed. Use --json to view the full response.`);
    });
}
function parseMethod(value) {
    const method = value.toUpperCase();
    if (method === "GET" || method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") {
        return method;
    }
    throw new Error(`Unsupported API method "${value}". Use GET, POST, PUT, PATCH, or DELETE.`);
}
//# sourceMappingURL=api.js.map