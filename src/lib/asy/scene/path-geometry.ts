/** Pure path geometry shared by rendering, interaction, and bounds. */

import type { Pair, Path } from "./types";

export type PathCommand =
    | { kind: "move"; point: Pair }
    | { kind: "line"; point: Pair }
    | { kind: "curve"; c1: Pair; c2: Pair; point: Pair }
    | { kind: "close" };

/**
 * Whether a path supports the v1 vertex editor. Curved and mixed-join paths are
 * intentionally whole-object-only because moving/deleting their implicit
 * spline nodes cannot yet preserve explicit curve tangents.
 */
export function isStraightPathVertexEditable(path: Path): boolean {
    const expectedJoins = path.cyclic ? path.nodes.length : Math.max(0, path.nodes.length - 1);
    return path.nodes.length >= 2 &&
        path.joins.length === expectedJoins &&
        path.joins.every((join) => join === "--");
}

/**
 * Lower a scene path into the cubic interpretation used by the in-app Canvas
 * and SVG renderers. `..` remains a Catmull-Rom-style approximation of Asy's
 * Hobby spline; serialization continues to preserve the authored join.
 */
export function pathCommands(path: Path): PathCommand[] {
    const points = path.nodes;
    const count = points.length;
    if (count === 0) return [];

    const commands: PathCommand[] = [{ kind: "move", point: points[0] }];
    if (count === 1) return commands;

    const closed = path.cyclic;
    const segmentCount = closed ? count : count - 1;
    const at = (index: number): Pair => points[((index % count) + count) % count];

    for (let index = 0; index < segmentCount; index++) {
        const p1 = at(index);
        const p2 = at(index + 1);
        if ((path.joins[index] ?? "--") === "--") {
            commands.push({ kind: "line", point: p2 });
            continue;
        }

        const p0 = closed ? at(index - 1) : points[Math.max(index - 1, 0)];
        const p3 = closed ? at(index + 2) : points[Math.min(index + 2, count - 1)];
        commands.push({
            kind: "curve",
            c1: [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6],
            c2: [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6],
            point: p2,
        });
    }
    if (closed) commands.push({ kind: "close" });
    return commands;
}

function pointLineDistance(point: Pair, start: Pair, end: Pair): number {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
    return Math.abs(dy * point[0] - dx * point[1] + end[0] * start[1] - end[1] * start[0]) /
        Math.sqrt(lengthSquared);
}

function midpoint(a: Pair, b: Pair): Pair {
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function flattenCubic(
    start: Pair,
    c1: Pair,
    c2: Pair,
    end: Pair,
    tolerance: number,
    output: Pair[],
    depth = 0,
): void {
    if (
        depth >= 16 ||
        Math.max(pointLineDistance(c1, start, end), pointLineDistance(c2, start, end)) <= tolerance
    ) {
        output.push(end);
        return;
    }

    const a = midpoint(start, c1);
    const b = midpoint(c1, c2);
    const c = midpoint(c2, end);
    const d = midpoint(a, b);
    const e = midpoint(b, c);
    const middle = midpoint(d, e);
    flattenCubic(start, a, d, middle, tolerance, output, depth + 1);
    flattenCubic(middle, e, c, end, tolerance, output, depth + 1);
}

/** Flatten straight and curved joins into one interaction-ready polyline. */
export function flattenPath(path: Path, tolerance = 0.01): Pair[] {
    const commands = pathCommands(path);
    if (commands.length === 0 || commands[0].kind !== "move") return [];
    const points: Pair[] = [commands[0].point];
    let current = commands[0].point;
    for (const command of commands.slice(1)) {
        if (command.kind === "line") {
            points.push(command.point);
            current = command.point;
        } else if (command.kind === "curve") {
            flattenCubic(current, command.c1, command.c2, command.point, Math.max(tolerance, 1e-9), points);
            current = command.point;
        }
    }
    return points;
}

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
    const mt = 1 - t;
    return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

function derivativeRoots(p0: number, p1: number, p2: number, p3: number): number[] {
    const a = -p0 + 3 * p1 - 3 * p2 + p3;
    const b = p0 - 2 * p1 + p2;
    const c = p1 - p0;
    if (Math.abs(a) < 1e-12) return Math.abs(b) < 1e-12 ? [] : [-c / (2 * b)];
    const discriminant = b * b - a * c;
    if (discriminant < 0) return [];
    const root = Math.sqrt(discriminant);
    return [(-b + root) / a, (-b - root) / a];
}

/** Nodes plus every interior cubic axis extremum, suitable for exact bounds. */
export function pathExtrema(path: Path): Pair[] {
    const commands = pathCommands(path);
    if (commands.length === 0 || commands[0].kind !== "move") return [];
    const points: Pair[] = [commands[0].point];
    let current = commands[0].point;
    for (const command of commands.slice(1)) {
        if (command.kind === "line") {
            points.push(command.point);
            current = command.point;
        } else if (command.kind === "curve") {
            const roots = new Set([
                ...derivativeRoots(current[0], command.c1[0], command.c2[0], command.point[0]),
                ...derivativeRoots(current[1], command.c1[1], command.c2[1], command.point[1]),
            ]);
            for (const t of roots) {
                if (t <= 0 || t >= 1) continue;
                points.push([
                    cubicAt(current[0], command.c1[0], command.c2[0], command.point[0], t),
                    cubicAt(current[1], command.c1[1], command.c2[1], command.point[1], t),
                ]);
            }
            points.push(command.point);
            current = command.point;
        }
    }
    return points;
}
