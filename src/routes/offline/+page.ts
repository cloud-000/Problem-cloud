import type { PageLoad } from "./$types";

/**
 * The neutral offline entry document (`docs/offline.md` §3b).
 *
 * It is **prerendered and client-rendered only**, which together are the whole
 * contract: prerendered so the service worker has a real document to return
 * when a navigation cannot reach the server, and `ssr = false` so that document
 * contains no server data whatsoever. There is deliberately no `+page.server.ts`
 * and nothing here reads `parent()` — a load of any kind would attach data to a
 * document the worker caches, which is exactly how personalized state ends up in
 * CacheStorage.
 *
 * Everything the page shows comes from the local repository at runtime, and a
 * cached response is never used to decide that anyone is signed in.
 */
export const prerender = true;
export const ssr = false;

export const load: PageLoad = async () => ({});
