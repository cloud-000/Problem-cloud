/**
 * The local practice-query engine (`docs/offline-contracts.md` §4).
 *
 * This module is pure. It takes a candidate set the repository has already
 * bounded by package membership and applies trainer *meaning* — never IndexedDB
 * mechanics — so the same predicates can be contract-tested against fixtures
 * beside the online eligibility mirror.
 *
 * The rule that shapes it: **a local query may narrow downloaded membership and
 * may never expand beyond it.** A requested series or topic no package
 * represents is `not_downloaded` — not `exhausted`, and never a network request,
 * because "there are none" and "you did not download those" are different
 * answers and only one of them is honest.
 */

import { hasComparableAnswer } from "$lib/problem-response";
import { isMultipleChoice } from "$lib/utils";
import type { Mastery, ProblemProgress } from "$lib/progress";
import { hasPriorActivity } from "./overlay";
import type {
    OfflinePlacementV1,
    OfflinePracticeProblemV1,
    OfflineProblemRatingV1,
    OfflineProblemV1,
    PracticeQueryV1,
} from "./types";

export type QueryCandidate = {
    canonicalId: number;
    problem: OfflineProblemV1;
    placements: OfflinePlacementV1[];
    rating: OfflineProblemRatingV1 | null;
    /** Effective (snapshot + overlay) progress, from `overlay.ts`. */
    progress: ProblemProgress | null;
    progressIsProvisional: boolean;
};

type Filters = PracticeQueryV1["filters"];

/**
 * Does one placement satisfy the whole topic/series/division/format clause?
 *
 * Scope matching is **placement-aware**, mirroring `goal_scope_canonicals`: a
 * canonical enters a scope through *a* placement, possibly an alias placement
 * under another test entirely. Testing the canonical's own test metadata is a
 * different (and wrong) question — see `docs/goals.md` §3.
 *
 * Division/format vocabulary is per-series, so the series clause is an
 * OR-of-ANDs: each selected series brings its own narrowing, and one series'
 * "State" never leaks onto another.
 */
export function placementMatchesScope(
    placement: OfflinePlacementV1,
    filters: Pick<Filters, "topic" | "seriesIds" | "seriesScopes">,
): boolean {
    if (filters.topic.length > 0) {
        const topic = placement.topic;
        if (!topic || !filters.topic.includes(topic)) return false;
    }

    if (filters.seriesIds.length === 0) return true;

    const seriesId = placement.series?.id ?? placement.test?.seriesId ?? null;
    if (seriesId === null) return false;
    const key = String(seriesId);
    if (!filters.seriesIds.includes(key)) return false;

    const scope = filters.seriesScopes[key];
    if (!scope) return true;
    if (scope.divisions.length > 0) {
        const division = placement.test?.division;
        if (!division || !scope.divisions.includes(division)) return false;
    }
    if (scope.formats.length > 0) {
        const format = placement.test?.format;
        if (!format || !scope.formats.includes(format)) return false;
    }
    return true;
}

export function candidateMatchesScope(
    candidate: QueryCandidate,
    filters: Pick<Filters, "topic" | "seriesIds" | "seriesScopes">,
): boolean {
    if (candidate.placements.length === 0) {
        // A canonical with no downloaded placement can still be matched by an
        // unscoped query; it just cannot satisfy a series/topic clause.
        return filters.topic.length === 0 && filters.seriesIds.length === 0;
    }
    return candidate.placements.some((placement) =>
        placementMatchesScope(placement, filters),
    );
}

/** The problem-attribute half of the trainer's filters. */
export function matchesAttributes(
    candidate: QueryCandidate,
    filters: Filters,
): boolean {
    const problem = candidate.problem;

    if (filters.verifiedOnly && !problem.verified) return false;
    if (filters.computational !== null && problem.isComputational !== filters.computational) {
        return false;
    }

    const answerFields = {
        answer_status: problem.answerStatus,
        answer_index: problem.answerIndex,
        choices: problem.choices,
    };
    if (filters.answerAvailability === "with") {
        if (!hasComparableAnswer(answerFields)) return false;
    } else if (filters.answerAvailability === "without") {
        if (
            problem.answerStatus !== "source_missing" &&
            problem.answerStatus !== "needs_review"
        ) {
            return false;
        }
    }

    const solutions = problem.officialSolutions ?? [];
    if (filters.solutionAvailability === "with" && solutions.length === 0) return false;
    if (filters.solutionAvailability === "without" && solutions.length > 0) return false;

    if (filters.mastery.length > 0) {
        const mastery = candidate.progress?.mastery ?? null;
        const matches =
            mastery === null
                ? filters.mastery.includes("unassessed")
                : filters.mastery.includes(mastery as Mastery);
        if (!matches) return false;
    }

    return true;
}

/**
 * New mode's own eligibility: a usable statement, a comparable answer, no prior
 * factual activity, not ignored.
 *
 * `hasComparableAnswer` is the online contract, reused rather than restated. It
 * inspects `choices` only to check the key's *range*, never to display it — the
 * overloaded-`choices` rule does not change offline, so any surface that shows
 * options goes through {@link candidateIsMultipleChoice} first.
 */
export function newModeEligible(candidate: QueryCandidate, filters: Filters): boolean {
    const problem = candidate.problem;
    if (!problem.statement?.trim()) return false;

    const allowsAnswerless = filters.answerAvailability !== "with";
    if (
        !allowsAnswerless &&
        !hasComparableAnswer({
            answer_status: problem.answerStatus,
            answer_index: problem.answerIndex,
            choices: problem.choices,
        })
    ) {
        return false;
    }

    if (hasPriorActivity(candidate.progress)) return false;
    if (candidate.progress?.engagement === "ignored") return false;
    return true;
}

/** True when the problem shows options; the guard every choice read must pass. */
export function candidateIsMultipleChoice(candidate: QueryCandidate): boolean {
    return isMultipleChoice(candidate.problem.choices);
}

// --- Deterministic ordering --------------------------------------------------

/**
 * A stable 32-bit hash of `seed:id`. Ordering must be deterministic for
 * `(seed, canonicalId)` and must not touch `Math.random()`: a reload has to
 * resume the same order it left, and equal candidates must not collapse to id
 * order (which would serve the corpus alphabetically by database id).
 */
export function seededRank(seed: string, canonicalId: number): number {
    let hash = 0x811c9dc5; // FNV-1a offset basis
    const input = `${seed}:${canonicalId}`;
    for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
}

function bySeed(seed: string) {
    return (a: QueryCandidate, b: QueryCandidate) => {
        const rank = seededRank(seed, a.canonicalId) - seededRank(seed, b.canonicalId);
        return rank !== 0 ? rank : a.canonicalId - b.canonicalId;
    };
}

/**
 * Order candidates for one draw.
 *
 * `nearest-rating` mirrors the online adaptive draw's tiering exactly
 * (`fetchNewProblemDraw`): prefer the band, then the nearest *rated* problem
 * outside it, then an unconstrained draw — so a fresh or unrated corpus never
 * dead-ends. Ties inside every tier break on the seed, not on id.
 */
export function orderCandidates(
    candidates: QueryCandidate[],
    order: PracticeQueryV1["order"],
    ratingBand: [number, number] | null,
): QueryCandidate[] {
    const seeded = bySeed(order.seed);
    if (order.kind === "seeded-random" || order.ratingCenter === null) {
        const inBand = ratingBand
            ? candidates.filter((c) => withinBand(c.rating, ratingBand))
            : candidates;
        const rest = candidates.filter((c) => !inBand.includes(c));
        return [...inBand.sort(seeded), ...rest.sort(seeded)];
    }

    const center = order.ratingCenter;
    const inBand = ratingBand
        ? candidates.filter((c) => withinBand(c.rating, ratingBand))
        : candidates.filter((c) => c.rating !== null);
    const rated = candidates.filter((c) => c.rating !== null && !inBand.includes(c));
    const unrated = candidates.filter((c) => c.rating === null && !inBand.includes(c));

    const byDistance = (a: QueryCandidate, b: QueryCandidate) => {
        const delta =
            Math.abs((a.rating?.rating ?? center) - center) -
            Math.abs((b.rating?.rating ?? center) - center);
        return delta !== 0 ? delta : seeded(a, b);
    };

    return [...inBand.sort(byDistance), ...rated.sort(byDistance), ...unrated.sort(seeded)];
}

function withinBand(
    rating: OfflineProblemRatingV1 | null,
    band: [number, number],
): boolean {
    return rating !== null && rating.rating >= band[0] && rating.rating <= band[1];
}

// --- Coverage ----------------------------------------------------------------

/** What a set of candidates actually covers, for the `not_downloaded` answer. */
export type Coverage = { topics: Set<string>; seriesIds: Set<string> };

export function coverageOf(candidates: QueryCandidate[]): Coverage {
    const topics = new Set<string>();
    const seriesIds = new Set<string>();
    for (const candidate of candidates) {
        if (candidate.problem.topic) topics.add(candidate.problem.topic);
        for (const placement of candidate.placements) {
            if (placement.topic) topics.add(placement.topic);
            const seriesId = placement.series?.id ?? placement.test?.seriesId ?? null;
            if (seriesId !== null) seriesIds.add(String(seriesId));
        }
    }
    return { topics, seriesIds };
}

/**
 * The requested topics/series the downloaded packages do not contain at all.
 * Non-empty means the honest answer is `not_downloaded`: the query asked to
 * *expand* past what was downloaded, which local data can never satisfy.
 */
export function missingCoverage(
    filters: Pick<Filters, "topic" | "seriesIds">,
    coverage: Coverage,
): { topic: string[]; seriesIds: string[] } {
    return {
        topic: filters.topic.filter((topic) => !coverage.topics.has(topic)),
        seriesIds: filters.seriesIds.filter((id) => !coverage.seriesIds.has(id)),
    };
}

// --- The draw ----------------------------------------------------------------

export function toPracticeProblem(
    candidate: QueryCandidate,
): OfflinePracticeProblemV1 {
    return {
        canonicalId: candidate.canonicalId,
        problem: candidate.problem,
        placements: candidate.placements,
        rating: candidate.rating,
        progress: candidate.progress,
        progressIsProvisional: candidate.progressIsProvisional,
    };
}

/**
 * Apply every predicate and ordering rule to a package-bounded candidate set.
 * The repository owns the membership boundary and the `not_downloaded` /
 * `package_unavailable` answers; this owns everything inside it.
 */
export function runPracticeQuery(
    candidates: QueryCandidate[],
    query: PracticeQueryV1,
): { problems: OfflinePracticeProblemV1[]; availableCount: number } {
    const excluded = new Set(query.excludeCanonicalIds);
    const eligible = candidates.filter(
        (candidate) =>
            !excluded.has(candidate.canonicalId) &&
            candidateMatchesScope(candidate, query.filters) &&
            matchesAttributes(candidate, query.filters) &&
            newModeEligible(candidate, query.filters),
    );

    const ordered = orderCandidates(eligible, query.order, query.filters.ratingBand);
    return {
        problems: ordered.slice(0, Math.max(0, query.limit)).map(toPracticeProblem),
        availableCount: eligible.length,
    };
}
