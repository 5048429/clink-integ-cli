import { describe, expect, it } from "vitest";
import { createFrameworkStarter } from "../src/starters.js";

function starterFile(framework: string, relativePath: string): string {
  const file = createFrameworkStarter(framework).files.find((candidate) => candidate.relativePath === relativePath);
  if (!file) throw new Error(`Missing generated ${framework} file: ${relativePath}`);
  return file.content;
}

describe("generated webhook handlers", () => {
  it("keeps Next.js raw-body verification before parsing and normalization", () => {
    const route = starterFile("nextjs", "app/api/clink/webhook/route.ts");
    expect(route.indexOf("verifyClinkWebhook(secret, timestamp, rawBody, signature)")).toBeGreaterThan(-1);
    expect(route.indexOf("JSON.parse(rawBody)")).toBeGreaterThan(route.indexOf("verifyClinkWebhook(secret, timestamp, rawBody, signature)"));
    expect(route.indexOf("normalizeClinkWebhook")).toBeLessThan(route.indexOf("dispatchClinkWebhookEvent(event)"));
  });

  it("keeps Express raw-body verification before parsing and rejects unknown events", () => {
    const server = starterFile("express", "src/server.js");
    const verifyCall = server.indexOf("verifyClinkWebhook(requireEnv(\"CLINK_WEBHOOK_SIGNING_KEY\"), timestamp, rawBody, signature)");
    expect(verifyCall).toBeGreaterThan(-1);
    expect(server.indexOf("normalizeClinkWebhook(JSON.parse(rawBody))")).toBeGreaterThan(verifyCall);
    expect(server).toContain("clink_webhook_unknown_event");
    expect(server).toContain("throw new Error(`Unsupported Clink webhook event type:");
  });

  it("keeps FastAPI byte verification before JSON parsing and normalization", () => {
    const main = starterFile("fastapi", "app/main.py");
    const verifyCall = main.indexOf("if not verify_clink_webhook(");
    expect(verifyCall).toBeGreaterThan(-1);
    expect(main.indexOf("event = json.loads(raw_body)")).toBeGreaterThan(verifyCall);
    expect(main.indexOf("event = normalize_clink_webhook(event)")).toBeGreaterThan(main.indexOf("event = json.loads(raw_body)"));
    expect(main).toContain("clink_webhook_unknown_event");
  });

  it("normalizes legacy lineItems after verification and emits safe warning identity fields", () => {
    for (const [framework, relativePath] of [
      ["nextjs", "lib/clink.ts"],
      ["express", "src/server.js"],
      ["fastapi", "app/main.py"],
    ]) {
      const content = starterFile(framework, relativePath);
      expect(content).toContain("lineItems");
      expect(content).toContain("clink_webhook_legacy_payload_total");
      expect(content).toContain("eventId");
      expect(content).toContain("eventType");
      expect(content).not.toContain("CLINK_WEBHOOK_SIGNING_KEY, \"eventId\"");
    }
  });

  it("documents non-2xx retry and durable Inbox expectations", () => {
    for (const framework of ["generic", "nextjs", "express", "fastapi"]) {
      const readme = starterFile(framework, "README.md");
      expect(readme).toMatch(/Unrecognized payloads and event types throw and return non-2xx/);
      expect(readme).toMatch(/durable webhook Inbox/);
      expect(readme).toMatch(/300-second webhook timestamp window/);
      expect(readme).toMatch(/Persist every `event.id`/);
    }
  });

  it("does not expose verification secrets or payload-derived errors", () => {
    const nextRoute = starterFile("nextjs", "app/api/clink/webhook/route.ts");
    const expressServer = starterFile("express", "src/server.js");
    const fastapiMain = starterFile("fastapi", "app/main.py");
    for (const content of [nextRoute, expressServer, fastapiMain]) {
      expect(content).toContain("Webhook processing failed");
      expect(content).not.toContain("expectedSignature");
    }
    expect(nextRoute).not.toContain("errorMessage(error)");
  });
});
