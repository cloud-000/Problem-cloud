import { describe, expect, test } from "bun:test";
import {
    libraryMockCaption,
    librarySearchPlaceholder,
} from "./library-mock";

describe("library mock helpers", () => {
    test("search placeholders match the real Library", () => {
        expect(librarySearchPlaceholder("problems")).toBe("Search by problem ID");
        expect(librarySearchPlaceholder("tests")).toBe("Search tests by name");
        expect(librarySearchPlaceholder("series")).toBe("Search series by name");
    });

    test("captions follow the current tab and drilled scope", () => {
        expect(libraryMockCaption({ level: "problems" })).toBe(
            "One problem at a time.",
        );
        expect(libraryMockCaption({ level: "tests" })).toBe("A whole contest.");
        expect(libraryMockCaption({ level: "series" })).toBe(
            "A competition across years.",
        );
        expect(
            libraryMockCaption({
                level: "tests",
                seriesName: "AMC 10",
            }),
        ).toBe("Tests in AMC 10.");
        expect(
            libraryMockCaption({
                level: "problems",
                testName: "2024 AMC 10A",
            }),
        ).toBe("Problems from 2024 AMC 10A.");
    });
});
