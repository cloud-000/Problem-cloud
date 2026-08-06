import type {
    AttemptFact,
    FactWarning,
    ProblemFact,
    ResolvedFact,
    SeriesFact,
    TestFact,
    UserProfileFact,
} from "./facts";
import type { Policy } from "./policy";

const MAX_FACTS = 12;
const MAX_FACT_CHARS = 4_000;
const MAX_CONTEXT_CHARS = 12_000;

function warningLines(warnings: FactWarning[]): string[] {
    return warnings.map((warning) => `Warning: ${warning.message}`);
}

export function renderProblem(fact: ProblemFact, policy: Policy): string {
    const lines = [`Problem ${fact.id} (${fact.source || "unknown source"})`, fact.statement];
    if (fact.choices?.length) {
        lines.push(...fact.choices.map((choice, index) => `${String.fromCharCode(65 + index)}. ${choice}`));
    }
    if (fact.topic) lines.push(`Topic: ${fact.topic}`);
    if (fact.rating !== null) lines.push(`Difficulty rating: ${Math.round(fact.rating)}`);
    if (policy !== "test-locked" && fact.answer) lines.push(`Answer key: ${fact.answer}`);
    lines.push(...warningLines(fact.warnings));
    return lines.join("\n");
}

function renderAttempt(fact: AttemptFact): string {
    return [
        `Attempt on problem ${fact.problemId}`,
        `Current answer: ${fact.answer ?? "none"}`,
        `Wrong tries used: ${fact.triesUsed}`,
        `Submitted: ${fact.submitted ? "yes" : "no"}`,
        `Answer revealed: ${fact.revealed ? "yes" : "no"}`,
        `Elapsed: ${Math.max(0, Math.round(fact.elapsedMs / 1000))} seconds`,
    ].join("\n");
}

function renderTest(fact: TestFact): string {
    return [`Test: ${fact.name}`, fact.series ? `Series: ${fact.series}` : "", ...warningLines(fact.warnings)]
        .filter(Boolean)
        .join("\n");
}

function renderSeries(fact: SeriesFact): string {
    return [`Series: ${fact.name}`, ...warningLines(fact.warnings)].join("\n");
}

function renderUserProfile(fact: UserProfileFact): string {
    return [
        fact.rating === null ? "Player rating: unavailable" : `Player rating: ${Math.round(fact.rating)}`,
        fact.activeSession ? `Active practice session: ${fact.activeSession}` : "",
        fact.recentTopics.length ? `Recent topics: ${fact.recentTopics.join(", ")}` : "",
        ...warningLines(fact.warnings),
    ]
        .filter(Boolean)
        .join("\n");
}

export function renderFact(fact: ResolvedFact, policy: Policy): string {
    switch (fact.kind) {
        case "problem":
            return renderProblem(fact, policy);
        case "attempt":
            return renderAttempt(fact);
        case "test":
            return renderTest(fact);
        case "series":
            return renderSeries(fact);
        case "user-profile":
            return renderUserProfile(fact);
        case "selection":
            return `Selected context:\n${fact.text}`;
    }
}

/** Deterministic, centrally budgeted model context. */
export function renderFacts(facts: ResolvedFact[], policy: Policy): string {
    return facts
        .slice(0, MAX_FACTS)
        .map((fact) => renderFact(fact, policy).slice(0, MAX_FACT_CHARS))
        .filter(Boolean)
        .join("\n\n---\n\n")
        .slice(0, MAX_CONTEXT_CHARS);
}
