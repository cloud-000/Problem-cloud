import { describe, expect, test } from "bun:test";
import { routeLabel, type RouteLabelEntry } from "./route-context";

const entries: readonly RouteLabelEntry[] = [
    { href: "/", label: "Home" },
    { href: "/practice", label: "Practice" },
    { href: "/library", label: "Library" },
    { href: "/progress", label: "Progress" },
    { href: "/progress/topics", label: "Topic breakdown" },
];

describe("routeLabel", () => {
    test("labels exact matches", () => {
        expect(routeLabel("/", entries)).toBe("Home");
        expect(routeLabel("/library", entries)).toBe("Library");
    });

    test("labels nested routes by their section", () => {
        expect(routeLabel("/practice/session-1", entries)).toBe("Practice");
    });

    test("prefers the longest declared prefix", () => {
        expect(routeLabel("/progress/topics/algebra", entries)).toBe("Topic breakdown");
    });

    test("never lets Home swallow every route", () => {
        expect(routeLabel("/leaderboard", entries)).toBe("/leaderboard");
    });

    test("falls back to the pathname for unlabelled routes", () => {
        expect(routeLabel("/testing-features/ai-chat", entries)).toBe("/testing-features/ai-chat");
    });

    test("does not match a partial path segment", () => {
        expect(routeLabel("/librarian", entries)).toBe("/librarian");
    });
});
