export interface WebhookRuntimeEvent {
    name: string;
    code?: number | string;
    description?: string;
}
export interface WebhookRuntimeCatalog {
    events: WebhookRuntimeEvent[];
    aliases: Record<string, string[]>;
}
export interface WebhookEventSelection {
    input: string;
    tokens: string[];
    presets: string[];
    presetExpansions: Record<string, string[]>;
    resolvedEvents: string[];
    warnings: string[];
    runtimeCatalogEventCount: number;
}
export interface ResolveWebhookEventOptions {
    allowUnknownEvents?: boolean;
}
export declare const WEBHOOK_CORE_EVENTS: readonly ["session.complete", "order.succeeded", "order.failed", "refund.succeeded", "subscription.created", "invoice.paid"];
export declare const WEBHOOK_CHECKOUT_EVENTS: readonly ["session.complete", "session.expired", "order.created", "order.succeeded", "order.failed", "order.next_action", "refund.created", "refund.succeeded", "refund.failed"];
export declare const WEBHOOK_SUBSCRIPTION_EVENTS: readonly ["subscription.created", "subscription.trialing", "subscription.activated", "subscription.incomplete_expired", "subscription.past_due", "subscription.cancelled", "subscription.updated.plan_changed", "subscription.updated.plan_change_canceled", "subscription.updated.renewed", "subscription.updated.cancel_at_period_end_set", "subscription.updated.cancel_at_period_end_revoked", "invoice.open", "invoice.paid", "invoice.void"];
export declare const WEBHOOK_DISPUTE_EVENTS: readonly ["dispute.created", "dispute.updated", "dispute.won", "dispute.lost", "dispute.closed"];
export declare const WEBHOOK_PAYMENT_METHOD_EVENTS: readonly ["payment_method.added", "payment_method.default_change", "payment_method.update"];
export declare const WEBHOOK_COMMERCE_EVENTS: readonly ["session.complete", "session.expired", "order.created", "order.succeeded", "order.failed", "order.next_action", "refund.created", "refund.succeeded", "refund.failed", "subscription.created", "subscription.trialing", "subscription.activated", "subscription.incomplete_expired", "subscription.past_due", "subscription.cancelled", "subscription.updated.plan_changed", "subscription.updated.plan_change_canceled", "subscription.updated.renewed", "subscription.updated.cancel_at_period_end_set", "subscription.updated.cancel_at_period_end_revoked", "invoice.open", "invoice.paid", "invoice.void", "dispute.created", "dispute.updated", "dispute.won", "dispute.lost", "dispute.closed", "payment_method.added", "payment_method.default_change", "payment_method.update"];
export declare const WEBHOOK_PRESET_NAMES: readonly ["core", "checkout", "subscriptions", "disputes", "payment-methods", "commerce", "all"];
export declare function parseWebhookRuntimeCatalog(result: unknown): WebhookRuntimeCatalog;
export declare function resolveWebhookEventSelection(value: string | undefined, catalog: WebhookRuntimeCatalog, options?: ResolveWebhookEventOptions): WebhookEventSelection;
export declare function describeWebhookPresets(catalog: WebhookRuntimeCatalog): Record<string, string[]>;
