import type { MerchantWebhookEvent } from "./contracts.js";
export type CanonicalWebhookEvent = MerchantWebhookEvent;
export type { MerchantWebhookEvent } from "./contracts.js";
export declare const LEGACY_WEBHOOK_WARNING_CODE = "clink.webhook.legacy_payload";
export interface NormalizeWebhookOptions {
    onLegacy?: (event: {
        id: string;
        type: string;
    }) => void;
}
export declare function normalizeWebhookEvent(payload: unknown, options?: NormalizeWebhookOptions): CanonicalWebhookEvent;
