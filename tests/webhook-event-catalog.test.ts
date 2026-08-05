import { describe, expect, it } from "vitest";
import {
  WEBHOOK_COMMERCE_EVENTS,
  WEBHOOK_CORE_EVENTS,
  WEBHOOK_SUBSCRIPTION_EVENTS,
  parseWebhookRuntimeCatalog,
  resolveWebhookEventSelection,
} from "../src/webhook/event-catalog.js";
import { CURRENT_44_WEBHOOK_EVENTS } from "./fixtures/webhook-runtime.js";

function runtimeCatalog(events: readonly string[] = CURRENT_44_WEBHOOK_EVENTS) {
  return parseWebhookRuntimeCatalog({
    code: 200,
    data: {
      events: events.map((name, index) => ({ name, code: index + 1 })),
      aliases: {
        server_checkout: ["session.complete", "order.succeeded"],
      },
    },
  });
}

describe("runtime webhook event presets", () => {
  it("keeps core at exactly the six compatibility events and emits the coverage warning", () => {
    const selection = resolveWebhookEventSelection("core", runtimeCatalog());
    expect(selection.resolvedEvents).toEqual([...WEBHOOK_CORE_EVENTS]);
    expect(selection.resolvedEvents).toHaveLength(6);
    expect(selection.presetExpansions.core).toEqual([...WEBHOOK_CORE_EVENTS]);
    expect(selection.warnings.join(" ")).toMatch(/does not cover the complete subscription lifecycle/i);
    expect(selection.warnings.join(" ")).toMatch(/refund\.failed/);
    expect(selection.warnings.join(" ")).toMatch(/session\.expired/);
  });

  it("expands the required presets to 9, 14, 5, 3, and 31 events", () => {
    expect(resolveWebhookEventSelection("checkout", runtimeCatalog()).resolvedEvents).toHaveLength(9);
    expect(resolveWebhookEventSelection("subscriptions", runtimeCatalog()).resolvedEvents).toEqual([...WEBHOOK_SUBSCRIPTION_EVENTS]);
    expect(resolveWebhookEventSelection("disputes", runtimeCatalog()).resolvedEvents).toHaveLength(5);
    expect(resolveWebhookEventSelection("payment-methods", runtimeCatalog()).resolvedEvents).toHaveLength(3);
    expect(resolveWebhookEventSelection("commerce", runtimeCatalog()).resolvedEvents).toEqual([...WEBHOOK_COMMERCE_EVENTS]);
    expect(WEBHOOK_COMMERCE_EVENTS).toHaveLength(31);
  });

  it("combines presets and removes duplicates", () => {
    const selection = resolveWebhookEventSelection(
      "checkout,subscriptions,disputes,payment-methods,checkout",
      runtimeCatalog(),
    );
    expect(selection.resolvedEvents).toHaveLength(31);
    expect(new Set(selection.resolvedEvents).size).toBe(31);
  });

  it("uses runtime aliases and all events from GET /webhook/events", () => {
    expect(resolveWebhookEventSelection("server_checkout", runtimeCatalog()).resolvedEvents).toEqual([
      "session.complete",
      "order.succeeded",
    ]);
    expect(resolveWebhookEventSelection("all", runtimeCatalog()).resolvedEvents).toEqual(CURRENT_44_WEBHOOK_EVENTS);
  });

  it("fails rather than silently trimming a preset missing from the runtime catalog", () => {
    const events = CURRENT_44_WEBHOOK_EVENTS.filter((event) => event !== "invoice.void");
    expect(() => resolveWebhookEventSelection("subscriptions", runtimeCatalog(events))).toThrow(/invoice\.void/);
  });

  it("keeps stable presets at 3/31 when payment_method.deleted appears while explicit/all remain runtime-driven", () => {
    expect(resolveWebhookEventSelection("commerce", runtimeCatalog()).resolvedEvents).not.toContain("payment_method.deleted");

    const withDeleted = runtimeCatalog([...CURRENT_44_WEBHOOK_EVENTS, "payment_method.deleted"]);
    expect(resolveWebhookEventSelection("payment-methods", withDeleted).resolvedEvents).toHaveLength(3);
    expect(resolveWebhookEventSelection("commerce", withDeleted).resolvedEvents).toEqual([...WEBHOOK_COMMERCE_EVENTS]);
    expect(resolveWebhookEventSelection("payment_method.deleted", withDeleted).resolvedEvents).toEqual(["payment_method.deleted"]);
    expect(resolveWebhookEventSelection("all", withDeleted).resolvedEvents).toContain("payment_method.deleted");
  });

  it("automatically includes newly published runtime events in all without changing stable presets", () => {
    const withFutureEvent = runtimeCatalog([...CURRENT_44_WEBHOOK_EVENTS, "server.new_event"]);
    expect(resolveWebhookEventSelection("all", withFutureEvent).resolvedEvents).toHaveLength(45);
    expect(resolveWebhookEventSelection("all", withFutureEvent).resolvedEvents).toContain("server.new_event");
    expect(resolveWebhookEventSelection("commerce", withFutureEvent).resolvedEvents).toEqual([...WEBHOOK_COMMERCE_EVENTS]);
  });

  it("does not let deprecated --allow-unknown-events bypass runtime validation", () => {
    expect(() => resolveWebhookEventSelection("payment_method.deleted", runtimeCatalog(), { allowUnknownEvents: true }))
      .toThrow(/runtime GET \/webhook\/events catalog/);
  });
});
