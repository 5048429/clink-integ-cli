import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFrameworkStarter } from "../src/starters.js";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type JavaScriptStarterRuntime = {
  buildCheckoutPayload(input: Record<string, unknown>): Record<string, unknown>;
  buildSubscriptionPayload(input: Record<string, unknown>): Record<string, unknown>;
  clinkApiUrl(path: string): string;
  createCheckoutSession(input: Record<string, unknown>): Promise<unknown>;
  starterHttpError(error: unknown): { status: number; message: string };
  verifyClinkWebhook(secret: string, timestamp: string, rawBody: string, signature: string, nowMs?: number): boolean;
};

const serverEnv = {
  APP_URL: "http://localhost:3000",
  CLINK_BASE_URL: "https://uat-api.clinkbill.com/api/",
  CLINK_SECRET_KEY: "test_secret_key_not_real",
  CLINK_STARTER_ALLOW_QUANTITY: "true",
  CLINK_STARTER_CURRENCY: "EUR",
  CLINK_STARTER_PLAN_KEY: "testPlan",
  CLINK_STARTER_PRICE_ID: "price_server_registered",
  CLINK_STARTER_PRICE_KEY: "testPrice",
  CLINK_STARTER_PRICE_MODE: "inline",
  CLINK_STARTER_PRODUCT_ID: "product_server_registered",
  CLINK_STARTER_PRODUCT_NAME: "Server Catalog Product",
  CLINK_STARTER_SUBSCRIPTION_CURRENCY: "USD",
  CLINK_STARTER_SUBSCRIPTION_PRICE_ID: "price_server_subscription",
  CLINK_STARTER_SUBSCRIPTION_PRODUCT_ID: "product_server_subscription",
  CLINK_STARTER_UNIT_AMOUNT: "12.34",
};

function starterFile(framework: string, relativePath: string): string {
  const file = createFrameworkStarter(framework).files.find((candidate) => candidate.relativePath === relativePath);
  if (!file) throw new Error(`Missing generated ${framework} file: ${relativePath}`);
  return file.content;
}

function loadNextRuntime(fetchImpl: FetchLike): JavaScriptStarterRuntime {
  const source = starterFile("nextjs", "lib/clink.ts");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  const require = createRequire(import.meta.url);
  const evaluate = new Function("require", "module", "exports", "fetch", output);
  evaluate(require, module, module.exports, fetchImpl);
  return module.exports as unknown as JavaScriptStarterRuntime;
}

function loadExpressRuntime(fetchImpl: FetchLike): JavaScriptStarterRuntime {
  const routes = new Map<string, (...args: unknown[]) => unknown>();
  const app = {
    listen: (_port: number, callback: () => void) => callback(),
    post: (path: string, ...handlers: Array<(...args: unknown[]) => unknown>) => routes.set(path, handlers.at(-1)!),
    use: () => undefined,
  };
  const express = Object.assign(() => app, { json: () => undefined, raw: () => undefined });
  const source = starterFile("express", "src/server.js")
    .replace(/^import .*;\r?\n/gm, "")
    .concat("\nglobalThis.__starterExports = { buildCheckoutPayload, buildSubscriptionPayload, clinkApiUrl, createCheckoutSession, starterHttpError, verifyClinkWebhook };\n");
  const context = {
    Buffer,
    URL,
    console: { error: () => undefined, log: () => undefined, warn: () => undefined },
    createHmac,
    express,
    fetch: fetchImpl,
    globalThis: {} as Record<string, unknown>,
    process: { env: process.env },
    randomUUID,
    timingSafeEqual,
  };
  context.globalThis = context as unknown as Record<string, unknown>;
  vm.runInNewContext(source, context, { filename: "generated-express-starter.js" });
  return context.globalThis.__starterExports as JavaScriptStarterRuntime;
}

function sign(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

function plain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

beforeEach(() => {
  for (const [name, value] of Object.entries(serverEnv)) vi.stubEnv(name, value);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("generated starter server price defaults", () => {
  it.each(["nextjs", "express", "fastapi"])("keeps %s registered-price-first and quantity-disabled", (framework) => {
    const env = starterFile(framework, ".env.example");
    expect(env).toContain("CLINK_STARTER_PRICE_KEY=starter-monthly");
    expect(env).toContain("CLINK_STARTER_PRICE_MODE=registered");
    expect(env).toMatch(/^CLINK_STARTER_UNIT_AMOUNT=$/m);
    expect(env).toContain("CLINK_STARTER_ALLOW_QUANTITY=false");
    expect(env).not.toContain("CLINK_STARTER_UNIT_AMOUNT=19.99");
  });
});

describe.each([
  ["Next.js", loadNextRuntime],
  ["Express", loadExpressRuntime],
] as const)("generated %s starter runtime", (_framework, loadRuntime) => {
  it("uses server-owned inline and registered prices and rejects client-controlled checkout fields", () => {
    const runtime = loadRuntime(vi.fn() as unknown as FetchLike);
    const inline = plain(runtime.buildCheckoutPayload({ customerEmail: "buyer@example.com", priceKey: "testPrice", quantity: 2 })) as Record<string, unknown>;
    expect(inline).toMatchObject({
      allowPromotionCodes: false,
      cancelUrl: "http://localhost:3000/cancel",
      customerEmail: "buyer@example.com",
      originalAmount: 24.68,
      originalCurrency: "EUR",
      successUrl: "http://localhost:3000/success",
      uiMode: "hostedPage",
    });
    expect(inline.merchantReferenceId).toMatch(/^starter_checkout_/);
    expect(inline.priceDataList).toEqual([{
      currency: "EUR",
      name: "Server Catalog Product",
      quantity: 2,
      unitAmount: 12.34,
    }]);

    for (const field of [
      "amount", "originalAmount", "currency", "originalCurrency", "unitAmount", "priceDataList", "productId", "priceId", "name", "imageUrl",
      "merchantReferenceId", "successUrl", "cancelUrl", "returnUrl", "redirectUrl", "paymentMethodType", "allowPromotionCodes", "uiMode",
    ]) {
      expect(() => runtime.buildCheckoutPayload({ priceKey: "testPrice", [field]: "attacker-controlled" })).toThrow(/server-controlled/);
    }

    vi.stubEnv("CLINK_STARTER_PRICE_MODE", "registered");
    const registered = plain(runtime.buildCheckoutPayload({ priceKey: "testPrice" })) as Record<string, unknown>;
    expect(registered).toMatchObject({
      originalAmount: 12.34,
      originalCurrency: "EUR",
      priceId: "price_server_registered",
      productId: "product_server_registered",
    });
    expect(registered).not.toHaveProperty("priceDataList");
  });

  it("rejects unknown prices before any Clink request and constrains quantity", async () => {
    const fetchMock = vi.fn();
    const runtime = loadRuntime(fetchMock as unknown as FetchLike);

    let unknownPriceError: unknown;
    try {
      await runtime.createCheckoutSession({ priceKey: "unknown" });
    } catch (error) {
      unknownPriceError = error;
    }
    expect(unknownPriceError).toBeTruthy();
    expect(runtime.starterHttpError(unknownPriceError)).toMatchObject({ status: 400, message: "Unknown checkout priceKey" });
    expect(fetchMock).not.toHaveBeenCalled();

    for (const quantity of [0, -1, 1.5, 11, "2"]) {
      expect(() => runtime.buildCheckoutPayload({ priceKey: "testPrice", quantity })).toThrow(/quantity/);
    }

    vi.stubEnv("CLINK_STARTER_PRICE_MODE", "registered");
    expect(() => runtime.buildCheckoutPayload({ priceKey: "testPrice", quantity: 1 })).toThrow(/does not allow/);
    vi.stubEnv("CLINK_STARTER_PRICE_MODE", "inline");
    vi.stubEnv("CLINK_STARTER_ALLOW_QUANTITY", "false");
    expect(() => runtime.buildCheckoutPayload({ priceKey: "testPrice", quantity: 1 })).toThrow(/does not allow/);
    expect(runtime.starterHttpError(new Error("internal details"))).toEqual({ status: 500, message: "Clink starter request failed" });
  });

  it("maps subscription planKey to server-owned product and price IDs", () => {
    const runtime = loadRuntime(vi.fn() as unknown as FetchLike);
    const payload = plain(runtime.buildSubscriptionPayload({
      customerEmail: "buyer@example.com",
      paymentInstrumentId: "pi_customer_selected",
      planKey: "testPlan",
    })) as Record<string, unknown>;
    expect(payload).toMatchObject({
      customerEmail: "buyer@example.com",
      paymentCurrency: "USD",
      paymentInstrumentId: "pi_customer_selected",
      paymentMethodType: "CARD",
      priceId: "price_server_subscription",
      productId: "product_server_subscription",
      returnUrl: "http://localhost:3000/account",
    });
    expect(payload.merchantReferenceId).toMatch(/^starter_subscription_/);
    expect(() => runtime.buildSubscriptionPayload({ planKey: "unknown" })).toThrow(/Unknown subscription planKey/);
    expect(() => runtime.buildSubscriptionPayload({ planKey: "testPlan", priceId: "price_attacker" })).toThrow(/server-controlled/);
  });

  it("executes strict second/millisecond webhook freshness and raw-body signature checks", () => {
    const runtime = loadRuntime(vi.fn() as unknown as FetchLike);
    const secret = "test_webhook_key_not_real";
    const rawBody = "{\n  \"id\": \"event_test\"\n}";
    const nowMs = 1_700_000_000_000;

    for (const timestamp of [
      String(nowMs), String(nowMs / 1000),
      String(nowMs - 300_000), String(nowMs + 300_000),
      String(nowMs / 1000 - 300), String(nowMs / 1000 + 300),
    ]) {
      expect(runtime.verifyClinkWebhook(secret, timestamp, rawBody, sign(secret, timestamp, rawBody), nowMs)).toBe(true);
    }
    for (const timestamp of [
      String(nowMs - 301_000), String(nowMs + 301_000),
      String(nowMs / 1000 - 301), String(nowMs / 1000 + 301),
    ]) {
      expect(runtime.verifyClinkWebhook(secret, timestamp, rawBody, sign(secret, timestamp, rawBody), nowMs)).toBe(false);
    }
    for (const timestamp of ["", " ", "-1", "+1700000000", "1700000000.0", "1e9", "NaN", "Infinity", "01700000000"]) {
      expect(runtime.verifyClinkWebhook(secret, timestamp, rawBody, sign(secret, timestamp, rawBody), nowMs)).toBe(false);
    }

    const timestamp = String(nowMs);
    const signature = sign(secret, timestamp, rawBody);
    expect(runtime.verifyClinkWebhook(secret, timestamp, rawBody, "bad-signature", nowMs)).toBe(false);
    expect(runtime.verifyClinkWebhook(secret, timestamp, `${rawBody} `, signature, nowMs)).toBe(false);
  });

  it("allows only the starter's internal relative API paths", () => {
    const runtime = loadRuntime(vi.fn() as unknown as FetchLike);
    expect(runtime.clinkApiUrl("/checkout/session")).toBe("https://uat-api.clinkbill.com/api/checkout/session");
    expect(runtime.clinkApiUrl("subscription")).toBe("https://uat-api.clinkbill.com/api/subscription");
    for (const path of ["https://attacker.example/steal", "//attacker.example/steal", "\\\\attacker.example\\steal", "../steal", "/other/path"]) {
      expect(() => runtime.clinkApiUrl(path)).toThrow(/internal relative path|not allowed/);
    }
  });
});

describe("generated FastAPI starter runtime", () => {
  it("executes server-owned checkout/subscription builders and strict webhook verification", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "clink-fastapi-starter-test-"));
    const starterPath = join(tempDir, "main.py");
    writeFileSync(starterPath, starterFile("fastapi", "app/main.py"), "utf8");

    const harness = String.raw`
import asyncio, hashlib, hmac, json, os, sys, types

class FakeApp:
    def post(self, *_args, **_kwargs):
        return lambda function: function

class FakeFastAPI:
    def __new__(cls, *_args, **_kwargs):
        return FakeApp()

class HTTPException(Exception):
    def __init__(self, status_code=500, detail=""):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)

fastapi = types.ModuleType("fastapi")
fastapi.FastAPI = FakeFastAPI
fastapi.Header = lambda default=None, **_kwargs: default
fastapi.HTTPException = HTTPException
fastapi.Request = object
sys.modules["fastapi"] = fastapi
httpx = types.ModuleType("httpx")
httpx.AsyncClient = object
sys.modules["httpx"] = httpx

namespace = {"__name__": "generated_fastapi_starter"}
with open(sys.argv[1], "r", encoding="utf-8") as source_file:
    exec(compile(source_file.read(), sys.argv[1], "exec"), namespace)

inline = namespace["build_checkout_payload"]({"customerEmail": "buyer@example.com", "priceKey": "testPrice", "quantity": 2})
assert inline["originalAmount"] == 24.68
assert inline["originalCurrency"] == "EUR"
assert inline["priceDataList"] == [{"name": "Server Catalog Product", "quantity": 2, "unitAmount": 12.34, "currency": "EUR"}]
assert inline["merchantReferenceId"].startswith("starter_checkout_")
assert inline["successUrl"] == "http://localhost:3000/success"

for field in ["amount", "originalAmount", "currency", "unitAmount", "priceDataList", "productId", "priceId", "name", "imageUrl", "merchantReferenceId", "successUrl", "cancelUrl", "returnUrl", "redirectUrl", "paymentMethodType", "allowPromotionCodes", "uiMode"]:
    try:
        namespace["build_checkout_payload"]({"priceKey": "testPrice", field: "attacker-controlled"})
        raise AssertionError(f"accepted server-controlled field {field}")
    except ValueError as error:
        assert "server-controlled" in str(error)

for quantity in [0, -1, 1.5, 11, "2"]:
    try:
        namespace["build_checkout_payload"]({"priceKey": "testPrice", "quantity": quantity})
        raise AssertionError(f"accepted quantity {quantity!r}")
    except ValueError:
        pass

os.environ["CLINK_STARTER_PRICE_MODE"] = "registered"
registered = namespace["build_checkout_payload"]({"priceKey": "testPrice"})
assert registered["productId"] == "product_server_registered"
assert registered["priceId"] == "price_server_registered"
assert registered["originalAmount"] == 12.34
assert "priceDataList" not in registered
os.environ["CLINK_STARTER_PRICE_MODE"] = "inline"
os.environ["CLINK_STARTER_ALLOW_QUANTITY"] = "false"
try:
    namespace["build_checkout_payload"]({"priceKey": "testPrice", "quantity": 1})
    raise AssertionError("accepted quantity without explicit server allow")
except namespace["StarterRequestError"]:
    pass
os.environ["CLINK_STARTER_ALLOW_QUANTITY"] = "true"

calls = []
async def fake_post(path, body):
    calls.append((path, body))
try:
    namespace["post_clink"] = fake_post
    asyncio.run(namespace["create_checkout_session"]({"priceKey": "unknown"}))
    raise AssertionError("accepted unknown priceKey")
except HTTPException as error:
    assert error.status_code == 400
    assert "Unknown checkout priceKey" in str(error)
assert calls == []

subscription = namespace["build_subscription_payload"]({"customerEmail": "buyer@example.com", "planKey": "testPlan", "paymentInstrumentId": "pi_customer_selected"})
assert subscription["productId"] == "product_server_subscription"
assert subscription["priceId"] == "price_server_subscription"
assert subscription["merchantReferenceId"].startswith("starter_subscription_")
try:
    namespace["build_subscription_payload"]({"planKey": "testPlan", "priceId": "price_attacker"})
    raise AssertionError("accepted client priceId")
except ValueError as error:
    assert "server-controlled" in str(error)

secret = "test_webhook_key_not_real"
raw_body = b'{\n  "id": "event_test"\n}'
now_ms = 1_700_000_000_000
def sign(timestamp):
    return hmac.new(secret.encode(), timestamp.encode() + b"." + raw_body, hashlib.sha256).hexdigest()
for timestamp in [str(now_ms), str(now_ms // 1000), str(now_ms - 300_000), str(now_ms + 300_000), str(now_ms // 1000 - 300), str(now_ms // 1000 + 300)]:
    assert namespace["verify_clink_webhook"](secret, timestamp, raw_body, sign(timestamp), now_ms)
for timestamp in [str(now_ms - 301_000), str(now_ms + 301_000), str(now_ms // 1000 - 301), str(now_ms // 1000 + 301), "", " ", "-1", "+1700000000", "1700000000.0", "1e9", "NaN", "Infinity", "01700000000"]:
    assert not namespace["verify_clink_webhook"](secret, timestamp, raw_body, sign(timestamp), now_ms)
timestamp = str(now_ms)
assert not namespace["verify_clink_webhook"](secret, timestamp, raw_body, "bad-signature", now_ms)
assert not namespace["verify_clink_webhook"](secret, timestamp, raw_body + b" ", sign(timestamp), now_ms)

assert namespace["clink_api_url"]("/checkout/session") == "https://uat-api.clinkbill.com/api/checkout/session"
for path in ["https://attacker.example/steal", "//attacker.example/steal", "\\\\attacker.example\\steal", "../steal", "/other/path"]:
    try:
        namespace["clink_api_url"](path)
        raise AssertionError(f"accepted unsafe path {path}")
    except ValueError:
        pass

print(json.dumps({"ok": True}))
`;

    try {
      const result = spawnSync("python", ["-c", harness, starterPath], {
        encoding: "utf8",
        env: { ...process.env, ...serverEnv },
      });
      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ ok: true });
    } finally {
      rmSync(tempDir, { force: true, recursive: true });
    }
  });
});
