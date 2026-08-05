import type { RuntimeConfig } from "../types.js";
type QueryValue = string | number | boolean | undefined;
export interface RequestOptions<TBody = unknown, TQuery extends object = Record<string, QueryValue>> {
    query?: TQuery;
    body?: TBody;
    multipart?: FormData;
    /** Execute a read-only GET even when the command uses --dry-run. */
    executeInDryRun?: boolean;
}
export declare class ClinkApiClient {
    private readonly config;
    constructor(config: RuntimeConfig);
    delete<T = unknown, TQuery extends object = Record<string, QueryValue>>(path: string, options?: RequestOptions<never, TQuery>): Promise<T>;
    get<T = unknown, TQuery extends object = Record<string, QueryValue>>(path: string, options?: RequestOptions<never, TQuery>): Promise<T>;
    post<T = unknown, TBody = unknown, TQuery extends object = Record<string, QueryValue>>(path: string, options?: RequestOptions<TBody, TQuery>): Promise<T>;
    patch<T = unknown, TBody = unknown, TQuery extends object = Record<string, QueryValue>>(path: string, options?: RequestOptions<TBody, TQuery>): Promise<T>;
    put<T = unknown, TBody = unknown, TQuery extends object = Record<string, QueryValue>>(path: string, options?: RequestOptions<TBody, TQuery>): Promise<T>;
    request<T = unknown, TBody = unknown, TQuery extends object = Record<string, QueryValue>>(method: string, path: string, options?: RequestOptions<TBody, TQuery>): Promise<T>;
}
export declare function createImageUploadForm(filePath: string): Promise<FormData>;
export {};
