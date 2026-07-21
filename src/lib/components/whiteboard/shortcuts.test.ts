import { describe, expect, test } from "bun:test";
import * as bunTest from "bun:test";
import { createSmartPath, emptyWhiteboardDocument } from "$lib/whiteboard/model";
import type { VertexRef } from "./overlay-model";
import type { PointerInputController } from "./pointer-input.svelte";

const runtimeMock = (bunTest as unknown as {
    mock: { module(id: string, factory: () => unknown): void };
}).mock;
runtimeMock.module("$app/environment", () => ({ browser: false }));

const state = Object.assign(<T>(value: T): T => value, {
    snapshot: <T>(value: T): T => structuredClone(value),
});
Object.assign(globalThis, { $state: state });

// The shortcut guard tests `e.target` against the DOM element classes, which
// `bun test` has no browser to supply. Minimal stand-ins keep the guard's real
// branching intact without pulling in a DOM implementation.
class FakeHTMLElement {
    isContentEditable = false;
}
Object.assign(globalThis, {
    HTMLElement: FakeHTMLElement,
    HTMLInputElement: class extends FakeHTMLElement {},
    HTMLTextAreaElement: class extends FakeHTMLElement {},
});

const { WhiteboardStore } = await import("$lib/state/whiteboard.svelte");
const { KeyboardShortcutController } = await import("./shortcuts.svelte");

/** A canvas stand-in; the controller only ever compares identity. */
const fakeSurface = (): HTMLCanvasElement => ({}) as HTMLCanvasElement;

function keyPress(key: string, modifiers: Partial<KeyboardEvent> = {}): KeyboardEvent {
    return {
        key,
        target: null,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        preventDefault() {},
        ...modifiers,
    } as unknown as KeyboardEvent;
}

/** One smart path selected, wired to a controller over a stubbed pointer layer. */
function harness(options: { shortcutsAlwaysActive?: boolean; navigation?: boolean } = {}) {
    const created = createSmartPath(emptyWhiteboardDocument(), [[0, 0], [3, 4]], false);
    const store = new WhiteboardStore(created.document);
    const surface = fakeSurface();
    const calls: string[] = [];
    const pointer = {
        cancelPenBatch: () => calls.push("cancelPenBatch"),
        clearHandleSelection: () => calls.push("clearHandleSelection"),
        abortGesture: () => calls.push("abortGesture"),
    } as unknown as PointerInputController;

    let activeSelectedVertex: VertexRef | null = null;
    const controller = new KeyboardShortcutController({
        store,
        pointer,
        surface,
        navigation: options.navigation ?? true,
        shortcutsAlwaysActive: options.shortcutsAlwaysActive ?? false,
        get activeSelectedVertex() {
            return activeSelectedVertex;
        },
    });

    return {
        store,
        surface,
        controller,
        calls,
        setActiveSelectedVertex(vertex: VertexRef | null) {
            activeSelectedVertex = vertex;
        },
    };
}

describe("KeyboardShortcutController ownership", () => {
    test("ignores keys until this canvas has claimed the shortcut surface", () => {
        const scope = harness();
        // Another board is mounted and claimed first.
        harness().controller.claimSurface();

        scope.controller.keyDown(keyPress(" "));
        expect(scope.controller.spacePressed).toBe(false);

        scope.controller.claimSurface();
        scope.controller.keyDown(keyPress(" "));
        expect(scope.controller.spacePressed).toBe(true);
    });

    test("shortcutsAlwaysActive answers without a prior pointer interaction", () => {
        harness().controller.claimSurface();
        const scope = harness({ shortcutsAlwaysActive: true });

        scope.controller.keyDown(keyPress(" "));
        expect(scope.controller.spacePressed).toBe(true);
    });

    test("releaseSurface only gives up ownership held by the departing canvas", () => {
        const owner = harness({ shortcutsAlwaysActive: false });
        const other = harness();
        owner.controller.claimSurface();

        // A different board unmounting must not steal the live claim.
        other.controller.releaseSurface(other.surface);
        owner.controller.keyDown(keyPress(" "));
        expect(owner.controller.spacePressed).toBe(true);

        owner.controller.releaseSurface(owner.surface);
        const successor = harness();
        successor.controller.keyDown(keyPress(" "));
        expect(successor.controller.spacePressed).toBe(false);
    });
});

describe("KeyboardShortcutController keys", () => {
    test("space is a held modifier that a key-up or a window blur releases", () => {
        const scope = harness();
        scope.controller.claimSurface();

        scope.controller.keyDown(keyPress(" "));
        expect(scope.controller.spacePressed).toBe(true);
        scope.controller.keyUp(keyPress(" "));
        expect(scope.controller.spacePressed).toBe(false);

        scope.controller.keyDown(keyPress(" "));
        scope.controller.blur();
        expect(scope.controller.spacePressed).toBe(false);
    });

    test("space does nothing while viewport navigation is disabled", () => {
        const scope = harness({ navigation: false });
        scope.controller.claimSurface();

        scope.controller.keyDown(keyPress(" "));
        expect(scope.controller.spacePressed).toBe(false);
    });

    test("typing in a text field is never a canvas shortcut", () => {
        const scope = harness({ shortcutsAlwaysActive: true });
        const input = new HTMLInputElement() as unknown as HTMLInputElement;

        scope.controller.keyDown(keyPress(" ", { target: input }));
        expect(scope.controller.spacePressed).toBe(false);
    });

    test("Escape cancels the pen batch, the store, and the open gesture", () => {
        const scope = harness({ shortcutsAlwaysActive: true });

        scope.controller.keyDown(keyPress("Escape"));

        expect(scope.calls).toEqual([
            "cancelPenBatch",
            "clearHandleSelection",
            "abortGesture",
        ]);
    });

    test("Delete removes an active vertex before falling back to the selection", () => {
        const scope = harness({ shortcutsAlwaysActive: true });
        const elementId = scope.store.scene.elements[0].id;
        scope.store.selection = [elementId];

        scope.setActiveSelectedVertex({ elementId, nodeIndex: 0 });
        scope.controller.keyDown(keyPress("Delete"));
        expect(scope.store.selection).toEqual([elementId]);
        expect(scope.calls).toContain("clearHandleSelection");

        scope.setActiveSelectedVertex(null);
        scope.controller.keyDown(keyPress("Delete"));
        expect(scope.store.scene.elements).toEqual([]);
    });

    test("undo and redo are one modifier apart", () => {
        const scope = harness({ shortcutsAlwaysActive: true });
        const elementId = scope.store.scene.elements[0].id;
        scope.store.selection = [elementId];
        scope.controller.keyDown(keyPress("Backspace"));
        expect(scope.store.scene.elements).toEqual([]);

        scope.controller.keyDown(keyPress("z", { metaKey: true }));
        expect(scope.store.scene.elements.length).toBe(1);

        scope.controller.keyDown(keyPress("z", { metaKey: true, shiftKey: true }));
        expect(scope.store.scene.elements).toEqual([]);
    });
});
