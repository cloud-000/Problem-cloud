import type { Dash, Pen, RGB, SceneElement } from "./scene/types";
import { resolvePenColor, rgbToNamedColor } from "./scene/pen";
import { positiveArcSweep, principalEllipseGeometry } from "./scene/ellipse-geometry";
import type { ToolKind } from "./engine/tools/types";

export type EditorPropertyId =
    | "strokeColor"
    | "fillEnabled"
    | "fillColor"
    | "lineWidth"
    | "dash"
    | "strokeOpacity"
    | "fillOpacity"
    | "labelText"
    | "fontSize"
    | "pointSize"
    | "eraserSize"
    | "radius"
    | "semiMajorAxis"
    | "semiMinorAxis"
    | "eccentricity"
    | "startAngle"
    | "arcAngle";

export type EditorPropertyValue = string | number | boolean;
export type PropertyControl = "color" | "toggle" | "number" | "dash" | "text";

export interface EditorPropertyDefinition {
    id: EditorPropertyId;
    label: string;
    control: PropertyControl;
    min?: number;
    max?: number;
    step?: number;
}

export interface ResolvedEditorProperty extends EditorPropertyDefinition {
    value: EditorPropertyValue;
    mixed: boolean;
}

export const EDITOR_PROPERTY_DEFINITIONS: Record<EditorPropertyId, EditorPropertyDefinition> = {
    strokeColor: { id: "strokeColor", label: "Color", control: "color" },
    fillEnabled: { id: "fillEnabled", label: "Fill", control: "toggle" },
    fillColor: { id: "fillColor", label: "Fill color", control: "color" },
    lineWidth: { id: "lineWidth", label: "Line width", control: "number", min: 1, max: 24, step: 0.5 },
    dash: { id: "dash", label: "Line style", control: "dash" },
    strokeOpacity: { id: "strokeOpacity", label: "Opacity", control: "number", min: 0.05, max: 1, step: 0.05 },
    fillOpacity: { id: "fillOpacity", label: "Fill opacity", control: "number", min: 0.05, max: 1, step: 0.05 },
    labelText: { id: "labelText", label: "Text", control: "text" },
    fontSize: { id: "fontSize", label: "Font size", control: "number", min: 8, max: 48, step: 1 },
    pointSize: { id: "pointSize", label: "Point size", control: "number", min: 1, max: 12, step: 0.5 },
    eraserSize: { id: "eraserSize", label: "Eraser size", control: "number", min: 4, max: 32, step: 1 },
    radius: { id: "radius", label: "Radius", control: "number", min: 0.01, max: 1000, step: 0.1 },
    semiMajorAxis: { id: "semiMajorAxis", label: "Semi-major axis", control: "number", min: 0.01, max: 1000, step: 0.1 },
    semiMinorAxis: { id: "semiMinorAxis", label: "Semi-minor axis", control: "number", min: 0.01, max: 1000, step: 0.1 },
    eccentricity: { id: "eccentricity", label: "Eccentricity", control: "number", min: 0, max: 0.999, step: 0.01 },
    startAngle: { id: "startAngle", label: "Start angle", control: "number", min: -360, max: 360, step: 1 },
    arcAngle: { id: "arcAngle", label: "Arc angle", control: "number", min: 1, max: 360, step: 1 },
};

const STROKE_PROPERTIES: EditorPropertyId[] = [
    "strokeColor", "lineWidth", "dash", "strokeOpacity",
];

export function toolPropertyIds(tool: ToolKind): EditorPropertyId[] {
    switch (tool) {
        case "pen":
        case "line":
        case "arc":
            return STROKE_PROPERTIES;
        case "rectangle":
            return [...STROKE_PROPERTIES, "fillEnabled", "fillColor", "fillOpacity"];
        case "point":
            return ["strokeColor", "pointSize", "strokeOpacity"];
        case "label":
            return ["strokeColor", "fontSize", "strokeOpacity"];
        case "eraser":
            return ["eraserSize"];
        case "select":
            return [];
    }
}

export function elementPropertyIds(element: SceneElement): EditorPropertyId[] {
    switch (element.kind) {
        case "raw":
            return [];
        case "label":
            return ["strokeColor", "strokeOpacity", "labelText", "fontSize"];
        case "dot":
            return ["strokeColor", "strokeOpacity", "pointSize"];
        case "fill":
            return element.drawPen
                ? [...STROKE_PROPERTIES, "fillColor", "fillOpacity"]
                : ["fillColor", "fillOpacity"];
        case "path":
            if (element.strokeEnabled === false) return ["fillColor", "fillOpacity"];
            return element.path.cyclic
                ? [...STROKE_PROPERTIES, "fillEnabled", "fillColor", "fillOpacity"]
                : STROKE_PROPERTIES;
        case "circle":
        case "ellipse":
            if (element.strokeEnabled === false) return ["fillColor", "fillOpacity"];
            return [...STROKE_PROPERTIES, "fillEnabled", "fillColor", "fillOpacity"];
        case "arc":
            return [...STROKE_PROPERTIES, "radius", "eccentricity", "startAngle", "arcAngle"];
        case "elliptical-arc":
            return [
                ...STROKE_PROPERTIES,
                "semiMajorAxis",
                "semiMinorAxis",
                "eccentricity",
                "startAngle",
                "arcAngle",
            ];
    }
}

export function commonElementPropertyIds(elements: readonly SceneElement[]): EditorPropertyId[] {
    if (elements.length === 0) return [];
    const rest = elements.slice(1).map((element) => new Set(elementPropertyIds(element)));
    return elementPropertyIds(elements[0]).filter((id) => rest.every((ids) => ids.has(id)));
}

function rgbToHex(rgb: RGB | undefined): string {
    if (!rgb) return "#000000";
    const channel = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 255)
        .toString(16).padStart(2, "0");
    return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`;
}

export function hexToRGB(hex: string): RGB {
    const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : "000000";
    return {
        r: Number.parseInt(normalized.slice(0, 2), 16) / 255,
        g: Number.parseInt(normalized.slice(2, 4), 16) / 255,
        b: Number.parseInt(normalized.slice(4, 6), 16) / 255,
    };
}

export function penColorHex(pen: Pen | undefined): string {
    return rgbToHex(resolvePenColor(pen));
}

export function penWithColor(pen: Pen | undefined, hex: string): Pen {
    const namedHex: Record<string, string> = {
        "#000000": "black",
        "#808080": "gray",
        "#ffffff": "white",
        "#ff0000": "red",
        "#ff8000": "orange",
        "#00ff00": "green",
        "#0000ff": "blue",
        "#800080": "purple",
    };
    const directName = namedHex[hex.toLowerCase()];
    if (directName) return { ...(pen ?? {}), namedColor: directName, color: undefined };
    const color = hexToRGB(hex);
    const namedColor = rgbToNamedColor(color);
    return {
        ...(pen ?? {}),
        ...(namedColor ? { namedColor, color: undefined } : { color, namedColor: undefined }),
    };
}

function strokePen(element: SceneElement): Pen | undefined {
    return element.kind === "fill" ? element.drawPen : element.pen;
}

function fillPen(element: SceneElement): Pen | undefined {
    if (element.kind === "fill") return element.pen;
    if (element.kind === "path" || element.kind === "circle" || element.kind === "ellipse") {
        return element.fillPen;
    }
    return undefined;
}

export function readElementProperty(element: SceneElement, id: EditorPropertyId): EditorPropertyValue {
    const stroke = strokePen(element);
    const fill = fillPen(element);
    switch (id) {
        case "strokeColor": return penColorHex(stroke);
        case "fillEnabled": return fill !== undefined;
        case "fillColor": return penColorHex(fill ?? { namedColor: "gray" });
        case "lineWidth": return stroke?.lineWidth ?? 3;
        case "dash": return typeof stroke?.dash === "string" ? stroke.dash : "solid";
        case "strokeOpacity": return stroke?.opacity ?? 1;
        case "fillOpacity": return fill?.opacity ?? 0.2;
        case "labelText": return element.kind === "label" ? element.text : "";
        case "fontSize": return element.kind === "label" ? (element.pen?.fontSize ?? 14) : 14;
        case "pointSize": return element.kind === "dot" ? (element.pen?.lineWidth ?? 3) : 3;
        case "eraserSize": return 8;
        case "radius": return element.kind === "arc" ? Math.abs(element.radius) : 0;
        case "semiMajorAxis":
            return element.kind === "arc" || element.kind === "elliptical-arc"
                ? principalEllipseGeometry(element).semiMajor
                : 0;
        case "semiMinorAxis":
            return element.kind === "arc" || element.kind === "elliptical-arc"
                ? principalEllipseGeometry(element).semiMinor
                : 0;
        case "eccentricity":
            return element.kind === "arc" || element.kind === "elliptical-arc"
                ? principalEllipseGeometry(element).eccentricity
                : 0;
        case "startAngle":
            return element.kind === "arc" || element.kind === "elliptical-arc" ? element.angle1 : 0;
        case "arcAngle":
            return element.kind === "arc" || element.kind === "elliptical-arc"
                ? positiveArcSweep(element.angle1, element.angle2)
                : 0;
    }
}

function finiteClamped(value: EditorPropertyValue, min: number, max: number): number {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : min;
}

function withArcAxes(
    element: Extract<SceneElement, { kind: "arc" | "elliptical-arc" }>,
    semiMajor: number,
    semiMinor: number,
): SceneElement {
    const geometry = principalEllipseGeometry(element);
    const major = Math.max(0.01, semiMajor);
    const minor = Math.max(0.01, Math.min(major, semiMinor));
    if (Math.abs(major - minor) <= 1e-9) {
        const orientation = Math.atan2(geometry.majorDirection[1], geometry.majorDirection[0]) * 180 / Math.PI;
        const angleOffset = element.kind === "elliptical-arc" ? orientation : 0;
        return {
            id: element.id,
            kind: "arc",
            center: element.center,
            radius: major,
            angle1: element.angle1 + angleOffset,
            angle2: element.angle2 + angleOffset,
            ...(element.pen ? { pen: element.pen } : {}),
            ...(element.strokeEnabled === false ? { strokeEnabled: false } : {}),
        };
    }
    return {
        id: element.id,
        kind: "elliptical-arc",
        center: element.center,
        axisX: [geometry.majorDirection[0] * major, geometry.majorDirection[1] * major],
        axisY: [geometry.minorDirection[0] * minor, geometry.minorDirection[1] * minor],
        angle1: element.angle1,
        angle2: element.angle2,
        ...(element.pen ? { pen: element.pen } : {}),
        ...(element.strokeEnabled === false ? { strokeEnabled: false } : {}),
    };
}

function patchStroke(element: SceneElement, patch: Partial<Pen>): SceneElement {
    if (element.kind === "fill") {
        if (!element.drawPen) return element;
        return { ...element, drawPen: { ...element.drawPen, ...patch } };
    }
    return { ...element, pen: { ...(element.pen ?? {}), ...patch } };
}

function patchFill(element: SceneElement, patch: Partial<Pen>): SceneElement {
    if (element.kind === "fill") return { ...element, pen: { ...(element.pen ?? {}), ...patch } };
    if (element.kind === "path" || element.kind === "circle" || element.kind === "ellipse") {
        return { ...element, fillPen: { ...(element.fillPen ?? { namedColor: "gray", opacity: 0.2 }), ...patch } };
    }
    return element;
}

export function writeElementProperty(
    element: SceneElement,
    id: EditorPropertyId,
    value: EditorPropertyValue,
): SceneElement {
    if (!elementPropertyIds(element).includes(id)) return element;
    switch (id) {
        case "strokeColor": {
            const pen = penWithColor(strokePen(element), String(value));
            return patchStroke(element, { color: pen.color, namedColor: pen.namedColor });
        }
        case "fillEnabled":
            if (element.kind === "path" || element.kind === "circle" || element.kind === "ellipse") {
                return value
                    ? { ...element, fillPen: element.fillPen ?? { namedColor: "gray", opacity: 0.2 } }
                    : { ...element, fillPen: undefined };
            }
            return element;
        case "fillColor": {
            const pen = penWithColor(fillPen(element), String(value));
            return patchFill(element, { color: pen.color, namedColor: pen.namedColor });
        }
        case "lineWidth": return patchStroke(element, { lineWidth: Number(value) });
        case "dash": return patchStroke(element, { dash: value as Dash });
        case "strokeOpacity": return patchStroke(element, { opacity: Number(value) });
        case "fillOpacity": return patchFill(element, { opacity: Number(value) });
        case "labelText": return element.kind === "label" ? { ...element, text: String(value) } : element;
        case "fontSize": return patchStroke(element, { fontSize: Number(value) });
        case "pointSize": return patchStroke(element, { lineWidth: Number(value) });
        case "eraserSize": return element;
        case "radius":
            return element.kind === "arc"
                ? { ...element, radius: finiteClamped(value, 0.01, 1000) }
                : element;
        case "semiMajorAxis": {
            if (element.kind !== "arc" && element.kind !== "elliptical-arc") return element;
            const geometry = principalEllipseGeometry(element);
            const major = finiteClamped(value, 0.01, 1000);
            return withArcAxes(element, major, Math.min(geometry.semiMinor, major));
        }
        case "semiMinorAxis": {
            if (element.kind !== "arc" && element.kind !== "elliptical-arc") return element;
            const geometry = principalEllipseGeometry(element);
            const minor = finiteClamped(value, 0.01, 1000);
            return withArcAxes(element, Math.max(geometry.semiMajor, minor), minor);
        }
        case "eccentricity": {
            if (element.kind !== "arc" && element.kind !== "elliptical-arc") return element;
            const geometry = principalEllipseGeometry(element);
            const eccentricity = finiteClamped(value, 0, 0.999);
            return withArcAxes(
                element,
                geometry.semiMajor,
                geometry.semiMajor * Math.sqrt(1 - eccentricity * eccentricity),
            );
        }
        case "startAngle":
            return element.kind === "arc" || element.kind === "elliptical-arc"
                ? {
                      ...element,
                      angle1: finiteClamped(value, -360, 360),
                      angle2: finiteClamped(value, -360, 360) + positiveArcSweep(element.angle1, element.angle2),
                  }
                : element;
        case "arcAngle":
            return element.kind === "arc" || element.kind === "elliptical-arc"
                ? { ...element, angle2: element.angle1 + finiteClamped(value, 1, 360) }
                : element;
    }
}

export function resolveElementProperties(elements: readonly SceneElement[]): ResolvedEditorProperty[] {
    return commonElementPropertyIds(elements).map((id) => {
        const values = elements.map((element) => readElementProperty(element, id));
        const value = values[0];
        return {
            ...EDITOR_PROPERTY_DEFINITIONS[id],
            value,
            mixed: values.some((candidate) => candidate !== value),
        };
    });
}
