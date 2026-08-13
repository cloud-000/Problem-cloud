import { describe, expect, test } from "bun:test";
import { partitionProblemSolutions } from "./problem-solutions";

describe("partitionProblemSolutions", () => {
    test("keeps worked solutions in their original order", () => {
        expect(partitionProblemSolutions([" First ", "", "Second"]).written).toEqual([
            "First",
            "Second",
        ]);
    });

    test("moves YouTube links out of the written solution list", () => {
        expect(
            partitionProblemSolutions([
                "A written solution",
                "https://www.youtube.com/watch?v=YJeF9dLJZuw (Osman Nal)",
                "For those who want a video solution: https://youtu.be/orrw4VydBTk?t=140",
            ]),
        ).toEqual({
            written: ["A written solution"],
            videoLinks: [
                "https://www.youtube.com/watch?v=YJeF9dLJZuw",
                "https://youtu.be/orrw4VydBTk?t=140",
            ],
        });
    });

    test("recognizes bracketed links and keeps unrelated URLs out", () => {
        expect(
            partitionProblemSolutions([
                "[https://youtu.be/bjHBaOeFt6g?si=abc 2010 AIME I #12] [https://example.com Notes]",
                "See https://example.com/video for a written explanation",
            ]),
        ).toEqual({
            written: ["See https://example.com/video for a written explanation"],
            videoLinks: ["https://youtu.be/bjHBaOeFt6g?si=abc"],
        });
    });

    test("extracts a video URL from BBCode", () => {
        expect(
            partitionProblemSolutions([
                "[url]https://www.youtube.com/watch?v=abc123[/url]",
            ]).videoLinks,
        ).toEqual(["https://www.youtube.com/watch?v=abc123"]);
    });

    test("deduplicates video links", () => {
        expect(
            partitionProblemSolutions([
                "https://vimeo.com/123",
                "Watch again: https://vimeo.com/123",
            ]).videoLinks,
        ).toEqual(["https://vimeo.com/123"]);
    });
});
