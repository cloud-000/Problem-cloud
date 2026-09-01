/**
 * The only onboarding module that talks to Supabase. Failures must never
 * block Home: the caller treats a thrown fetch as "show Home".
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "$lib/types/database.types";
import {
    emptyOnboarding,
    isWelcomeStatus,
    ONBOARDING_CONTENT_VERSION,
    type OnboardingState,
} from "./types";

type Supabase = SupabaseClient<Database>;
type OnboardingRow = Database["public"]["Tables"]["user_onboarding"]["Row"];

/** Rows loaded or written this session — skip doomed INSERTs after the first. */
const knownRows = new Set<string>();

/** @internal Clears the per-session row cache (tests). */
export function resetOnboardingRowCache(): void {
    knownRows.clear();
}

function asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is string => typeof entry === "string");
}

export function mapOnboardingRow(row: OnboardingRow): OnboardingState {
    return {
        contentVersion:
            typeof row.content_version === "number" && row.content_version >= 1
                ? row.content_version
                : ONBOARDING_CONTENT_VERSION,
        welcomeStatus: isWelcomeStatus(row.welcome_status)
            ? row.welcome_status
            : "unseen",
        lastCompletedTourStep:
            typeof row.last_completed_tour_step === "number"
                ? row.last_completed_tour_step
                : null,
        gettingStartedDismissedAt: row.getting_started_dismissed_at,
        acknowledgedTips: asStringArray(row.acknowledged_tips),
        welcomeStartedAt: row.welcome_started_at,
        welcomeCompletedAt: row.welcome_completed_at,
        welcomeDismissedAt: row.welcome_dismissed_at,
    };
}

export async function fetchOnboarding(
    supabase: Supabase,
    userId: string,
): Promise<OnboardingState> {
    const { data, error } = await supabase
        .from("user_onboarding")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
    if (error) throw error;
    if (!data) return emptyOnboarding();
    knownRows.add(userId);
    return mapOnboardingRow(data);
}

/**
 * Whether the student has any persisted Coach thread. A failed lookup is
 * the caller's to soft-fail — never block Home.
 */
export async function fetchHasCoachConversation(
    supabase: Supabase,
): Promise<boolean> {
    const { data, error } = await supabase
        .from("ai_conversations")
        .select("id")
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return data != null;
}

function onboardingPatch(state: OnboardingState) {
    return {
        content_version: state.contentVersion,
        welcome_status: state.welcomeStatus,
        last_completed_tour_step: state.lastCompletedTourStep,
        getting_started_dismissed_at: state.gettingStartedDismissedAt,
        acknowledged_tips: state.acknowledgedTips,
        welcome_started_at: state.welcomeStartedAt,
        welcome_completed_at: state.welcomeCompletedAt,
        welcome_dismissed_at: state.welcomeDismissedAt,
        updated_at: new Date().toISOString(),
    };
}

async function updateOnboardingRow(
    supabase: Supabase,
    userId: string,
    patch: ReturnType<typeof onboardingPatch>,
): Promise<void> {
    const { error } = await supabase
        .from("user_onboarding")
        .update(patch)
        .eq("user_id", userId);
    if (error) throw error;
    knownRows.add(userId);
}

/**
 * Insert, then update on a unique collision. Do not upsert: PostgREST's
 * `ON CONFLICT DO UPDATE` requires UPDATE on every written column, and
 * `user_id` / `created_at` are intentionally not updatable
 * (`user_onboarding.sql`, same pattern as `practice_sessions`).
 *
 * After `fetchOnboarding` or a successful write, later saves update only
 * so tour steps do not spam 409s in the network panel.
 */
export async function saveOnboarding(
    supabase: Supabase,
    userId: string,
    state: OnboardingState,
): Promise<void> {
    const patch = onboardingPatch(state);
    if (knownRows.has(userId)) {
        await updateOnboardingRow(supabase, userId, patch);
        return;
    }
    const inserted = await supabase.from("user_onboarding").insert({
        user_id: userId,
        ...patch,
    });
    if (!inserted.error) {
        knownRows.add(userId);
        return;
    }
    if (inserted.error.code !== "23505") throw inserted.error;
    await updateOnboardingRow(supabase, userId, patch);
}
