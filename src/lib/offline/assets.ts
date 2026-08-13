/**
 * Which images a problem needs to render.
 *
 * Problem-authored media is **package data, not build data** (`docs/offline.md`
 * §4): the fonts and KaTeX are vendored once per deployment, but a statement's
 * Asymptote render lives on a third-party CDN and is only known once the problem
 * is downloaded. A package is not ready until every one of these is present, so
 * getting this list wrong ships a problem with a hole in it — which the contract
 * classifies as package corruption, not as a silently incomplete problem.
 *
 * Extraction runs over the *same parser the renderer uses*
 * (`$lib/utils/math-parser`), not over a second set of regexes. Markdown image
 * targets in particular are repo-relative and get resolved to a CDN URL at parse
 * time; a private regex here would key the asset to the unresolved path and the
 * service worker would never match the request the page actually makes.
 */

import { parseMathStatement, type ASTNode } from "$lib/utils/math-parser";
import { assetKey, normalizeAssetUrl } from "./checksum";
import type { OfflineAssetV1, OfflineProblemV1 } from "./types";

/** Every image URL referenced by one AST, in document order. */
function collectFromNodes(nodes: ASTNode[], out: string[]): void {
    for (const node of nodes) {
        switch (node.type) {
            case "img":
                if (node.src.trim()) out.push(node.src.trim());
                break;
            case "asy":
                // A code-only `[asy]` block renders as source, not an image.
                if (node.imageSrc.trim()) out.push(node.imageSrc.trim());
                break;
            case "bold":
            case "italic":
            case "underline":
            case "strikethrough":
            case "url":
            case "paragraph":
            case "heading":
            case "blockquote":
                collectFromNodes(node.children, out);
                break;
            case "list":
                for (const item of node.items) collectFromNodes(item, out);
                break;
            case "table":
                for (const row of [...node.head, ...node.body]) {
                    for (const cell of row.cells) collectFromNodes(cell.children, out);
                }
                break;
            default:
                break;
        }
    }
}

/**
 * Every image URL a problem's rendered surfaces reference, deduplicated and in
 * document order. Choices are included whether or not the problem is multiple
 * choice: a free-response key can itself carry a diagram, and the *asset list*
 * is not a disclosure surface — nothing renders a choice without gating on
 * `isMultipleChoice()`.
 */
export function problemImageUrls(problem: {
    statement?: string | null;
    choices?: string[] | null;
    officialSolutions?: string[] | null;
}): string[] {
    const sources = [
        problem.statement ?? "",
        ...(problem.choices ?? []),
        ...(problem.officialSolutions ?? []),
    ];

    const urls: string[] = [];
    for (const source of sources) {
        if (!source) continue;
        collectFromNodes(parseMathStatement(source), urls);
    }

    const seen = new Set<string>();
    const unique: string[] = [];
    for (const url of urls) {
        const normalized = normalizeAssetUrl(url);
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        unique.push(normalized);
    }
    return unique;
}

/** The asset records a problem contributes to a package page. */
export async function problemAssets(problem: {
    statement?: string | null;
    choices?: string[] | null;
    officialSolutions?: string[] | null;
}): Promise<OfflineAssetV1[]> {
    const urls = problemImageUrls(problem);
    return Promise.all(
        urls.map(async (url) => ({
            key: await assetKey(url),
            url,
            kind: "problem-image" as const,
            required: true as const,
        })),
    );
}

/** The `assetKeys` field for a durable problem record. */
export async function problemAssetKeys(problem: {
    statement?: string | null;
    choices?: string[] | null;
    officialSolutions?: string[] | null;
}): Promise<string[]> {
    return Promise.all(problemImageUrls(problem).map(assetKey));
}

/**
 * Assert that a downloaded problem's declared `assetKeys` match what its own
 * content references. The server builds the list, but the browser renders the
 * content, so a mismatch means the two disagree about what "this problem" is —
 * which is exactly the corruption the ready-check exists to catch.
 */
export async function assetKeysAgree(problem: OfflineProblemV1): Promise<boolean> {
    const derived = await problemAssetKeys({
        statement: problem.statement,
        choices: problem.choices,
        officialSolutions: problem.officialSolutions,
    });
    const declared = new Set(problem.assetKeys);
    return (
        derived.length === declared.size && derived.every((key) => declared.has(key))
    );
}
