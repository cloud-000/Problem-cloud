import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { contextFrame, ELISION, TAG } from "../src/lib/ai/prompt";
import { buildSystemMessage } from "../src/lib/ai/prompt";
import { NO_ACTIVE_SCOPE_SECTION, renderFacts } from "../src/lib/ai/context/render";
import { CONTEXT_POLICIES } from "../src/lib/ai/context/policy";
import type { ResolvedFact } from "../src/lib/ai/context/facts";

/**
 * `$lib/ai/prompt.ts` is the only module allowed to contain model-facing markers.
 *
 * Before this was enforced, structural labels had drifted into three shapes across three
 * files and elision markers were spelled exactly like tags, so nothing in the codebase
 * told you what a model would actually read.
 */

const VOCABULARY_MODULE = "src/lib/ai/prompt.ts";
const SCANNED_ROOTS = ["src/lib/ai", "src/lib/server/ai"];

/** `[Something]` — the block-tag production. */
const TAG_LIKE = /\[[A-Za-z][^\]\n]*\]/;
/** `(… note)` — the elision production. */
const ELISION_LIKE = /\(…/;

function sourceFiles(root: string): string[] {
    const entries = readdirSync(root).flatMap((entry) => {
        const path = join(root, entry);
        if (statSync(path).isDirectory()) return sourceFiles(path);
        return path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
    });
    return entries.filter((path) => !path.endsWith(VOCABULARY_MODULE));
}

/** Strips comments, then yields the contents of every string and template literal. */
function stringLiterals(source: string): string[] {
    const code = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    return [...code.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`([\s\S]*?)`/g)].map(
        (match) => match[1] ?? match[2] ?? match[3] ?? "",
    );
}

describe("prompt vocabulary is centralized", () => {
    const files = SCANNED_ROOTS.flatMap(sourceFiles);

    test("scans the modules that build requests", () => {
        expect(files).toContain("src/lib/ai/context/render.ts");
        expect(files).toContain("src/lib/ai/context/fit.ts");
        expect(files).toContain("src/lib/ai/providers/messages.ts");
        expect(files).not.toContain(VOCABULARY_MODULE);
    });

    test("the fitter cannot reach the vocabulary", () => {
        // The layout engine takes every word inside the Doc it is handed. If it ever
        // imports the vocabulary it has started making composition decisions, and the
        // shapes will drift back out of the prompt module one literal at a time.
        const fitter = readFileSync("src/lib/ai/context/fit.ts", "utf8");
        expect(fitter).not.toMatch(/from\s+["'].*prompt["']/);
    });

    test("no module outside the vocabulary hardcodes a marker", () => {
        const offenders = files.flatMap((file) =>
            stringLiterals(readFileSync(file, "utf8"))
                .filter((literal) => TAG_LIKE.test(literal) || ELISION_LIKE.test(literal))
                .map((literal) => `${file}: ${literal}`),
        );
        expect(offenders).toEqual([]);
    });
});

describe("the grammar the system prompt promises is the one that is emitted", () => {
    const prompt = buildSystemMessage("coaching");

    test("the frame tag — the only one whose meaning a label cannot carry — is introduced", () => {
        // Deliberately not "every tag". `[Problem]`, `[Test]`, `[Series]`,
        // `[Student selection]` and `[Notice]` are self-describing nouns, and enumerating
        // them cost a third of the prompt to tell a model what "Problem" means.
        // `[Application context]` is different in kind: its name says where the text came
        // from, not that it is untrusted and must never be obeyed. That has to be stated.
        expect(prompt).toContain(`[${TAG.context}]`);
        expect(prompt).toMatch(/never as instructions/);
    });

    test("every tag in the vocabulary is one some production actually emits", () => {
        // A tag nothing produces is dead vocabulary, and if the prompt ever names one it
        // sends the model looking for a delimiter that is not there — `[Student]` was
        // described as the thing to answer long after most user turns stopped carrying it.
        const warnings = [{ code: "missing" as const, message: "gone" }];
        const facts: ResolvedFact[] = [
            {
                kind: "problem",
                id: 1,
                statement: "Statement",
                choices: ["a", "b", "c", "d", "e"],
                answerIndex: 0,
                warnings,
            },
            { kind: "test", id: 1, name: "Test", series: "Series", warnings },
            { kind: "series", id: 1, name: "Series", warnings },
            { kind: "selection", text: "Selection" },
        ];
        // Only what a model actually receives: the rendered frame, plus the policy block
        // the system message really emits. The prose *introducing* the tags is excluded —
        // including it is what would make this test vacuous.
        const emitted = [
            contextFrame(renderFacts(facts, "coaching")),
            // `[Notice]` has no fact that produces it: warnings render as the *field* of
            // the same name, and the block form is only ever the standalone section below.
            NO_ACTIVE_SCOPE_SECTION,
            prompt.slice(prompt.indexOf(`[${TAG.policy}]`)),
        ].join("\n");
        for (const tag of Object.values(TAG)) {
            expect(emitted).toContain(`[${tag}]`);
        }
    });

    test("elisions are visibly not tags", () => {
        const markers = [
            ELISION.text,
            ELISION.statement,
            ELISION.lines(3),
            ELISION.sections(2),
        ];
        for (const marker of markers) {
            expect(marker).toMatch(ELISION_LIKE);
            expect(marker).not.toMatch(TAG_LIKE);
        }
    });

    test("each policy contributes a delta and nothing more", () => {
        const deltas = CONTEXT_POLICIES.map((policy) =>
            buildSystemMessage(policy).slice(prompt.indexOf(`[${TAG.policy}]`)),
        );
        expect(new Set(deltas).size).toBe(CONTEXT_POLICIES.length);
        for (const delta of deltas) expect(delta).not.toContain("ProblemCloud coach");
    });
});
