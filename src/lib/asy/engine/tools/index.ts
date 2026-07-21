import type { Tool, ToolKind } from "./types";
import { SelectTool } from "./select";
import { PenTool } from "./pen";
import { LineTool } from "./line";
import { RectangleTool } from "./rectangle";
import { ArcTool } from "./arc";
import { PointTool } from "./point";
import { LabelTool } from "./label";
import { EraserTool } from "./eraser";

export * from "./types";

/** Construct a fresh (stateless-at-rest) tool instance for the given kind. */
export function createTool(kind: ToolKind): Tool {
    switch (kind) {
        case "select":
            return new SelectTool();
        case "pen":
            return new PenTool();
        case "line":
            return new LineTool();
        case "rectangle":
            return new RectangleTool();
        case "arc":
            return new ArcTool();
        case "point":
            return new PointTool();
        case "label":
            return new LabelTool();
        case "eraser":
            return new EraserTool();
    }
}
