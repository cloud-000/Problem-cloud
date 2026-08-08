import type { AIChatQuickAction } from "$lib/components/ai-chat";

/**
 * One rung of the hint ladder.
 *
 * Hints escalate in *depth*, not in kind: each rung reveals strictly more than the
 * one below it, and the student climbs one step at a time. That ordering is the whole
 * point — a student who can be unstuck by "look at the parity here" should never be
 * handed a walkthrough because both were one click away.
 */
export interface HintRung {
    readonly id: string;
    /** Name of the rung itself, for the ladder rail where all four are visible at once. */
    readonly label: string;
    /**
     * How the *next* step reads when the ladder is presented as a single escalating
     * button (the Coach's chip row), where the student sees one action rather than four.
     */
    readonly escalatingLabel: string;
    /** One line explaining what this rung gives, for the rail's tooltip. */
    readonly description: string;
    /** What is actually sent to the model. */
    readonly prompt: string;
    /** Material Symbols name — must be in `app.html`'s `icon_names=` subset. */
    readonly icon: string;
}

/**
 * The ladder, shallowest first.
 *
 * The prompts do the enforcing. A BYOK model may be small, local, or uncensored, so
 * asking it to hold back is a request and not a guarantee — the only *structural*
 * control is what the request contains, which is why the answer key is withheld under
 * `test-locked` rather than merely embargoed in prose (see `$lib/ai/prompt.ts`). Within
 * a coaching policy the model has the answer, so each rung's wording is explicit about
 * where to stop.
 */
export const HINT_LADDER: readonly HintRung[] = [
    {
        id: "nudge",
        label: "Nudge",
        escalatingLabel: "Give me a hint",
        description: "Point out what to notice, nothing more.",
        prompt:
            "Point me at the one thing in this problem I should be noticing — a structure, a constraint, a quantity worth naming. Do not tell me what to do with it, and do not name a technique yet.",
        icon: "search",
    },
    {
        id: "strategy",
        label: "Strategy",
        escalatingLabel: "Still stuck — more",
        description: "Name the technique and why it fits.",
        prompt:
            "Name the technique or idea this problem is built around and say in one or two sentences why it fits here. Do not apply it or set anything up — I want to try that part myself.",
        icon: "route",
    },
    {
        id: "first-step",
        label: "First step",
        escalatingLabel: "Show me the first step",
        description: "One concrete step, worked out, then stop.",
        prompt:
            "Work out just the first concrete step for me — set it up and carry it out — then stop and tell me what I should be doing next without doing it. Do not continue past that step.",
        icon: "step",
    },
    {
        id: "walkthrough",
        label: "Walk through",
        escalatingLabel: "Walk me through it",
        description: "The full path, step by step.",
        prompt:
            "Walk me through this problem step by step. Explain the reasoning behind each step rather than just the algebra, and pause at the points where I could have found the next step myself.",
        icon: "checklist",
    },
];

/** How many rungs there are, for progress readouts ("2 of 4"). */
export const HINT_LADDER_LENGTH = HINT_LADDER.length;

/**
 * The rung a student at `level` may take next, or `null` once the ladder is exhausted.
 * `level` is the count of rungs already taken, so it doubles as the index of the next.
 */
export function nextHintRung(level: number): HintRung | null {
    if (!Number.isFinite(level) || level < 0) return HINT_LADDER[0] ?? null;
    return HINT_LADDER[Math.floor(level)] ?? null;
}

/** `level` clamped into the ladder, for callers that store it loosely. */
export function clampHintLevel(level: number): number {
    if (!Number.isFinite(level) || level < 0) return 0;
    return Math.min(Math.floor(level), HINT_LADDER_LENGTH);
}

/**
 * The ladder as the rail renders it: every rung visible, so the student can see that
 * help escalates and how far they have gone, with everything past the next rung locked.
 * Showing the locked rungs is deliberate — a hidden ladder reads as one hint button
 * that mysteriously changes its mind.
 */
export interface HintRungState {
    readonly rung: HintRung;
    readonly index: number;
    /** Already taken. */
    readonly used: boolean;
    /** The one rung the student may take right now. */
    readonly next: boolean;
    /** Beyond the next rung: visible, but not yet earned. */
    readonly locked: boolean;
}

export function hintLadderState(level: number): readonly HintRungState[] {
    const taken = clampHintLevel(level);
    return HINT_LADDER.map((rung, index) => ({
        rung,
        index,
        used: index < taken,
        next: index === taken,
        locked: index > taken,
    }));
}

/**
 * The ladder rendered as a single quick-action chip for a live transcript — the next
 * rung under its escalating label. Returns nothing once the ladder is spent, rather
 * than a dead chip.
 */
export function hintQuickAction(level: number): AIChatQuickAction | null {
    const rung = nextHintRung(level);
    if (!rung) return null;
    return {
        id: `hint:${rung.id}`,
        label: rung.escalatingLabel,
        prompt: rung.prompt,
        icon: "lightbulb",
    };
}
