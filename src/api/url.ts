type ApiQueryValue = string | number | boolean | undefined;

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const ENCODED_PATH_SEPARATOR = /%(?:2f|5c)/i;
const URL_SCHEME = /^[a-z][a-z\d+.-]*:/i;
const VALIDATED_API_URL = Symbol("validated Clink API URL");
const VALIDATED_API_BASE = Symbol("validated Clink API base");

export interface ValidatedClinkApiUrl {
  readonly href: string;
  readonly pathname: string;
  readonly [VALIDATED_API_URL]: true;
  readonly [VALIDATED_API_BASE]: string;
  toString(): string;
}

/**
 * Resolve a caller-supplied API path inside the configured API base URL.
 *
 * API paths are intentionally more restrictive than general URLs. Query
 * parameters must be supplied separately so that every authenticated request
 * remains within the configured origin and API pathname subtree.
 */
export function resolveClinkApiUrl<TQuery extends object = Record<string, ApiQueryValue>>(
  baseUrl: string,
  path: string,
  query?: TQuery,
): ValidatedClinkApiUrl {
  const base = parseApiBaseUrl(baseUrl);
  const relativePath = validateApiPath(path);
  const resolved = new URL(relativePath, base);

  if (resolved.origin !== base.origin || !isWithinBasePath(resolved.pathname, base.pathname)) {
    throw invalidApiPath();
  }
  if (resolved.username || resolved.password || resolved.hash || resolved.search) {
    throw invalidApiPath();
  }

  for (const [key, value] of Object.entries(query ?? {}) as [string, ApiQueryValue][]) {
    if (value !== undefined) {
      resolved.searchParams.set(key, String(value));
    }
  }

  return Object.freeze({
    href: resolved.toString(),
    pathname: resolved.pathname,
    [VALIDATED_API_URL]: true as const,
    [VALIDATED_API_BASE]: apiBaseIdentity(base),
    toString: () => resolved.toString(),
  });
}

export function isValidatedClinkApiUrl(value: unknown): value is ValidatedClinkApiUrl {
  return Boolean(
    value
    && typeof value === "object"
    && VALIDATED_API_URL in value
    && (value as { [VALIDATED_API_URL]?: unknown })[VALIDATED_API_URL] === true,
  );
}

export function assertValidatedClinkApiUrlMatchesBase(value: ValidatedClinkApiUrl, baseUrl: string): void {
  const expectedBase = parseApiBaseUrl(baseUrl);
  let resolved: URL;
  try {
    resolved = new URL(value.href);
  } catch {
    throw new Error("Validated Clink API URL does not match the configured API base URL.");
  }

  if (
    value[VALIDATED_API_BASE] !== apiBaseIdentity(expectedBase)
    || resolved.origin !== expectedBase.origin
    || !isWithinBasePath(resolved.pathname, expectedBase.pathname)
    || resolved.username
    || resolved.password
    || resolved.hash
    || resolved.pathname !== value.pathname
  ) {
    throw new Error("Validated Clink API URL does not match the configured API base URL.");
  }
}

function parseApiBaseUrl(baseUrl: string): URL {
  if (!baseUrl || CONTROL_CHARACTER.test(baseUrl) || baseUrl.includes("\\")) {
    throw new Error("Invalid Clink API base URL configuration.");
  }

  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new Error("Invalid Clink API base URL configuration.");
  }

  if (
    (base.protocol !== "https:" && base.protocol !== "http:")
    || !base.hostname
    || base.username
    || base.password
    || base.search
    || base.hash
  ) {
    throw new Error("Invalid Clink API base URL configuration.");
  }

  base.pathname = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  return base;
}

function validateApiPath(path: string): string {
  if (!path || path !== path.trim()) {
    throw invalidApiPath();
  }

  let decoded = path;
  for (let remaining = path.length + 1; remaining > 0; remaining -= 1) {
    validateDecodedLayer(decoded);

    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      throw invalidApiPath();
    }
    if (next === decoded) break;
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

function validateDecodedLayer(value: string): void {
  if (
    CONTROL_CHARACTER.test(value)
    || value.includes("\\")
    || value.includes("?")
    || value.includes("#")
    || ENCODED_PATH_SEPARATOR.test(value)
  ) {
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

function isWithinBasePath(pathname: string, basePathname: string): boolean {
  const baseRoot = basePathname === "/" ? "/" : basePathname.slice(0, -1);
  return pathname === baseRoot || pathname.startsWith(basePathname);
}

function apiBaseIdentity(base: URL): string {
  return `${base.origin}${base.pathname}`;
}

function invalidApiPath(): Error {
  return new Error("Invalid Clink API path. Use a relative API path and pass query parameters with --query.");
}
