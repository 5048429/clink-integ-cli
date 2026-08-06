const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const ENCODED_PATH_SEPARATOR = /%(?:2f|5c)/i;
const URL_SCHEME = /^[a-z][a-z\d+.-]*:/i;
const VALIDATED_API_URL = Symbol("validated Clink API URL");
const VALIDATED_API_BASE = Symbol("validated Clink API base");
/**
 * Resolve a caller-supplied API path inside the configured API base URL.
 *
 * API paths are intentionally more restrictive than general URLs. Query
 * parameters must be supplied separately so that every authenticated request
 * remains within the configured origin and API pathname subtree.
 */
export function resolveClinkApiUrl(baseUrl, path, query) {
    const base = parseApiBaseUrl(baseUrl);
    const relativePath = validateApiPath(path);
    const resolved = new URL(relativePath, base);
    if (resolved.origin !== base.origin || !isWithinBasePath(resolved.pathname, base.pathname)) {
        throw invalidApiPath();
    }
    if (resolved.username || resolved.password || resolved.hash || resolved.search) {
        throw invalidApiPath();
    }
    for (const [key, value] of Object.entries(query ?? {})) {
        if (value !== undefined) {
            resolved.searchParams.set(key, String(value));
        }
    }
    return Object.freeze({
        href: resolved.toString(),
        pathname: resolved.pathname,
        [VALIDATED_API_URL]: true,
        [VALIDATED_API_BASE]: apiBaseIdentity(base),
        toString: () => resolved.toString(),
    });
}
export function isValidatedClinkApiUrl(value) {
    return Boolean(value
        && typeof value === "object"
        && VALIDATED_API_URL in value
        && value[VALIDATED_API_URL] === true);
}
export function assertValidatedClinkApiUrlMatchesBase(value, baseUrl) {
    const expectedBase = parseApiBaseUrl(baseUrl);
    let resolved;
    try {
        resolved = new URL(value.href);
    }
    catch {
        throw new Error("Validated Clink API URL does not match the configured API base URL.");
    }
    if (value[VALIDATED_API_BASE] !== apiBaseIdentity(expectedBase)
        || resolved.origin !== expectedBase.origin
        || !isWithinBasePath(resolved.pathname, expectedBase.pathname)
        || resolved.username
        || resolved.password
        || resolved.hash
        || resolved.pathname !== value.pathname) {
        throw new Error("Validated Clink API URL does not match the configured API base URL.");
    }
}
function parseApiBaseUrl(baseUrl) {
    if (!baseUrl || CONTROL_CHARACTER.test(baseUrl) || baseUrl.includes("\\")) {
        throw new Error("Invalid Clink API base URL configuration.");
    }
    let base;
    try {
        base = new URL(baseUrl);
    }
    catch {
        throw new Error("Invalid Clink API base URL configuration.");
    }
    if ((base.protocol !== "https:" && base.protocol !== "http:")
        || !base.hostname
        || base.username
        || base.password
        || base.search
        || base.hash) {
        throw new Error("Invalid Clink API base URL configuration.");
    }
    base.pathname = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
    return base;
}
function validateApiPath(path) {
    if (!path || path !== path.trim()) {
        throw invalidApiPath();
    }
    let decoded = path;
    for (let remaining = path.length + 1; remaining > 0; remaining -= 1) {
        validateDecodedLayer(decoded);
        let next;
        try {
            next = decodeURIComponent(decoded);
        }
        catch {
            throw invalidApiPath();
        }
        if (next === decoded)
            break;
        decoded = next;
        if (remaining === 1) {
            throw invalidApiPath();
        }
    }
    const relative = path.startsWith("/") ? path.slice(1) : path;
    if (!relative || relative.startsWith("/")) {
        throw invalidApiPath();
    }
    return relative;
}
function validateDecodedLayer(value) {
    if (CONTROL_CHARACTER.test(value)
        || value.includes("\\")
        || value.includes("?")
        || value.includes("#")
        || ENCODED_PATH_SEPARATOR.test(value)) {
        throw invalidApiPath();
    }
    const withoutOneLeadingSlash = value.startsWith("/") ? value.slice(1) : value;
    if (withoutOneLeadingSlash.startsWith("/") || URL_SCHEME.test(withoutOneLeadingSlash)) {
        throw invalidApiPath();
    }
    for (const segment of withoutOneLeadingSlash.split("/")) {
        if (segment === "." || segment === "..") {
            throw invalidApiPath();
        }
    }
}
function isWithinBasePath(pathname, basePathname) {
    const baseRoot = basePathname === "/" ? "/" : basePathname.slice(0, -1);
    return pathname === baseRoot || pathname.startsWith(basePathname);
}
function apiBaseIdentity(base) {
    return `${base.origin}${base.pathname}`;
}
function invalidApiPath() {
    return new Error("Invalid Clink API path. Use a relative API path and pass query parameters with --query.");
}
//# sourceMappingURL=url.js.map