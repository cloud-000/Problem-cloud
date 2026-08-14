/**
 * Build-owned Practice boot document.
 *
 * Like `/offline`, this is prerendered and client-only: no parent load, cookie,
 * session, profile, or SvelteKit data payload is allowed into the document the
 * service worker returns for `/practice?offlinePackage=...`.
 */
export const prerender = true;
export const ssr = false;

export const load = () => ({});
