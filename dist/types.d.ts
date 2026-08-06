export type BuiltInEnvironment = "sandbox" | "production";
export type ClinkEnvironment = BuiltInEnvironment | (string & {});
export type OutputMode = "pretty" | "json";
export interface EnvironmentDefinition {
    apiBaseUrl: string;
    dashboardBaseUrl?: string;
    dashboardLoginUrl?: string;
    dashboardClientId?: string;
}
export interface DashboardEndpoints {
    baseUrl: string;
    loginUrl: string;
    clientId: string;
}
export interface GlobalOptions {
    json?: boolean;
    profile?: string;
    env?: ClinkEnvironment;
    baseUrl?: string;
    apiKey?: string;
    timeoutMs?: string;
    dryRun?: boolean;
}
export interface RuntimeConfig {
    profile: string;
    environment: ClinkEnvironment;
    baseUrl: string;
    apiKey?: string;
    apiKeySource?: string;
    dashboard?: DashboardConsoleProfile;
    dashboardEndpoints: DashboardEndpoints;
    webhookSigningKey?: string;
    webhookSigningKeySource?: string;
    apiTimeoutMs: number;
    dryRun: boolean;
    outputMode: OutputMode;
}
export interface DashboardUserSummary {
    userId?: string;
    username?: string;
    realName?: string;
    email?: string;
    roles?: string[];
    roleTypes?: string[];
    permissions?: string[];
}
export interface DashboardConsoleProfile {
    baseUrl: string;
    loginUrl?: string;
    clientId: string;
    accessToken: string;
    tokenSource?: string;
    savedAt: string;
    user?: DashboardUserSummary;
}
export interface StoredProfile {
    environment?: ClinkEnvironment;
    baseUrl?: string;
    apiKey?: string;
    apiKeyEnv?: string;
    dashboard?: DashboardConsoleProfile;
    webhookSigningKey?: string;
    webhookSigningKeyEnv?: string;
}
export interface StoredConfig {
    defaultProfile?: string;
    profiles: Record<string, StoredProfile>;
    environments?: Record<string, EnvironmentDefinition>;
}
