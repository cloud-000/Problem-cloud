/**
 * Where the app under test is, where reports go, and how many times each
 * measurement repeats. Everything is env-overridable so one run can be pointed
 * at a different port, label, or credential set without editing code.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// `import.meta.dirname` rather than Bun's `import.meta.dir`: the former is
// standard (Node 20.11+, Bun 1.1.20+) and declared by @types/node, so the whole
// directory typechecks without Bun's ambient types.
export const ROOT = join(import.meta.dirname, "..", "..");
export const OUT_DIR = join(ROOT, "tmp", "perf", "reports");
const CRED_FILE = join(ROOT, "tmp", "perf", "credentials.json");

export const BASE_URL = process.env.PC_PERF_BASE_URL ?? "http://127.0.0.1:4173";
export const LABEL = process.env.PC_PERF_LABEL ?? "unlabelled";

/** How many times each measurement repeats. Medians are what get reported. */
export const REPEATS = Math.max(1, Number(process.env.PC_PERF_REPEATS ?? 3));

/**
 * Origin of the app under test. Resource classification is relative to this:
 * same-origin assets can be bucketed by path, and everything else is a foreign
 * host whose byte count we cannot read at all.
 */
export const PAGE_ORIGIN = new URL(BASE_URL).origin;

export function credentials(): { email: string; password: string } {
    if (process.env.PC_PERF_EMAIL && process.env.PC_PERF_PASSWORD) {
        return { email: process.env.PC_PERF_EMAIL, password: process.env.PC_PERF_PASSWORD };
    }
    try {
        return JSON.parse(readFileSync(CRED_FILE, "utf8"));
    } catch {
        throw new Error(`No credentials. Set PC_PERF_EMAIL/PC_PERF_PASSWORD or write ${CRED_FILE}.`);
    }
}

export function gitSha(): string {
    try {
        return execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim();
    } catch {
        return "unknown";
    }
}
