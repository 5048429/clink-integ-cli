import type { Command } from "commander";
export declare function registerSmokeTest(program: Command): void;
export declare function withSmokeReconciliationFields(event: Record<string, unknown>, values: {
    merchantReferenceId: string;
    sessionId?: string;
}): Record<string, unknown>;
