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
 * there is exactly **one** stable system message at index 0. Dynamic context is prefixed
 * into a user message only at a scope boundary by the context-frame compiler.
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
        // The system message is deliberately context-free. The inlined view shows the
        // raw frame material before epoch deduplication by `compileContextFrames`.
        text:
            delivery === "system"
                ? buildSystemMessage(policy)
                : renderedContext
                  ? `[Application context]\n${renderedContext}`
                  : "",
    };
}
