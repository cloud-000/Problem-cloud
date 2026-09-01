import { env } from "$env/dynamic/private";
import { PUBLIC_SUPABASE_URL } from "$env/static/public";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AIModelCatalog } from "$lib/ai/catalog";
import {
    hostedAllowanceSnapshot,
    type HostedAllowance,
} from "$lib/ai/hosted-allowance";
import { HOSTED_PROVIDER_ID } from "$lib/ai/types";
import type { Database } from "$lib/types/database.types";
import { hostedProviderEnabled } from "./config";
import { hostedLimits } from "./hosted-plan";
import {
    hostedPeriodStart,
    hostedQuotaExhausted,
    overlayHostedQuota,
    type HostedUsage,
} from "./hosted-quota";
import { AIPersistenceError } from "./persistence";

export {
    creditsFromUsage,
    HOSTED_QUOTA_MESSAGE,
    hostedPeriodStart,
    hostedQuotaExhausted,
    overlayHostedQuota,
    type HostedUsage,
} from "./hosted-quota";

let adminClient: SupabaseClient<Database> | null = null;

function admin(): SupabaseClient<Database> {
    if (adminClient) return adminClient;
    const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_DEV_SECRET_KEY;
    if (!secret) {
        throw new AIPersistenceError(
            "persistence_unavailable",
            "Server-owned AI persistence is not configured",
        );
    }
    adminClient = createClient<Database>(PUBLIC_SUPABASE_URL, secret, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
    return adminClient;
}

export async function hostedUsageFor(userId: string): Promise<HostedUsage> {
    const limits = hostedLimits();
    const periodStart = hostedPeriodStart(limits.period);
    const { data, error } = await admin()
        .from("ai_hosted_usage")
        .select("credits, turns, period_start")
        .eq("user_id", userId)
        .eq("period_start", periodStart)
        .maybeSingle();
    if (error) throw error;
    return {
        credits: data?.credits ?? 0,
        turns: data?.turns ?? 0,
        periodStart: data?.period_start ?? periodStart,
    };
}

export async function reserveAiHostedTurn(userId: string): Promise<{ allowed: boolean } & HostedUsage> {
    const limits = hostedLimits();
    const periodStart = hostedPeriodStart(limits.period);
    const { data, error } = await admin().rpc("reserve_ai_hosted_turn", {
        p_user_id: userId,
        p_period_start: periodStart,
        p_credit_limit: limits.creditLimit,
        p_turn_limit: limits.turnLimit,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
        const current = await hostedUsageFor(userId);
        return { allowed: false, ...current };
    }
    return {
        allowed: true,
        credits: row.credits,
        turns: row.turns,
        periodStart: row.period_start,
    };
}

export async function addAiHostedCredits(userId: string, credits: number): Promise<void> {
    const amount = Math.max(0, Math.floor(credits));
    const limits = hostedLimits();
    const periodStart = hostedPeriodStart(limits.period);
    const { error } = await admin().rpc("add_ai_hosted_credits", {
        p_user_id: userId,
        p_period_start: periodStart,
        p_credits: amount,
    });
    if (error) throw error;
}

export async function catalogWithHostedQuota(
    userId: string,
    catalog: AIModelCatalog,
): Promise<AIModelCatalog> {
    if (!catalog.providers.some((provider) => provider.id === HOSTED_PROVIDER_ID)) return catalog;
    const usage = await hostedUsageFor(userId);
    return overlayHostedQuota(catalog, hostedQuotaExhausted(usage, hostedLimits()));
}

/**
 * Remaining hosted allowance for the profile menu and `/usage`. Null when the
 * first-party connection is off or usage cannot be read — the menu item hides.
 */
export async function hostedAllowanceFor(userId: string): Promise<HostedAllowance | null> {
    if (!hostedProviderEnabled()) return null;
    try {
        const usage = await hostedUsageFor(userId);
        const limits = hostedLimits();
        return hostedAllowanceSnapshot({
            credits: usage.credits,
            turns: usage.turns,
            periodStart: usage.periodStart,
            creditLimit: limits.creditLimit,
            turnLimit: limits.turnLimit,
            period: limits.period,
        });
    } catch {
        return null;
    }
}
