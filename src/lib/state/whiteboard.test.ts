import { describe, expect, test } from "bun:test";
import * as bunTest from "bun:test";
import type { Scene } from "$lib/asy/scene";

const runtimeMock = (bunTest as unknown as {
    mock: { module(id: string, factory: () => unknown): void };
}).mock;
runtimeMock.module("$app/environment", () => ({ browser: false }));

const state = Object.assign(<T>(value: T): T => value, {
    snapshot: <T>(value: T): T => structuredClone(value),
});
Object.assign(globalThis, { $state: state });

const { WhiteboardStore } = await import("./whiteboard.svelte");

describe("WhiteboardStore selection gestures", () => {
    test("an explicit move gesture drags a selection from empty space inside its box", () => {
        const scene: Scene = {
            elements: [
                { id: "first", kind: "dot", at: [0, 0] },
                { id: "second", kind: "dot", at: [4, 4] },
            ],
        };
        const store = new WhiteboardStore(scene);
        store.selection = scene.elements.map(({ id }) => id);

        store.pointerDown([2, 2], { kind: "move" });
        store.pointerMove([5, 6]);

        expect(store.displayScene.elements).toMatchObject([
            { kind: "dot", at: [3, 4] },
            { kind: "dot", at: [7, 8] },
        ]);

        store.pointerUp([5, 6]);

        expect(store.scene.elements).toMatchObject([
            { kind: "dot", at: [3, 4] },
            { kind: "dot", at: [7, 8] },
        ]);
        expect(store.selection).toEqual(["first", "second"]);
        expect(store.preview).toBeNull();
    });
});
