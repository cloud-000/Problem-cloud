/**
 * Separates a model's reasoning from its answer at the provider boundary.
 *
 * Three unrelated conventions carry the same thing, and only the first arrives
 * pre-separated:
 *
 *  1. `delta.reasoning_content` — DeepSeek's field, which any-model maps to a
 *     `reasoning-delta` part. Feed those to `reasoning()`.
 *  2. `<think>…</think>` wrapped around the *start of the ordinary content* —
 *     how R1-family weights behave when served by Ollama, vLLM, llama.cpp, or
 *     any endpoint that does not special-case them. Feed content to `answer()`
 *     and this splits it.
 *  3. `delta.reasoning` — OpenRouter's field. any-model 0.1.3 maps this (and
 *     `reasoning_content`) to `reasoning-delta`; the raw-chunk fallback must
 *     not read either field or the trace is counted twice.
 *
 * Case 2 is why this is a state machine rather than a `replace()`. Deltas split
 * anywhere, so `<th` and `ink>` routinely arrive in different chunks: a
 * stateless strip would leak half a tag into the answer, and — because the
 * answer lane is what gets persisted — into stored history. Text that *might*
 * still grow into a tag is therefore held back until it is decided.
 *
 * An opener only counts before any answer text has been emitted. A model that
 * discusses `<think>` mid-sentence is writing prose, not opening a trace, and
 * the reasoning-first shape is the only one these weights actually produce.
 */

export type ReasoningLane = "answer" | "reasoning";

export interface LaneChunk {
    lane: ReasoningLane;
    text: string;
}

const OPENERS = ["<think>", "<thinking>"] as const;
const LONGEST_OPENER = Math.max(...OPENERS.map((tag) => tag.length));

/**
 * A whitespace-only prefix is indistinguishable from the start of an opener, so
 * it has to be held. This bounds that hold: past it, the stream is answering.
 */
const MAX_LEADING_HOLD = 64;

/** How many trailing characters of `text` could still grow into `tag`. */
function partialTailLength(text: string, tag: string): number {
    const max = Math.min(text.length, tag.length - 1);
    for (let size = max; size > 0; size -= 1) {
        if (tag.startsWith(text.slice(text.length - size))) return size;
    }
    return 0;
}

export interface ReasoningDemux {
    /** A chunk of the provider's ordinary content stream. */
    answer(text: string): LaneChunk[];
    /** A chunk the provider already labelled as reasoning. */
    reasoning(text: string): LaneChunk[];
    /** Release anything held back for tag matching. Call once, at end of stream. */
    end(): LaneChunk[];
    /** Whether reasoning was seen at all, from any of the three conventions. */
    readonly sawReasoning: boolean;
}

export function createReasoningDemux(): ReasoningDemux {
    /** `leading` is "no answer text emitted yet", the only state an opener counts in. */
    let state: "leading" | "reasoning" | "answer" = "leading";
    let closer = "";
    let held = "";
    let sawReasoning = false;

    function drain(out: LaneChunk[]): void {
        for (;;) {
            if (state === "answer") {
                if (held) out.push({ lane: "answer", text: held });
                held = "";
                return;
            }

            if (state === "reasoning") {
                const end = held.indexOf(closer);
                if (end === -1) {
                    // Hold only what could still complete the closing tag.
                    const tail = partialTailLength(held, closer);
                    const body = held.slice(0, held.length - tail);
                    if (body) out.push({ lane: "reasoning", text: body });
                    held = held.slice(held.length - tail);
                    return;
                }
                const body = held.slice(0, end);
                if (body) out.push({ lane: "reasoning", text: body });
                held = held.slice(end + closer.length);
                state = "answer";
                continue;
            }

            // leading
            const lead = held.trimStart();
            const opener = OPENERS.find((tag) => lead.startsWith(tag));
            if (opener) {
                sawReasoning = true;
                state = "reasoning";
                closer = `</${opener.slice(1)}`;
                held = lead.slice(opener.length);
                continue;
            }
            // Undecided only while the text so far could still become an opener.
            if (
                lead.length < LONGEST_OPENER &&
                held.length < MAX_LEADING_HOLD &&
                OPENERS.some((tag) => tag.startsWith(lead))
            ) {
                return;
            }
            state = "answer";
        }
    }

    return {
        answer(text: string) {
            if (!text) return [];
            held += text;
            const out: LaneChunk[] = [];
            drain(out);
            return out;
        },
        reasoning(text: string) {
            if (!text) return [];
            sawReasoning = true;
            return [{ lane: "reasoning", text }];
        },
        end() {
            if (!held) return [];
            const out: LaneChunk[] = [];
            // Whatever is still held was never completed into a tag; it belongs to
            // whichever lane was open when the stream stopped.
            out.push({ lane: state === "reasoning" ? "reasoning" : "answer", text: held });
            held = "";
            return out;
        },
        get sawReasoning() {
            return sawReasoning;
        },
    };
}

/**
 * Residual reasoning on a raw chunk that any-model did not already map.
 *
 * any-model 0.1.3 yields `reasoning-delta` for both `delta.reasoning_content`
 * (DeepSeek) and `delta.reasoning` (OpenRouter). Reading either off `raw` is
 * what doubled OpenRouter traces after the bump. Until a provider ships a
 * third convention, raw chunks have nothing left to contribute.
 */
export function reasoningFromRawChunk(_value: unknown): string {
    return "";
}
