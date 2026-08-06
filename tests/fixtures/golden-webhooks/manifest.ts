import type { GoldenWebhookType } from "./resources.js";

type GoldenResourceEntry = {
  type: GoldenWebhookType;
  sha256: string;
  captureTime: string;
  backendDeploymentLabel: string;
  sourceKind: "sandbox-delivery-log" | "sandbox-outbox-log";
  restoration?: {
    sourceCondition: "polluted-transcript-with-inserted-segment";
    method: "delete-inserted-segment-then-json-stringify";
    indentationSpaces: 2;
    verifiedBy: "sha256-match";
  };
};

/** Provenance boundary for the golden resource text and locally derived playback data. */
export const GOLDEN_WEBHOOK_MANIFEST = {
  version: 1,
  scope: "resource-only",
  provenance: {
    resourceTextSourceClaim: "real-webhook-log",
    claimDeclaredBy: "internal-agent",
    independentlyVerified: false,
  },
  localDerived: {
    envelope: true,
    signature: true,
    httpDelivery: true,
  },
  approval: {
    substitutePlaybackApproved: true,
    realClinkToEndpointE2EWaived: true,
  },
  resources: [
    {
      type: "order.failed",
      sha256: "559dc889e779b47b995693db03632e8bf648d4a3f8ab2535977f847a7f584842",
      captureTime: "2026-08-05T13:21:54.496Z",
      backendDeploymentLabel: "clink-log-fusion-uat",
      sourceKind: "sandbox-delivery-log",
    },
    {
      type: "refund.succeeded",
      sha256: "5bce3752611016bbad3687626bb985c12e5afdacea9bb6d9262db7e1129d2915",
      captureTime: "2026-08-05T09:21:46.505Z",
      backendDeploymentLabel: "clink-event-hub-uat",
      sourceKind: "sandbox-outbox-log",
    },
    {
      type: "subscription.past_due",
      sha256: "bfea582a4eb8515ca72d39e04659ba6ce3ef449f962e277e4b2c9680ae49b3da",
      captureTime: "2026-08-04T13:07:27.361Z",
      backendDeploymentLabel: "clink-log-fusion-uat",
      sourceKind: "sandbox-delivery-log",
      restoration: {
        sourceCondition: "polluted-transcript-with-inserted-segment",
        method: "delete-inserted-segment-then-json-stringify",
        indentationSpaces: 2,
        verifiedBy: "sha256-match",
      },
    },
    {
      type: "invoice.void",
      sha256: "3f85c4ca9c49baa58f6443af78aecc8f5c3e84d4da445f22cb9b0a4994d3b738",
      captureTime: "2026-08-05T12:40:25.414Z",
      backendDeploymentLabel: "clink-log-fusion-uat",
      sourceKind: "sandbox-delivery-log",
    },
    {
      type: "dispute.created",
      sha256: "d848e9c607aad79814fac8e862ea389cf58f6bfbba5e5bd0cd3669c21fb0096a",
      captureTime: "2026-08-05T12:41:30.197Z",
      backendDeploymentLabel: "clink-log-fusion-uat",
      sourceKind: "sandbox-delivery-log",
    },
  ] satisfies readonly GoldenResourceEntry[],
} as const;
