/**
 * PersistenceIO — the whiteboard's serialization boundary (ARCHITECTURE.md §5).
 *
 * Framework-neutral: no Svelte runes, no reactive state. It owns the two ways a
 * board leaves and re-enters memory — the Asymptote codec (`toAsy` / parse) and
 * localStorage — and nothing else. The store wires these to reactivity.
 *
 * Payload boundary: **the persisted payload is the `WhiteboardDocument` alone.**
 * View/tool state (pen defaults, stroke color, selection, active tool) is *not*
 * serialized here — that belongs to StyleModel and never rides along with the
 * document. Keep it that way: widening the payload would couple persistence to
 * style and re-introduce a second source of truth on restore.
 *
 * SSR caveat (per repo conventions): all localStorage access is `browser`-guarded
 * and best-effort; a full/blocked store must never break editing.
 */

import { browser } from "$app/environment";
import { parse, serialize } from "$lib/asy/codec";
import type { Scene } from "$lib/asy/scene/types";
import {
    parsePersistedWhiteboardDocument,
    resolveWhiteboardDocument,
    type WhiteboardDocument,
} from "$lib/whiteboard/model";

/** Serialize a document's projected Scene to Asymptote text. */
export function documentToAsy(document: WhiteboardDocument): string {
    return serialize(resolveWhiteboardDocument(document));
}

/** Parse Asymptote text into a Scene for loading into a document. */
export function sceneFromAsy(asy: string): Scene {
    return parse(asy).scene;
}

/** Persist a document to localStorage (browser-only, best-effort). */
export function persistDocument(key: string, document: WhiteboardDocument): void {
    if (!browser) return;
    try {
        localStorage.setItem(key, JSON.stringify(document));
    } catch {
        // best-effort; a full/blocked store must not break editing
    }
}

/** Restore a persisted document from localStorage, or `null` if absent/invalid. */
export function restoreDocument(key: string): WhiteboardDocument | null {
    if (!browser) return null;
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        return parsePersistedWhiteboardDocument(JSON.parse(raw));
    } catch {
        return null;
    }
}
