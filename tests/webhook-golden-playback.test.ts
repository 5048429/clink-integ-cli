import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { normalizeWebhookEvent, type CanonicalWebhookEvent } from "../src/webhook/normalize.js";
import { signWebhookPayload, verifyWebhookPayload } from "../src/webhook/signature.js";
import { GOLDEN_WEBHOOK_MANIFEST } from "./fixtures/golden-webhooks/manifest.js";
import { GOLDEN_RESOURCE_BODIES, type GoldenWebhookType } from "./fixtures/golden-webhooks/resources.js";

const TEST_SIGNING_KEY = "test_golden_webhook_signing_key";
const FIXED_TIMESTAMP = "1786000000000";
const FIXED_CREATED = 1786000000000;
const KNOWN_TYPES = new Set<GoldenWebhookType>(GOLDEN_WEBHOOK_MANIFEST.resources.map(({ type }) => type));

class LocalWebhookReceiver {
  private server = createServer((request, response) => void this.receive(request, response));
  private seenEventIds = new Set<string>();
  private endpoint = "";

  readonly dispatched: CanonicalWebhookEvent[] = [];
  parseAttempts = 0;

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        this.server.off("error", reject);
        const address = this.server.address() as AddressInfo;
        this.endpoint = `http://127.0.0.1:${address.port}/webhook`;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => error ? reject(error) : resolve());
    });
  }

  reset(): void {
    this.seenEventIds.clear();
    this.dispatched.length = 0;
    this.parseAttempts = 0;
  }

  async deliver(rawBody: string, signature = signWebhookPayload(TEST_SIGNING_KEY, FIXED_TIMESTAMP, rawBody)): Promise<Response> {
    return fetch(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-clink-timestamp": FIXED_TIMESTAMP,
        "x-clink-signature": signature,
      },
      body: rawBody,
    });
  }

  private async receive(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const rawBody = await readRawBody(request);
    const timestamp = request.headers["x-clink-timestamp"];
    const signature = request.headers["x-clink-signature"];

    // Verification deliberately operates on the exact bytes before parsing or normalization.
    if (
      typeof timestamp !== "string"
      || typeof signature !== "string"
      || !verifyWebhookPayload(TEST_SIGNING_KEY, timestamp, rawBody, signature, { nowMs: FIXED_CREATED })
    ) {
      writeJson(response, 401, { ok: false, error: "invalid_signature" });
      return;
    }

    let event: CanonicalWebhookEvent;
    try {
      this.parseAttempts += 1;
      event = normalizeWebhookEvent(JSON.parse(rawBody));
    } catch {
      writeJson(response, 400, { ok: false, error: "invalid_event" });
      return;
    }

    if (!KNOWN_TYPES.has(event.type as GoldenWebhookType)) {
      writeJson(response, 422, { ok: false, error: "unknown_event" });
      return;
    }

    if (this.seenEventIds.has(event.id)) {
      writeJson(response, 200, { ok: true, duplicate: true });
      return;
    }

    this.seenEventIds.add(event.id);
    this.dispatched.push(event);
    writeJson(response, 200, { ok: true, duplicate: false });
  }
}

const receiver = new LocalWebhookReceiver();

beforeAll(() => receiver.start());
beforeEach(() => receiver.reset());
afterAll(() => receiver.stop());

describe("golden merchant webhook playback", () => {
  it("pins the resource-only provenance boundary and exact resource text hashes", () => {
    expect(GOLDEN_WEBHOOK_MANIFEST).toMatchObject({
      scope: "resource-only",
      provenance: {
        resourceTextSourceClaim: "real-webhook-log",
        claimDeclaredBy: "internal-agent",
        independentlyVerified: false,
      },
      localDerived: { envelope: true, signature: true, httpDelivery: true },
    });

    for (const entry of GOLDEN_WEBHOOK_MANIFEST.resources) {
      expect(createHash("sha256").update(GOLDEN_RESOURCE_BODIES[entry.type]).digest("hex")).toBe(entry.sha256);
    }

    expect(GOLDEN_WEBHOOK_MANIFEST.resources.find(({ type }) => type === "subscription.past_due")).toMatchObject({
      restoration: {
        sourceCondition: "polluted-transcript-with-inserted-segment",
        method: "delete-inserted-segment-then-json-stringify",
        indentationSpaces: 2,
        verifiedBy: "sha256-match",
      },
    });
  });

  it("accepts and dispatches all five signed canonical envelopes", async () => {
    for (const [index, entry] of GOLDEN_WEBHOOK_MANIFEST.resources.entries()) {
      const rawBody = fixedCanonicalEnvelope(entry.type, index);
      const response = await receiver.deliver(rawBody);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true, duplicate: false });
    }

    expect(receiver.dispatched.map(({ type }) => type)).toEqual(
      GOLDEN_WEBHOOK_MANIFEST.resources.map(({ type }) => type),
    );
    expect(receiver.dispatched.map(({ data }) => data.object)).toEqual(
      GOLDEN_WEBHOOK_MANIFEST.resources.map(({ type }) => JSON.parse(GOLDEN_RESOURCE_BODIES[type])),
    );
  });

  it("acknowledges a duplicate event id without dispatching it twice", async () => {
    const rawBody = fixedCanonicalEnvelope("order.failed", 0, "event_golden_duplicate");
    const first = await receiver.deliver(rawBody);
    const duplicate = await receiver.deliver(rawBody);

    expect(first.status).toBe(200);
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toEqual({ ok: true, duplicate: true });
    expect(receiver.dispatched).toHaveLength(1);
  });

  it("rejects a tampered body before JSON parsing or normalization", async () => {
    const signedBody = fixedCanonicalEnvelope("order.failed", 0);
    const signature = signWebhookPayload(TEST_SIGNING_KEY, FIXED_TIMESTAMP, signedBody);
    const tamperedBody = signedBody.replace("order_mocked219d5b63", "order_tampered");
    const response = await receiver.deliver(tamperedBody, signature);

    expect(response.status).toBe(401);
    expect(receiver.parseAttempts).toBe(0);
    expect(receiver.dispatched).toHaveLength(0);
  });

  it("returns non-2xx for malformed canonical structure and unknown event types", async () => {
    const malformed = JSON.stringify({
      id: "event_golden_malformed",
      object: "event",
      created: FIXED_CREATED,
      type: "order.failed",
      data: {},
    });
    const unknown = JSON.stringify({
      id: "event_golden_unknown",
      object: "event",
      created: FIXED_CREATED,
      type: "customer.unknown",
      data: { object: {} },
    });

    expect((await receiver.deliver(malformed)).status).toBeGreaterThanOrEqual(400);
    expect((await receiver.deliver(unknown)).status).toBeGreaterThanOrEqual(400);
    expect(receiver.dispatched).toHaveLength(0);
  });
});

function fixedCanonicalEnvelope(type: GoldenWebhookType, index: number, id = `event_golden_${index + 1}`): string {
  return JSON.stringify({
    id,
    object: "event",
    created: FIXED_CREATED + index,
    type,
    data: { object: JSON.parse(GOLDEN_RESOURCE_BODIES[type]) },
  });
}

async function readRawBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}
