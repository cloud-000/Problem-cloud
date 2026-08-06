import { describe, expect, test } from "bun:test";
import {
    activeContextDescriptors,
    activeQuickActions,
    removeContextLayer,
    upsertContextLayer,
} from "./registry";
import type { CoachContextLayer } from "../types";

const layer = (ownerId: string, priority: number, descriptorId: string): CoachContextLayer => ({
    ownerId,
    source: priority > 10 ? "modal" : "route",
    priority,
    policy: "assist",
    descriptors: [
        { id: descriptorId, label: descriptorId, ref: { kind: "selection", text: descriptorId } },
    ],
    quickActions: [{ id: ownerId, label: ownerId, prompt: ownerId }],
});

describe("Coach context registry", () => {
    test("orders by priority and deduplicates descriptors", () => {
        const layers = [layer("route", 10, "shared"), layer("modal", 30, "shared")];
        expect(activeContextDescriptors(layers).map((item) => item.id)).toEqual(["shared"]);
        expect(activeQuickActions(layers)[0]?.id).toBe("modal");
    });

    test("registration and cleanup are owner-scoped", () => {
        let layers = upsertContextLayer([], layer("route", 10, "route"));
        layers = upsertContextLayer(layers, layer("modal", 30, "modal"));
        layers = removeContextLayer(layers, "route");
        expect(layers.map((item) => item.ownerId)).toEqual(["modal"]);
    });

    test("detaching affects active request descriptors", () => {
        const layers = [layer("route", 10, "route")];
        expect(activeContextDescriptors(layers, new Set(["route"]))).toEqual([]);
    });
});
