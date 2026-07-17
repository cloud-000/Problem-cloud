import { describe, expect, test } from "bun:test";
import { coerceOptions, filterOptions, groupOptions, matchesQuery } from "./select";

const options = coerceOptions([
    { value: "auto", label: "Auto · Recommended" },
    { value: "openai:gpt-4o", label: "GPT-4o", group: "OpenAI" },
    { value: "openai:o3-mini", label: "o3-mini", group: "OpenAI" },
    { value: "groq:llama-3.3-70b", label: "Llama 3.3 70B", group: "Groq" },
]);

describe("matchesQuery", () => {
    const gpt = options[1];

    test("an empty query matches everything", () => {
        expect(matchesQuery(gpt, "")).toBe(true);
        expect(matchesQuery(gpt, "   ")).toBe(true);
    });

    test("matches on label, case-insensitively", () => {
        expect(matchesQuery(gpt, "gpt")).toBe(true);
        expect(matchesQuery(gpt, "GPT-4O")).toBe(true);
    });

    test("matches on the raw value, so a user can type the model id", () => {
        expect(matchesQuery(gpt, "openai:")).toBe(true);
    });

    test("every token must match, so tokens can span label and value", () => {
        expect(matchesQuery(gpt, "gpt 4o")).toBe(true);
        expect(matchesQuery(gpt, "gpt llama")).toBe(false);
    });
});

describe("filterOptions", () => {
    test("narrows to matching options", () => {
        expect(filterOptions(options, "llama").map((o) => o.value)).toEqual(["groq:llama-3.3-70b"]);
    });

    test("returns nothing when a query matches nothing", () => {
        expect(filterOptions(options, "nonexistent")).toEqual([]);
    });
});

describe("groupOptions", () => {
    test("buckets by group and keeps first-seen order", () => {
        const sections = groupOptions(options);
        expect(sections.map((s) => s.label)).toEqual([undefined, "OpenAI", "Groq"]);
        expect(sections[1].options.map((o) => o.option.value)).toEqual([
            "openai:gpt-4o",
            "openai:o3-mini",
        ]);
    });

    test("indices address the list passed in, which is what keyboard nav walks", () => {
        const sections = groupOptions(options);
        expect(sections.flatMap((s) => s.options.map((o) => o.index))).toEqual([0, 1, 2, 3]);
    });

    test("indices stay correct after filtering, so Enter cannot commit the wrong row", () => {
        // The regression this guards: indexing into the unfiltered list while rendering
        // the filtered one selects whatever happens to sit at that position.
        const visible = filterOptions(options, "llama");
        const sections = groupOptions(visible);
        const entry = sections[0].options[0];
        expect(entry.index).toBe(0);
        expect(visible[entry.index].value).toBe("groq:llama-3.3-70b");
    });

    test("non-adjacent options sharing a group join one section", () => {
        const scattered = coerceOptions([
            { value: "a", label: "A", group: "One" },
            { value: "b", label: "B", group: "Two" },
            { value: "c", label: "C", group: "One" },
        ]);
        const sections = groupOptions(scattered);
        expect(sections).toHaveLength(2);
        expect(sections[0].options.map((o) => o.option.value)).toEqual(["a", "c"]);
    });
});
