export interface CanonicalWebhookEvent {
    id: string;
    object: "event";
    created: number;
    type: string;
    data: {
        object: Record<string, unknown>;
    };
}
export interface NormalizeWebhookOptions {
    onLegacy?: (event: {
        id: string;
        type: string;
    }) => void;
}
export declare function normalizeWebhookEvent(payload: unknown, options?: NormalizeWebhookOptions): CanonicalWebhookEvent;
