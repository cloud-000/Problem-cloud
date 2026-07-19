import { describe, expect, test } from "bun:test";
import {
    commonElementPropertyIds,
    elementPropertyIds,
    penColorHex,
    penWithColor,
    resolveElementProperties,
    toolPropertyIds,
    writeElementProperty,
} from "./editor-properties";
import { createCircle, createFill, createLabel, createPath, makePath } from "./scene/factory";

describe("whiteboard editor properties", () => {
    test("advertises only properties meaningful to each element and tool", () => {
        const open = createPath(makePath([[0, 0], [1, 1]]));
        const closed = createPath(makePath([[0, 0], [1, 0], [0, 1]], { cyclic: true }));
        expect(elementPropertyIds(open)).not.toContain("fillEnabled");
        expect(elementPropertyIds(closed)).toContain("fillEnabled");
        expect(elementPropertyIds(createLabel("A", [0, 0]))).toEqual([
            "strokeColor", "strokeOpacity", "labelText", "fontSize",
        ]);
        expect(toolPropertyIds("rectangle")).toContain("fillColor");
        expect(toolPropertyIds("eraser")).toEqual(["eraserSize"]);
        expect(elementPropertyIds({
            ...createCircle([0, 0], 1, undefined, { namedColor: "red" }),
            strokeEnabled: false,
        })).toEqual(["fillColor", "fillOpacity"]);
    });

    test("multi-selection exposes the intersection and resolves mixed values", () => {
        const a = createCircle([0, 0], 1, { namedColor: "red", lineWidth: 2 });
        const b = createCircle([3, 0], 1, { namedColor: "blue", lineWidth: 2 });
        expect(commonElementPropertyIds([a, b])).toContain("fillEnabled");
        const properties = resolveElementProperties([a, b]);
        expect(properties.find(({ id }) => id === "strokeColor")?.mixed).toBe(true);
        expect(properties.find(({ id }) => id === "lineWidth")?.mixed).toBe(false);
    });

    test("writes stroke, fill, text, and fill-only silhouette properties immutably", () => {
        const circle = createCircle([0, 0], 1, { namedColor: "black" });
        const filled = writeElementProperty(circle, "fillEnabled", true);
        const recolored = writeElementProperty(filled, "fillColor", "#ff0000");
        expect(circle.fillPen).toBeUndefined();
        expect(recolored.kind === "circle" && recolored.fillPen?.namedColor).toBe("red");

        const label = createLabel("A", [0, 0]);
        expect(writeElementProperty(label, "labelText", "$B$")).toMatchObject({ text: "$B$" });

        const silhouette = createFill(makePath([[0, 0], [1, 0], [0, 1]], { cyclic: true }), { namedColor: "blue" });
        expect(elementPropertyIds(silhouette)).not.toContain("lineWidth");
        expect(writeElementProperty(silhouette, "fillOpacity", 0.4)).toMatchObject({ pen: { opacity: 0.4 } });
    });

    test("palette colors preserve named Asymptote pens while custom RGB remains exact", () => {
        expect(penWithColor({}, "#808080")).toMatchObject({ namedColor: "gray" });
        const custom = penWithColor({}, "#123456");
        expect(custom.namedColor).toBeUndefined();
        expect(penColorHex(custom)).toBe("#123456");
    });
});
