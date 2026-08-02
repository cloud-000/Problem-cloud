import { describe, expect, test } from "bun:test";
import { hasWhiteboardInspector } from "./control-policy";

describe("hasWhiteboardInspector", () => {
    test("does not offer an empty panel for select or pan", () => {
        expect(hasWhiteboardInspector({
            toolKind: "select",
            inspectorProperties: [],
            selectedDimensionId: null,
        })).toBe(false);
        expect(hasWhiteboardInspector({
            toolKind: "pan",
            inspectorProperties: [{ id: "ignored" }],
            selectedDimensionId: null,
        })).toBe(false);
    });

    test("offers drawing defaults and selection or dimension properties", () => {
        expect(hasWhiteboardInspector({
            toolKind: "pen",
            inspectorProperties: [{ id: "strokeColor" }],
            selectedDimensionId: null,
        })).toBe(true);
        expect(hasWhiteboardInspector({
            toolKind: "select",
            inspectorProperties: [{ id: "strokeColor" }],
            selectedDimensionId: null,
        })).toBe(true);
        expect(hasWhiteboardInspector({
            toolKind: "select",
            inspectorProperties: [],
            selectedDimensionId: "dimension-1",
        })).toBe(true);
    });
});
