import { describe, expect, test } from "bun:test";
import { shouldCloseOnFocusOut } from "./combobox";

describe("shouldCloseOnFocusOut", () => {
    test("a tap in flight does not close, even with a null relatedTarget", () => {
        // The mobile bug: iOS blurs the input with relatedTarget null when
        // the user taps a non-focusable option. Closing then unmounts the
        // list before click can commit.
        expect(shouldCloseOnFocusOut(null, null, true)).toBe(false);
    });

    test("a real blur outside the control closes the list", () => {
        expect(shouldCloseOnFocusOut(null, null, false)).toBe(true);
    });

    test("focus moving inside the control does not close", () => {
        const inside = { nodeType: 1 } as unknown as Node;
        const container = { contains: (node: Node) => node === inside };
        expect(shouldCloseOnFocusOut(inside, container, false)).toBe(false);
    });

    test("focus moving to a node outside the control closes", () => {
        const outside = { nodeType: 1 } as unknown as Node;
        const container = { contains: (_node: Node) => false };
        expect(shouldCloseOnFocusOut(outside, container, false)).toBe(true);
    });
});
