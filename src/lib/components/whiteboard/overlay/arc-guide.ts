/**
 * Arc/ellipse guide projection for the whiteboard overlay.
 *
 * Pure TypeScript sibling of `overlay-model.ts`: no Svelte, no DOM, no runes.
 * `buildArcGuide` converts either the arc tool's transient construction guide
 * or the single selected arc/elliptical-arc into the screen-space affordance
 * (`OverlayArcGuide`) the canvas and DOM overlays draw. Assembled by
 * `buildOverlay`, which stays the single overlay assembly point (INVARIANTS §1/§5).
 */
import {
    positiveArcSweep,
    principalEllipseGeometry,
    type ArcElement,
    type EllipticalArcElement,
    type Pair,
} from "$lib/asy/scene";
import type { RenderArcHandle } from "../render";
import type {
    ArcControl,
    ArcControlRef,
    OverlayArcGuide,
    OverlayArcHandle,
    OverlayInput,
} from "../overlay-model";

function isArcControl(
    ref: ArcControlRef | null,
    elementId: string,
    control: ArcControl,
): boolean {
    return ref?.elementId === elementId && ref.control === control;
}

function arcPoint(center: Pair, radius: number, angle: number): Pair {
    const radians = (angle * Math.PI) / 180;
    return [
        center[0] + radius * Math.cos(radians),
        center[1] + radius * Math.sin(radians),
    ];
}

function selectedArcPoint(
    element: ArcElement | EllipticalArcElement,
    angle: number,
): Pair {
    if (element.kind === "arc") return arcPoint(element.center, element.radius, angle);
    const radians = (angle * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return [
        element.center[0] + element.axisX[0] * cos + element.axisY[0] * sin,
        element.center[1] + element.axisX[1] * cos + element.axisY[1] * sin,
    ];
}

function geometryLabel(value: number): string {
    return Number(value.toFixed(2)).toString();
}

/**
 * The single selected arc/elliptical-arc whose guide should be drawn, or `null`.
 * Restricted to a lone real selection under the select tool — a marquee preview
 * or multi-select suppresses the per-arc affordance.
 */
function selectedArcElementFor(
    input: OverlayInput,
    activeSelection: readonly string[],
): ArcElement | EllipticalArcElement | null {
    if (
        activeSelection.length !== 1 ||
        input.selectionPreview !== null ||
        input.toolKind !== "select"
    ) return null;
    const element = input.displayScene.elements.find(({ id }) => id === activeSelection[0]);
    return element?.kind === "arc" || element?.kind === "elliptical-arc" ? element : null;
}

/**
 * Screen-space arc guide for a construction-in-progress or a selected arc, or
 * `null` when neither applies. `activeSelection` is the preview-or-real
 * selection already resolved by `buildOverlay`.
 */
export function buildArcGuide(
    input: OverlayInput,
    activeSelection: readonly string[],
): OverlayArcGuide | null {
    const { project, toScreenLength } = input;

    const construction = input.constructionArcGuide;
    if (construction) {
        const radiusEnd = construction.angle1 !== undefined
            ? arcPoint(construction.center, construction.radius, construction.angle1)
            : construction.radiusPoint ?? construction.center;
        const radiusLabelAt: Pair = [
            construction.center[0] + (radiusEnd[0] - construction.center[0]) * 0.55,
            construction.center[1] + (radiusEnd[1] - construction.center[1]) * 0.55,
        ];
        const handles: RenderArcHandle[] = [
            { control: "center", screen: project(construction.center) },
        ];
        if (construction.angle1 !== undefined) {
            handles.push({
                control: "start",
                screen: project(arcPoint(
                    construction.center,
                    construction.radius,
                    construction.angle1,
                )),
            });
        }
        if (construction.angle2 !== undefined) {
            handles.push({
                control: "end",
                screen: project(arcPoint(
                    construction.center,
                    construction.radius,
                    construction.angle2,
                )),
            });
        }
        return {
            center: project(construction.center),
            radius: toScreenLength(Math.abs(construction.radius)),
            handles,
            editHandles: [],
            elementId: null,
            points: undefined,
            radiusEditable: false,
            measurements: construction.radius > 1e-9
                ? {
                      axes: [{
                          start: project(construction.center),
                          end: project(radiusEnd),
                          label: `r ${geometryLabel(construction.radius)}`,
                          labelAt: project(radiusLabelAt),
                      }],
                  }
                : undefined,
        };
    }

    const selectedArcElement = selectedArcElementFor(input, activeSelection);
    if (!selectedArcElement) return null;
    // A smart arc's radius derives from its `start` point, so it exposes no
    // standalone radius ring — only the center/start/end point handles, which
    // drag through Pipeline B. A baked arc keeps its editable radius ring.
    const radiusEditable =
        selectedArcElement.kind === "arc" && !input.selectionContainsSmartItems;

    const start = selectedArcPoint(selectedArcElement, selectedArcElement.angle1);
    const end = selectedArcPoint(selectedArcElement, selectedArcElement.angle2);
    let startScreen = project(start);
    let endScreen = project(end);
    if (Math.hypot(startScreen[0] - endScreen[0], startScreen[1] - endScreen[1]) < 2) {
        const radians = (selectedArcElement.angle1 * Math.PI) / 180;
        const tangentWorld: Pair = selectedArcElement.kind === "arc"
            ? [-Math.sin(radians), Math.cos(radians)]
            : [
                  -selectedArcElement.axisX[0] * Math.sin(radians) +
                      selectedArcElement.axisY[0] * Math.cos(radians),
                  -selectedArcElement.axisX[1] * Math.sin(radians) +
                      selectedArcElement.axisY[1] * Math.cos(radians),
              ];
        const tangentLength = Math.max(1e-9, Math.hypot(tangentWorld[0], tangentWorld[1]));
        const tangent: Pair = [
            (tangentWorld[0] / tangentLength) * 7,
            -(tangentWorld[1] / tangentLength) * 7,
        ];
        startScreen = [startScreen[0] - tangent[0], startScreen[1] - tangent[1]];
        endScreen = [endScreen[0] + tangent[0], endScreen[1] + tangent[1]];
    }

    const geometry = principalEllipseGeometry(selectedArcElement);
    const semanticHandles: Array<{
        control: Exclude<ArcControl, "radius">;
        handle: Pair;
        screen: Pair;
    }> = [
        { control: "center", handle: selectedArcElement.center, screen: project(selectedArcElement.center) },
        { control: "start", handle: start, screen: startScreen },
        { control: "end", handle: end, screen: endScreen },
    ];
    if (selectedArcElement.kind === "elliptical-arc" && geometry.eccentricity > 1e-4) {
        semanticHandles.push(
            { control: "focus1", handle: geometry.foci[0], screen: project(geometry.foci[0]) },
            { control: "focus2", handle: geometry.foci[1], screen: project(geometry.foci[1]) },
        );
    }
    const editHandles: OverlayArcHandle[] = semanticHandles.map((handle) => ({
        ...handle,
        elementId: selectedArcElement.id,
        state: isArcControl(input.selectedArcControl, selectedArcElement.id, handle.control)
            ? "selected"
            : isArcControl(input.hoveredArcControl, selectedArcElement.id, handle.control)
              ? "hovered"
              : "default",
    }));
    const points = selectedArcElement.kind === "elliptical-arc"
        ? Array.from({ length: 65 }, (_, index) =>
              project(selectedArcPoint(selectedArcElement, (index / 64) * 360)),
          )
        : undefined;
    const majorOffset: Pair = [
        geometry.majorDirection[0] * geometry.semiMajor,
        geometry.majorDirection[1] * geometry.semiMajor,
    ];
    const minorOffset: Pair = [
        geometry.minorDirection[0] * geometry.semiMinor,
        geometry.minorDirection[1] * geometry.semiMinor,
    ];
    const center = selectedArcElement.center;
    const axes = selectedArcElement.kind === "arc"
        ? [{
              start: project(center),
              end: project(start),
              label: `r ${geometryLabel(geometry.semiMajor)}`,
              labelAt: project([
                  center[0] + (start[0] - center[0]) * 0.55,
                  center[1] + (start[1] - center[1]) * 0.55,
              ]),
          }]
        : [
              {
                  start: project([center[0] - majorOffset[0], center[1] - majorOffset[1]]),
                  end: project([center[0] + majorOffset[0], center[1] + majorOffset[1]]),
                  label: `a ${geometryLabel(geometry.semiMajor)}`,
                  labelAt: project([
                      center[0] + majorOffset[0] * 0.58,
                      center[1] + majorOffset[1] * 0.58,
                  ]),
              },
              {
                  start: project([center[0] - minorOffset[0], center[1] - minorOffset[1]]),
                  end: project([center[0] + minorOffset[0], center[1] + minorOffset[1]]),
                  label: `b ${geometryLabel(geometry.semiMinor)}`,
                  labelAt: project([
                      center[0] + minorOffset[0] * 0.58,
                      center[1] + minorOffset[1] * 0.58,
                  ]),
              },
          ];
    const sweep = positiveArcSweep(selectedArcElement.angle1, selectedArcElement.angle2);
    const angleMidpoint = selectedArcPoint(
        selectedArcElement,
        selectedArcElement.angle1 + sweep / 2,
    );
    const angleLabelAt = project([
        center[0] + (angleMidpoint[0] - center[0]) * 0.38,
        center[1] + (angleMidpoint[1] - center[1]) * 0.38,
    ]);
    return {
        center: project(center),
        radius: selectedArcElement.kind === "arc"
            ? toScreenLength(Math.abs(selectedArcElement.radius))
            : undefined,
        points,
        handles: editHandles,
        editHandles,
        elementId: selectedArcElement.id,
        radiusEditable,
        measurements: {
            axes,
            angleRays: [project(start), project(end)] as const,
            angleLabel: `θ ${geometryLabel(sweep)}°`,
            angleLabelAt,
        },
    };
}
