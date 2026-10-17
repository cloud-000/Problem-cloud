/**
 * The durable artifact: one JSON report and one flat CSV per run. The JSON is
 * the source of truth — it keeps element identity and per-run detail — while the
 * CSV is the shape a spreadsheet or a diff script wants.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BASE_URL, LABEL, OUT_DIR, REPEATS, gitSha } from "./config";
import { csvCell, describeLcpElement } from "./format";
import type { ActionSample, RouteSample } from "./types";

export interface Report {
    meta: {
        label: string;
        baseUrl: string;
        gitSha: string;
        node: string;
        measuredAt: string;
        serviceWorkers: string;
        repeats: number;
    };
    routes: RouteSample[];
    actions: ActionSample[];
}

/** Write both files; returns their paths so the caller can report them. */
export function writeReport(
    routes: RouteSample[],
    actions: ActionSample[],
): { jsonPath: string; csvPath: string } {
    const report: Report = {
        meta: {
            label: LABEL,
            baseUrl: BASE_URL,
            gitSha: gitSha(),
            node: process.version,
            measuredAt: new Date().toISOString(),
            serviceWorkers: "blocked",
            repeats: REPEATS,
        },
        routes,
        actions,
    };

    mkdirSync(OUT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const jsonPath = join(OUT_DIR, `${stamp}.json`);
    writeFileSync(jsonPath, JSON.stringify(report, null, 2));

    const csvRows = ["kind,group,name,metric,value"];
    for (const r of routes) {
        if (!r.median) {
            csvRows.push(`route,median,${csvCell(r.route)},error,${csvCell(r.error)}`);
            continue;
        }
        for (const [k, v] of Object.entries(r.median)) {
            if (k === "slowest") continue;
            // Two fields are not scalars and get their own row shape.
            if (k === "payloadByCategory") {
                for (const g of r.median.payloadByCategory) {
                    csvRows.push(`route,median,${csvCell(r.route)},payload.${g.group}.bytes,${g.bytes}`);
                    csvRows.push(
                        `route,median,${csvCell(r.route)},payload.${g.group}.requests,${g.requests}`,
                    );
                }
                continue;
            }
            const cell = k === "lcpElement" ? describeLcpElement(r.median.lcpElement) : v;
            csvRows.push(`route,median,${csvCell(r.route)},${k},${csvCell(cell)}`);
        }
        if (r.lcpElementVaries) {
            csvRows.push(`route,median,${csvCell(r.route)},lcpElementVaries,true`);
        }
    }
    for (const a of actions) {
        csvRows.push(`action,${csvCell(a.group)},${csvCell(a.name)},medianMs,${a.ok ? a.medianMs : ""}`);
        if (a.extra) {
            for (const [k, v] of Object.entries(a.extra))
                csvRows.push(`action,${csvCell(a.group)},${csvCell(a.name)},${k},${csvCell(v)}`);
        }
    }
    const csvPath = join(OUT_DIR, `${stamp}.csv`);
    writeFileSync(csvPath, csvRows.join("\n") + "\n");

    return { jsonPath, csvPath };
}
