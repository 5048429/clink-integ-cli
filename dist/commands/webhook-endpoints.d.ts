import type { Command } from "commander";
type RegisterWebhookEndpointOptions = {
    legacyDashboardOptions?: boolean;
};
type WebhookEventDiff = {
    added: string[];
    removed: string[];
    unchanged: string[];
};
export declare function registerWebhookEndpointSubcommands(parent: Command, options?: RegisterWebhookEndpointOptions): void;
export declare function diffWebhookEvents(existing: string[], resolved: string[]): WebhookEventDiff;
export declare function upsertEnvValue(raw: string, key: string, value: string): string;
export {};
