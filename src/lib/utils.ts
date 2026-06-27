import { cn } from "tailwind-variants";

export { cn };

export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & {
    ref?: U | null;
};

/** Stopwatch-style elapsed time: `m:ss` once past a minute, else `Ns`. */
export function formatElapsed(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0
        ? `${minutes}:${String(seconds).padStart(2, "0")}`
        : `${seconds}s`;
}
