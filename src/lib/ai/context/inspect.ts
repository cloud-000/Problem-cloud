import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "$lib/types/database.types";
import type { FactRef } from "./facts";
import type { Policy } from "./policy";
import { renderFacts } from "./render";
import { resolveFacts } from "./resolve";
import { buildSystemMessage } from "../prompt";

/**
 * Where a turn's context sits in the request. The two are not interchangeable, and the
 * difference is why a transcript can show system content in order without inventing one:
 * there is exactly **one** system message, at index 0, carrying the current turn's facts,
 * and a past turn's facts are prefixed into that turn's own user message by
 * `toAnyModelMessages` — never re-sent as a second system message.
 */
export type ContextDelivery = "system" | "inlined";

export interface TurnInspection {
    policy: Policy;
    delivery: ContextDelivery;
    factCount: number;
    /**
     * What the provider receives at this position: the whole system message when
     * `delivery` is `"system"`, and the `[Facts active…]` block prefixed onto the user
     * message when it is `"inlined"`. Empty only when an inlined turn carried nothing.
     */
    text: string;
}

export interface TurnInspectionInput {
    refs: FactRef[];
    policy: Policy;
    delivery: ContextDelivery;
    userId?: string;
}

/**
 * What a turn puts in front of the model, assembled by calling the send path's own
 * functions in the send path's own order.
 *
 * Nothing is recorded and nothing is re-implemented, and that is not a shortcut — §3
 * makes the rendered context a pure function of stored refs plus live data, so
 * re-deriving it *is* the ground truth. If this ever disagrees with what the model
 * received, the disagreement is in `#sendDirect`, not here.
 *
 * The one thing §3 does not make re-derivable is the **policy** of a past turn: it is
 * not stored alongside the snapshot, so a replayed turn is inspected under whatever
 * policy the caller supplies. For the live system message that is exact; for history it
 * is an assumption, and the UI says so.
 */
export async function inspectTurn(
    supabase: SupabaseClient<Database>,
    input: TurnInspectionInput,
): Promise<TurnInspection> {
    const { refs, policy, delivery, userId } = input;
    const facts = await resolveFacts(supabase, refs, userId);
    const renderedContext = renderFacts(facts, policy);
    return {
        policy,
        delivery,
        factCount: facts.length,
        // Both strings are built the way the adapter builds them: `buildSystemMessage`
        // for messages[0], and `toAnyModelMessages`' history prefix for a replayed turn.
        text:
            delivery === "system"
                ? buildSystemMessage(renderedContext, policy)
                : renderedContext
                  ? `[Facts active for this historical turn]\n${renderedContext}`
                  : "",
    };
}
