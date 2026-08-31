/**
 * Fire-and-forget tip writes. Layout configures the client once; gesture
 * sites (Coach send, practice settings, whiteboard persist) must not thread
 * Supabase through their stores.
 *
 * A failed write is swallowed: acknowledgement is best-effort, never a
 * failed send or a blocked persist.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "$lib/types/database.types";
import { fetchOnboarding, saveOnboarding } from "./data";
import {
    GETTING_STARTED_TIP,
    isWhiteboardOnboardingKey,
    type OnboardingTipId,
    withAcknowledgedTip,
} from "./tips";
import { emptyOnboarding } from "./types";

type Supabase = SupabaseClient<Database>;

type Writer = { supabase: Supabase; userId: string };

let writer: Writer | null = null;
const pending = new Set<OnboardingTipId>();
let chain: Promise<void> = Promise.resolve();

export function configureOnboardingAck(
    supabase: Supabase,
    userId: string | null,
): void {
    writer = userId ? { supabase, userId } : null;
}

export function acknowledgeTip(tipId: OnboardingTipId): void {
    const current = writer;
    if (!current) return;
    pending.add(tipId);
    chain = chain.then(() => flushTips(current)).catch(() => undefined);
}

async function flushTips(current: Writer): Promise<void> {
    if (pending.size === 0) return;
    const ids = [...pending] as OnboardingTipId[];
    pending.clear();
    const state = await fetchOnboarding(current.supabase, current.userId).catch(
        () => emptyOnboarding(),
    );
    let tips = state.acknowledgedTips;
    let changed = false;
    for (const id of ids) {
        const next = withAcknowledgedTip(tips, id);
        if (next.length !== tips.length) {
            tips = next;
            changed = true;
        }
    }
    if (!changed) return;
    await saveOnboarding(current.supabase, current.userId, {
        ...state,
        acknowledgedTips: tips,
    });
}

/** First send of any Coach thread, including a one-shot. */
export function acknowledgeCoachSend(): void {
    acknowledgeTip(GETTING_STARTED_TIP.coach);
}

/** Opening the trainer's practice-settings utility panel. */
export function acknowledgePracticeSettingsOpen(): void {
    acknowledgeTip(GETTING_STARTED_TIP.practiceSettings);
}

/** First non-empty persist of the scratch board or standalone page. */
export function acknowledgeWhiteboardPersist(key: string, itemCount: number): void {
    if (!isWhiteboardOnboardingKey(key) || itemCount <= 0) return;
    acknowledgeTip(GETTING_STARTED_TIP.whiteboard);
}
