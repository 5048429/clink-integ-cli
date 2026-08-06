type ApiQueryValue = string | number | boolean | undefined;
declare const VALIDATED_API_URL: unique symbol;
declare const VALIDATED_API_BASE: unique symbol;
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
export declare function resolveClinkApiUrl<TQuery extends object = Record<string, ApiQueryValue>>(baseUrl: string, path: string, query?: TQuery): ValidatedClinkApiUrl;
export declare function isValidatedClinkApiUrl(value: unknown): value is ValidatedClinkApiUrl;
export declare function assertValidatedClinkApiUrlMatchesBase(value: ValidatedClinkApiUrl, baseUrl: string): void;
export {};
