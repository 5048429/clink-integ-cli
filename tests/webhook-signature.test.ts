import { describe, expect, it } from "vitest";
import { signWebhookPayload, verifyWebhookPayload } from "../src/webhook/signature.js";

describe("webhook signing and verification", () => {
  it("signs the timestamp and raw body with HMAC SHA-256", () => {
    const rawBody = "{\"id\":\"evt_test\"}";
    const signature = signWebhookPayload("test_webhook_signing_key", "1700000000000", rawBody);

    expect(signature).toBe("e07064a60193e751786c3f5a37fe7a5dc816bba53a2cb7781d0246b035dddfda");
  });

  it("verifies matching signatures and rejects mismatches", () => {
    const secret = "test_webhook_signing_key";
    const timestamp = "1700000000000";
    const rawBody = "{\"id\":\"evt_test\"}";
    const signature = signWebhookPayload(secret, timestamp, rawBody);

    expect(verifyWebhookPayload(secret, timestamp, rawBody, signature, { nowMs: 1700000000000 })).toBe(true);
    expect(verifyWebhookPayload(secret, timestamp, "{\"id\":\"evt_tampered\"}", signature, { nowMs: 1700000000000 })).toBe(false);
    expect(verifyWebhookPayload("wrong_webhook_signing_key", timestamp, rawBody, signature, { nowMs: 1700000000000 })).toBe(false);
    expect(verifyWebhookPayload(secret, "1700000000001", rawBody, signature, { nowMs: 1700000000001 })).toBe(false);
    expect(verifyWebhookPayload(secret, timestamp, rawBody, signature, { nowMs: 1700000601000 })).toBe(false);
  });

  it("does not accept a parsed and re-serialized body in place of the exact raw body", () => {
    const secret = "test_webhook_signing_key";
    const timestamp = "1700000000000";
    const rawBody = "{\n  \"id\": \"event_test\", \"object\": \"event\"\n}";
    const signature = signWebhookPayload(secret, timestamp, rawBody);
    const reserialized = JSON.stringify(JSON.parse(rawBody));

    expect(reserialized).not.toBe(rawBody);
    expect(verifyWebhookPayload(secret, timestamp, reserialized, signature, { nowMs: 1700000000000 })).toBe(false);
  });
});
