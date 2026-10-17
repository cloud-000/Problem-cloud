/** Only current rendering assets enter a new deployment's offline cache. */
export function shouldPrecacheRenderAsset(path: string): boolean {
    if (path.startsWith("/vendor/")) return true;
    return path === "/fonts/text.css" ||
        /^\/fonts\/(?:inter-300-700-normal|jetbrains-mono-400-600-normal|source-serif-4-200-900-(?:normal|italic))-latin(?:-ext)?\.woff2$/.test(path);
}

/** Manifest paths are assets, not route ids; resolve beside the worker script. */
export function workerAssetPath(path: string, workerUrl: string): string {
    return new URL(path, workerUrl).pathname;
}
