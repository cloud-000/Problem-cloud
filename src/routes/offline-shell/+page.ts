import type { PageLoad } from "./$types";

/** Credential-free document cached as the navigation fallback. */
export const prerender = true;
export const ssr = false;

export const load: PageLoad = async () => ({});
