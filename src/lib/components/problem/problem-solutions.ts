export type ProblemSolutions = {
    written: string[];
    videoLinks: string[];
};

const URL_PATTERN = /https?:\/\/[^\s\[\]]+/gi;

function trimUrlPunctuation(value: string): string {
    return value.replace(/[),.;!?]+$/, "");
}

function isVideoUrl(value: string): boolean {
    try {
        const hostname = new URL(value).hostname.toLowerCase();
        return (
            hostname === "youtu.be" ||
            hostname === "youtube.com" ||
            hostname.endsWith(".youtube.com") ||
            hostname === "youtube-nocookie.com" ||
            hostname.endsWith(".youtube-nocookie.com") ||
            hostname === "vimeo.com" ||
            hostname.endsWith(".vimeo.com")
        );
    } catch {
        return false;
    }
}

/**
 * Separates standalone video-link entries from worked solutions. Scraped video
 * entries are not normalized: some are bare URLs, while others include a title
 * or attribution around the URL. The URL host is therefore the stable signal.
 */
export function partitionProblemSolutions(
    solutions: string[] | null | undefined,
): ProblemSolutions {
    const written: string[] = [];
    const videoLinks: string[] = [];
    const seenVideoLinks = new Set<string>();

    for (const solution of solutions ?? []) {
        const value = solution?.trim();
        if (!value) continue;

        const links = Array.from(value.matchAll(URL_PATTERN), (match) =>
            trimUrlPunctuation(match[0]),
        ).filter(isVideoUrl);

        if (links.length === 0) {
            written.push(value);
            continue;
        }

        for (const link of links) {
            if (seenVideoLinks.has(link)) continue;
            seenVideoLinks.add(link);
            videoLinks.push(link);
        }
    }

    return { written, videoLinks };
}
