import { describe, expect, test } from "bun:test";
import {
    commonElementPropertyIds,
    elementPropertyIds,
    penColorHex,
    penWithColor,
    readElementProperty,
    resolveElementProperties,
    toolPropertyIds,
    writeElementProperty,
} from "./editor-properties";
import {
    createArc,
    createCircle,
    createEllipticalArc,
    createFill,
    createLabel,
    createPath,
    makePath,
} from "./scene/factory";

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

    test("edits compass geometry through radius, eccentricity, axes, and arc angles", () => {
        const circleArc = createArc([0, 0], 4, 30, 120);
        expect(elementPropertyIds(circleArc)).toContain("eccentricity");
        expect(readElementProperty(circleArc, "radius")).toBe(4);
        expect(readElementProperty(circleArc, "arcAngle")).toBe(90);

        const eccentric = writeElementProperty(circleArc, "eccentricity", 0.6);
        expect(eccentric.kind).toBe("elliptical-arc");
        expect(readElementProperty(eccentric, "semiMajorAxis")).toBeCloseTo(4);
        expect(readElementProperty(eccentric, "semiMinorAxis")).toBeCloseTo(3.2);
        expect(readElementProperty(eccentric, "eccentricity")).toBeCloseTo(0.6);

        const widerSweep = writeElementProperty(eccentric, "arcAngle", 210);
        expect(widerSweep).toMatchObject({ angle1: 30, angle2: 240 });

        const circularAgain = writeElementProperty(eccentric, "eccentricity", 0);
        expect(circularAgain.kind).toBe("arc");
    });

    test("reports true principal axes for rotated affine elliptical arcs", () => {
        const ellipse = createEllipticalArc([1, 2], [0, 5], [-2, 0], 0, 180);
        expect(readElementProperty(ellipse, "semiMajorAxis")).toBeCloseTo(5);
        expect(readElementProperty(ellipse, "semiMinorAxis")).toBeCloseTo(2);
        expect(readElementProperty(ellipse, "eccentricity")).toBeCloseTo(Math.sqrt(21) / 5);
    });
});
