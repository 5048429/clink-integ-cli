export declare const WEBHOOK_FIXTURE_PROFILES: readonly ["merchant-webhook", "legacy"];
export type WebhookFixtureProfile = (typeof WEBHOOK_FIXTURE_PROFILES)[number];
export declare const DEFAULT_WEBHOOK_FIXTURE_PROFILE: WebhookFixtureProfile;
export declare const WEBHOOK_FIXTURE_TYPES: readonly ["session.complete", "session.expired", "order.created", "order.succeeded", "order.failed", "refund.succeeded", "subscription.created", "subscription.trialing", "subscription.activated", "subscription.incomplete_expired", "subscription.past_due", "subscription.cancelled", "subscription.updated.plan_changed", "subscription.updated.plan_change_canceled", "subscription.updated.renewed", "subscription.updated.cancel_at_period_end_set", "subscription.updated.cancel_at_period_end_revoked", "invoice.open", "invoice.paid", "invoice.void", "dispute.created"];
export type WebhookFixtureType = (typeof WEBHOOK_FIXTURE_TYPES)[number];
export interface WebhookFixtureOptions {
    profile?: WebhookFixtureProfile;
    overrides?: Record<string, unknown>;
}
export declare function createWebhookFixture(type: string, options?: WebhookFixtureOptions): Record<string, unknown>;
export declare function isDeprecatedWebhookFixtureProfile(profile: WebhookFixtureProfile): boolean;
