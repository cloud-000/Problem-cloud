import type { Scene } from "../../asy/scene/types";
import { migrateSceneToWhiteboardDocument, migrateV2WhiteboardDocument } from "./document";
import {
    WHITEBOARD_SCHEMA_VERSION,
    type PointFeatureRef,
    type SketchCurve,
    type ValidationResult,
    type WhiteboardDocument,
} from "./types";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): value is UnknownRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function pair(value: unknown): boolean {
    return Array.isArray(value) && value.length === 2 && finite(value[0]) && finite(value[1]);
}

function affineBasis(axisX: unknown, axisY: unknown): boolean {
    return pair(axisX) && pair(axisY) &&
        Math.abs(
            (axisX as number[])[0] * (axisY as number[])[1] -
            (axisX as number[])[1] * (axisY as number[])[0],
        ) > 1e-12;
}

function optionalBoolean(owner: UnknownRecord, key: string): boolean {
    return owner[key] === undefined || typeof owner[key] === "boolean";
}

function pen(value: unknown): boolean {
    if (!record(value)) return false;
    if (value.color !== undefined) {
        if (!record(value.color) || !finite(value.color.r) || !finite(value.color.g) || !finite(value.color.b)) {
            return false;
        }
    }
    if (value.namedColor !== undefined && typeof value.namedColor !== "string") return false;
    for (const key of ["lineWidth", "opacity", "fontSize"]) {
        if (value[key] !== undefined && !finite(value[key])) return false;
    }
    if (
        value.dash !== undefined &&
        !["solid", "dashed", "dotted", "longdashed"].includes(String(value.dash)) &&
        (!record(value.dash) || typeof value.dash.pattern !== "string")
    ) return false;
    return true;
}

function optionalPen(owner: UnknownRecord, key: string): boolean {
    return owner[key] === undefined || pen(owner[key]);
}

function path(value: unknown): boolean {
    if (!record(value) || !Array.isArray(value.nodes) || !Array.isArray(value.joins) ||
        typeof value.cyclic !== "boolean") return false;
    if (!value.nodes.every(pair) || !value.joins.every((join) => join === "--" || join === "..")) return false;
    const expected = value.cyclic ? value.nodes.length : Math.max(0, value.nodes.length - 1);
    return value.joins.length === expected;
}

function sceneMeta(value: unknown): boolean {
    return record(value) &&
        (value.unit === undefined || finite(value.unit)) &&
        (value.source === undefined || value.source === "authored" || value.source === "import");
}

function sceneElement(value: unknown): boolean {
    if (!record(value) || typeof value.id !== "string" || value.id.length === 0 ||
        typeof value.kind !== "string" || !optionalPen(value, "pen") ||
        !optionalBoolean(value, "strokeEnabled")) return false;
    switch (value.kind) {
        case "dot": return pair(value.at);
        case "path": return path(value.path) && optionalPen(value, "fillPen");
        case "circle":
            return pair(value.center) && finite(value.radius) && value.radius >= 0 && optionalPen(value, "fillPen");
        case "arc":
            return pair(value.center) && finite(value.radius) && value.radius >= 0 &&
                finite(value.angle1) && finite(value.angle2);
        case "ellipse":
            return pair(value.center) && pair(value.axisX) && pair(value.axisY) && optionalPen(value, "fillPen");
        case "elliptical-arc":
            return pair(value.center) && pair(value.axisX) && pair(value.axisY) &&
                finite(value.angle1) && finite(value.angle2);
        case "label":
            return typeof value.text === "string" && pair(value.at) &&
                (value.align === undefined || pair(value.align));
        case "fill": return path(value.path) && optionalPen(value, "drawPen");
        case "raw": return typeof value.source === "string";
        default: return false;
    }
}

/** Internal: the V1 (unversioned `Scene`) shape check used by the migration path. */
function validateScene(value: unknown): ValidationResult {
    const errors: string[] = [];
    if (!record(value)) return { valid: false, errors: ["scene must be an object"] };
    if (!Array.isArray(value.elements)) errors.push("scene.elements must be an array");
    else {
        const ids = new Set<string>();
        value.elements.forEach((element, index) => {
            if (!sceneElement(element)) errors.push(`scene.elements[${index}] is invalid`);
            else if (ids.has(element.id as string)) errors.push(`duplicate scene element id: ${element.id}`);
            else ids.add(element.id as string);
        });
    }
    if (value.meta !== undefined && !sceneMeta(value.meta)) errors.push("scene.meta is invalid");
    return { valid: errors.length === 0, errors };
}

function pointFeature(
    value: unknown,
    document: WhiteboardDocument,
    errors: string[],
    context: string,
): value is PointFeatureRef {
    if (!record(value)) {
        errors.push(`${context} must be a point feature`);
        return false;
    }
    if (value.kind === "point" && typeof value.pointId === "string") {
        if (!document.sketch.points[value.pointId]) errors.push(`${context} references missing point ${value.pointId}`);
        return true;
    }
    if (
        value.kind === "curve-point" && typeof value.curveId === "string" &&
        (value.feature === "center" || value.feature === "start" || value.feature === "end")
    ) {
        const curve = document.sketch.curves[value.curveId];
        if (!curve) errors.push(`${context} references missing curve ${value.curveId}`);
        else if (curve.kind === "segment" && value.feature === "center") {
            errors.push(`${context} cannot reference center on segment ${curve.id}`);
        } else if (
            (curve.kind === "circle" || curve.kind === "ellipse") &&
            value.feature !== "center"
        ) {
            errors.push(`${context} cannot reference ${value.feature} on circle ${curve.id}`);
        }
        return true;
    }
    errors.push(`${context} must be a point feature`);
    return false;
}

function curveRef(
    document: WhiteboardDocument,
    id: unknown,
    kinds: SketchCurve["kind"][],
    errors: string[],
    context: string,
): id is string {
    if (typeof id !== "string" || !document.sketch.curves[id]) {
        errors.push(`${context} references a missing curve`);
        return false;
    }
    if (!kinds.includes(document.sketch.curves[id].kind)) {
        errors.push(`${context} references an incompatible curve ${id}`);
        return false;
    }
    return true;
}

function validateReferences(document: WhiteboardDocument, errors: string[]): void {
    const itemIds = new Set<string>();
    document.items.forEach((item, index) => {
        const id = item.kind === "baked" ? item.element.id : item.id;
        if (itemIds.has(id)) errors.push(`duplicate item id: ${id}`);
        itemIds.add(id);
        if (item.kind === "sketch-point-marker" && !document.sketch.points[item.pointId]) {
            errors.push(`items[${index}] references missing point ${item.pointId}`);
        }
        if (item.kind === "sketch-curve") {
            if (curveRef(
                document,
                item.curveId,
                ["segment", "circle", "ellipse", "arc", "elliptical-arc"],
                errors,
                `items[${index}]`,
            ) && (
                document.sketch.curves[item.curveId].kind === "arc" ||
                document.sketch.curves[item.curveId].kind === "elliptical-arc"
            ) && item.fillPen) {
                errors.push(`items[${index}] cannot fill an arc presentation`);
            }
        }
        if (item.kind === "sketch-path") {
            let priorEnd: string | undefined;
            let firstStart: string | undefined;
            item.uses.forEach((use, useIndex) => {
                if (!curveRef(document, use.curveId, ["segment"], errors, `items[${index}].uses[${useIndex}]`)) return;
                const curve = document.sketch.curves[use.curveId] as Extract<SketchCurve, { kind: "segment" }>;
                const start = use.reversed ? curve.end : curve.start;
                const end = use.reversed ? curve.start : curve.end;
                firstStart ??= start;
                if (priorEnd !== undefined && priorEnd !== start) {
                    errors.push(`items[${index}] is not a structurally connected path`);
                }
                priorEnd = end;
            });
            if (item.cyclic && item.uses.length > 0 && priorEnd !== firstStart) {
                errors.push(`items[${index}] is not structurally closed`);
            }
        }
    });

    for (const constraint of Object.values(document.sketch.constraints)) {
        const context = `constraint ${constraint.id}`;
        switch (constraint.kind) {
            case "coincident":
                pointFeature(constraint.a, document, errors, `${context}.a`);
                pointFeature(constraint.b, document, errors, `${context}.b`);
                break;
            case "horizontal":
            case "vertical":
                curveRef(document, constraint.curveId, ["segment"], errors, context);
                break;
            case "parallel":
            case "perpendicular":
            case "equal-length":
            case "angle":
                curveRef(document, constraint.a, ["segment"], errors, `${context}.a`);
                curveRef(document, constraint.b, ["segment"], errors, `${context}.b`);
                if (constraint.kind === "angle" && !document.sketch.parameters[constraint.value]) {
                    errors.push(`${context} references missing parameter ${constraint.value}`);
                }
                break;
            case "fixed-point":
                pointFeature(constraint.point, document, errors, `${context}.point`);
                break;
            case "distance":
                pointFeature(constraint.a, document, errors, `${context}.a`);
                pointFeature(constraint.b, document, errors, `${context}.b`);
                if (!document.sketch.parameters[constraint.value]) {
                    errors.push(`${context} references missing parameter ${constraint.value}`);
                }
                break;
            case "radial-distance":
                curveRef(document, constraint.curveId, ["circle", "arc"], errors, context);
                if (!document.sketch.parameters[constraint.value]) {
                    errors.push(`${context} references missing parameter ${constraint.value}`);
                }
                break;
            case "point-on-curve":
                pointFeature(constraint.point, document, errors, `${context}.point`);
                curveRef(
                    document,
                    constraint.curveId,
                    ["segment", "circle", "ellipse", "arc", "elliptical-arc"],
                    errors,
                    context,
                );
                break;
            case "tangent":
                curveRef(document, constraint.a, ["segment", "arc", "elliptical-arc"], errors, `${context}.a`);
                curveRef(document, constraint.b, ["segment", "arc", "elliptical-arc"], errors, `${context}.b`);
                break;
        }
    }
}

export function validateWhiteboardDocument(value: unknown): ValidationResult {
    const errors: string[] = [];
    if (!record(value)) return { valid: false, errors: ["document must be an object"] };
    if (value.schemaVersion !== WHITEBOARD_SCHEMA_VERSION) errors.push("unsupported schemaVersion");
    if (!Array.isArray(value.items)) errors.push("document.items must be an array");
    if (!record(value.sketch)) errors.push("document.sketch must be an object");
    if (value.dimensions !== undefined && !record(value.dimensions)) errors.push("document.dimensions must be an object");
    if (value.meta !== undefined && !sceneMeta(value.meta)) errors.push("document.meta is invalid");
    if (errors.length > 0) return { valid: false, errors };

    const candidate = value as unknown as WhiteboardDocument;
    for (let index = 0; index < candidate.items.length; index += 1) {
        const item = candidate.items[index] as unknown;
        if (!record(item) || typeof item.kind !== "string") {
            errors.push(`items[${index}] is invalid`);
            continue;
        }
        if (item.kind === "baked") {
            if (!sceneElement(item.element)) errors.push(`items[${index}].element is invalid`);
        } else if (item.kind === "sketch-path") {
            if (typeof item.id !== "string" || !Array.isArray(item.uses) || typeof item.cyclic !== "boolean" ||
                !item.uses.every((use) => record(use) && typeof use.curveId === "string" && typeof use.reversed === "boolean") ||
                !optionalPen(item, "pen") || !optionalPen(item, "fillPen") || !optionalBoolean(item, "strokeEnabled")) {
                errors.push(`items[${index}] is an invalid sketch path`);
            }
        } else if (item.kind === "sketch-curve") {
            if (typeof item.id !== "string" || typeof item.curveId !== "string" || !optionalPen(item, "pen") ||
                !optionalPen(item, "fillPen") || !optionalBoolean(item, "strokeEnabled")) {
                errors.push(`items[${index}] is an invalid sketch curve`);
            }
        } else if (item.kind === "sketch-point-marker") {
            if (typeof item.id !== "string" || typeof item.pointId !== "string" || !optionalPen(item, "pen") ||
                !optionalBoolean(item, "strokeEnabled")) errors.push(`items[${index}] is an invalid point marker`);
        } else errors.push(`items[${index}] has unsupported kind ${item.kind}`);
    }

    const sketch = candidate.sketch as unknown as UnknownRecord;
    for (const key of ["points", "parameters", "curves", "constraints"]) {
        if (!record(sketch[key])) errors.push(`document.sketch.${key} must be an object`);
    }
    if (errors.length > 0) return { valid: false, errors };

    for (const [id, pointValue] of Object.entries(candidate.sketch.points)) {
        if (!record(pointValue) || pointValue.id !== id || !pair(pointValue.at)) errors.push(`point ${id} is invalid`);
    }
    for (const [id, parameter] of Object.entries(candidate.sketch.parameters)) {
        if (!record(parameter) || parameter.id !== id || !finite(parameter.value) ||
            !["length", "angle", "unitless"].includes(String(parameter.unit)) ||
            (parameter.name !== undefined && typeof parameter.name !== "string")) errors.push(`parameter ${id} is invalid`);
    }
    for (const [id, curve] of Object.entries(candidate.sketch.curves)) {
        if (!record(curve) || curve.id !== id || typeof curve.kind !== "string") {
            errors.push(`curve ${id} is invalid`);
            continue;
        }
        if (curve.kind === "segment") {
            if (typeof curve.start !== "string" || typeof curve.end !== "string" ||
                !candidate.sketch.points[curve.start] || !candidate.sketch.points[curve.end]) errors.push(`curve ${id} has invalid endpoints`);
        } else if (curve.kind === "circle") {
            if (typeof curve.center !== "string" || !candidate.sketch.points[curve.center] ||
                !finite(curve.radius) || curve.radius < 0) {
                errors.push(`curve ${id} is invalid`);
            }
        } else if (curve.kind === "ellipse") {
            if (
                typeof curve.center !== "string" || !candidate.sketch.points[curve.center] ||
                !affineBasis(curve.axisX, curve.axisY)
            ) {
                errors.push(`curve ${id} is invalid`);
            }
        } else if (curve.kind === "arc") {
            // A smart arc is three real points; its radius/angles are derived.
            if (
                typeof curve.center !== "string" || !candidate.sketch.points[curve.center] ||
                typeof curve.start !== "string" || !candidate.sketch.points[curve.start] ||
                typeof curve.end !== "string" || !candidate.sketch.points[curve.end]
            ) {
                errors.push(`curve ${id} is invalid`);
            }
        } else if (curve.kind === "elliptical-arc") {
            if (
                typeof curve.center !== "string" || !candidate.sketch.points[curve.center] ||
                typeof curve.start !== "string" || !candidate.sketch.points[curve.start] ||
                typeof curve.end !== "string" || !candidate.sketch.points[curve.end] ||
                !affineBasis(curve.axisX, curve.axisY)
            ) {
                errors.push(`curve ${id} is invalid`);
            }
        } else errors.push(`curve ${id} has unsupported kind`);
    }
    for (const [id, constraint] of Object.entries(candidate.sketch.constraints)) {
        if (!record(constraint) || constraint.id !== id || typeof constraint.kind !== "string" ||
            typeof constraint.enabled !== "boolean" ||
            (constraint.origin !== "explicit" && constraint.origin !== "inferred")) {
            errors.push(`constraint ${id} is invalid`);
            continue;
        }
        switch (constraint.kind) {
            case "coincident":
                if (constraint.a === undefined || constraint.b === undefined) errors.push(`constraint ${id} is invalid`);
                break;
            case "horizontal":
            case "vertical":
                if (typeof constraint.curveId !== "string") errors.push(`constraint ${id} is invalid`);
                break;
            case "parallel":
            case "perpendicular":
            case "equal-length":
            case "angle":
                if (typeof constraint.a !== "string" || typeof constraint.b !== "string" ||
                    (constraint.kind === "angle" && typeof constraint.value !== "string")) {
                    errors.push(`constraint ${id} is invalid`);
                }
                break;
            case "fixed-point":
                if (constraint.point === undefined || !pair(constraint.at)) errors.push(`constraint ${id} is invalid`);
                break;
            case "distance":
                if (constraint.a === undefined || constraint.b === undefined || typeof constraint.value !== "string") {
                    errors.push(`constraint ${id} is invalid`);
                }
                break;
            case "radial-distance":
                if (typeof constraint.curveId !== "string" || typeof constraint.value !== "string" ||
                    (constraint.display !== "radius" && constraint.display !== "diameter")) {
                    errors.push(`constraint ${id} is invalid`);
                }
                break;
            case "point-on-curve":
                if (constraint.point === undefined || typeof constraint.curveId !== "string") {
                    errors.push(`constraint ${id} is invalid`);
                }
                break;
            case "tangent":
                if (typeof constraint.a !== "string" || typeof constraint.b !== "string") {
                    errors.push(`constraint ${id} is invalid`);
                }
                break;
            default:
                errors.push(`constraint ${id} has unsupported kind ${String((constraint as unknown as UnknownRecord).kind)}`);
        }
    }
    for (const [id, dimension] of Object.entries(candidate.dimensions ?? {})) {
        if (!record(dimension) || dimension.id !== id || dimension.kind !== "length" ||
            (dimension.mode !== "driving" && dimension.mode !== "reference") ||
            dimension.a === undefined || dimension.b === undefined ||
            (dimension.constraintId !== undefined && typeof dimension.constraintId !== "string") ||
            (dimension.labelOffset !== undefined && !pair(dimension.labelOffset))) {
            errors.push(`dimension ${id} is invalid`);
            continue;
        }
        pointFeature(dimension.a, candidate, errors, `dimension ${id}.a`);
        pointFeature(dimension.b, candidate, errors, `dimension ${id}.b`);
        if (dimension.mode === "driving") {
            const constraint = dimension.constraintId
                ? candidate.sketch.constraints[dimension.constraintId]
                : undefined;
            if (constraint?.kind !== "distance") errors.push(`dimension ${id} is missing its distance constraint`);
        } else if (dimension.constraintId !== undefined) {
            errors.push(`reference dimension ${id} cannot own a constraint`);
        }
    }
    if (errors.length === 0) validateReferences(candidate, errors);
    return { valid: errors.length === 0, errors };
}

/** Parse current V3 JSON, migrate V2 documents, or migrate an unversioned V1 Scene. */
export function parsePersistedWhiteboardDocument(value: unknown): WhiteboardDocument | null {
    if (record(value) && value.schemaVersion !== undefined) {
        const candidate = value.schemaVersion === 2
            ? migrateV2WhiteboardDocument(value as unknown as Parameters<typeof migrateV2WhiteboardDocument>[0])
            : value;
        return validateWhiteboardDocument(candidate).valid
            ? candidate as unknown as WhiteboardDocument
            : null;
    }
    if (!validateScene(value).valid) return null;
    return migrateSceneToWhiteboardDocument(value as Scene);
}
