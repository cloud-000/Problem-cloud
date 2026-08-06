import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "$lib/types/database.types";
import type { ContextSnapshot, FactRef } from "./facts";
import type { NormalizedAIMessage } from "../types";
import type { Policy } from "./policy";
import { renderFacts } from "./render";
import { compileContextFrames, resolveFacts } from "./resolve";
import { applicationContextFrame, buildSystemMessage } from "../prompt";

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
    /** False when transcript bounding excludes this historical turn entirely. */
    included: boolean;
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
 * Historical payloads use `inspectCompiledMessageContext` below because only the full
 * transcript can determine epoch suppression, truncation, and history bounding.
 */
export async function inspectTurn(
    supabase: SupabaseClient<Database>,
    input: TurnInspectionInput,
): Promise<TurnInspection> {
    const { refs, policy, delivery } = input;
    const facts = await resolveFacts(supabase, refs);
    const renderedContext = renderFacts(facts);
    return {
        policy,
        delivery,
        included: true,
        factCount: facts.length,
        // The system message is deliberately context-free. The inlined view shows the
        // raw frame material before epoch deduplication by `compileContextFrames`.
        text:
            delivery === "system"
                ? buildSystemMessage(policy)
                : renderedContext
                  ? applicationContextFrame(renderedContext)
                  : "",
    };
}

export interface CompiledMessageInspectionInput {
    messages: NormalizedAIMessage[];
    current: ContextSnapshot;
    messageId: string;
}

/** The exact context frame a historical turn contributes to the next provider request. */
export async function inspectCompiledMessageContext(
    supabase: SupabaseClient<Database>,
    input: CompiledMessageInspectionInput,
): Promise<TurnInspection | null> {
    const original = input.messages.find((message) => message.id === input.messageId);
    if (!original) return null;

    const snapshot = original.contextSnapshot;
    const compiled = await compileContextFrames(supabase, input.messages, input.current);
    const providerMessage = compiled.history.find((message) => message.id === input.messageId);
    return {
        policy: snapshot?.policy ?? "assist",
        delivery: "inlined",
        included: providerMessage !== undefined,
        factCount: snapshot ? snapshot.scope.length + snapshot.attachments.length : 0,
        text: applicationContextFrame(providerMessage?.renderedContext ?? ""),
    };
}
