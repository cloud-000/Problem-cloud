import type { AIModelCatalog } from "$lib/ai/catalog";
import { HOSTED_PROVIDER_ID, type AIUsage } from "$lib/ai/types";

export const HOSTED_QUOTA_MESSAGE =
    "The free Coach allowance for this period is used up. Add your own key in Settings to keep going.";

export interface HostedUsage {
    credits: number;
    turns: number;
    periodStart: string;
}

export function hostedPeriodStart(period: "month" | "day", now = new Date()): string {
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    if (period === "day") {
        return `${year}-${month}-${String(now.getUTCDate()).padStart(2, "0")}`;
    }
    return `${year}-${month}-01`;
}

export function creditsFromUsage(
    usage: Pick<AIUsage, "inputTokens" | "outputTokens">,
    weights: { inputWeight: number; outputWeight: number },
): number {
    const raw = usage.inputTokens * weights.inputWeight + usage.outputTokens * weights.outputWeight;
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    return Math.ceil(raw);
}

export function hostedQuotaExhausted(
    usage: Pick<HostedUsage, "credits" | "turns">,
    limits: { creditLimit: number; turnLimit: number },
): boolean {
    return usage.credits >= limits.creditLimit || usage.turns >= limits.turnLimit;
}

export function overlayHostedQuota(
    catalog: AIModelCatalog,
    exhausted: boolean,
    message = HOSTED_QUOTA_MESSAGE,
): AIModelCatalog {
    if (!exhausted) return catalog;
    return {
        providers: catalog.providers.map((provider) =>
            provider.id === HOSTED_PROVIDER_ID
                ? { ...provider, connectionState: "quota_exhausted" as const, blockingMessage: message }
                : provider,
        ),
        models: catalog.models.map((model) =>
            model.providerId === HOSTED_PROVIDER_ID
                ? { ...model, available: false, unavailableReason: message }
                : model,
        ),
    };
}
