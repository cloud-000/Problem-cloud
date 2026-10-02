export type VideoMetadata = {
    title: string;
    authorName?: string;
    providerName?: string;
    thumbnailUrl?: string;
};

const metadataCache = new Map<string, Promise<VideoMetadata | null>>();

export function isYouTubeUrl(value: string): boolean {
    try {
        const hostname = new URL(value).hostname.toLowerCase();
        return (
            hostname === "youtu.be" ||
            hostname === "youtube.com" ||
            hostname.endsWith(".youtube.com") ||
            hostname === "youtube-nocookie.com" ||
            hostname.endsWith(".youtube-nocookie.com")
        );
    } catch {
        return false;
    }
}

export function isVimeoUrl(value: string): boolean {
    try {
        const hostname = new URL(value).hostname.toLowerCase();
        return hostname === "vimeo.com" || hostname.endsWith(".vimeo.com");
    } catch {
        return false;
    }
}

export function getOEmbedUrl(url: string): string | null {
    if (isYouTubeUrl(url)) {
        return `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    }
    if (isVimeoUrl(url)) {
        return `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`;
    }
    return null;
}

export async function fetchVideoMetadata(
    url: string,
    customFetch: typeof fetch = fetch,
): Promise<VideoMetadata | null> {
    const oembedUrl = getOEmbedUrl(url);
    if (!oembedUrl) return null;

    const cached = metadataCache.get(url);
    if (cached) return cached;

    const promise = (async () => {
        try {
            const res = await customFetch(oembedUrl);
            if (!res.ok) return null;
            const data = await res.json();
            if (!data || typeof data.title !== "string" || !data.title.trim()) {
                return null;
            }
            return {
                title: data.title.trim(),
                authorName:
                    typeof data.author_name === "string" && data.author_name.trim()
                        ? data.author_name.trim()
                        : undefined,
                providerName:
                    typeof data.provider_name === "string" && data.provider_name.trim()
                        ? data.provider_name.trim()
                        : isYouTubeUrl(url)
                          ? "YouTube"
                          : undefined,
                thumbnailUrl:
                    typeof data.thumbnail_url === "string" && data.thumbnail_url.trim()
                        ? data.thumbnail_url.trim()
                        : undefined,
            };
        } catch {
            metadataCache.delete(url);
            return null;
        }
    })();

    metadataCache.set(url, promise);
    return promise;
}

export function formatVideoTitle(
    url: string,
    index: number,
    totalVideos: number,
    metadata?: VideoMetadata | null,
): string {
    if (metadata?.title) {
        return metadata.title;
    }
    return `Video solution${totalVideos > 1 ? ` ${index + 1}` : ""}`;
}

export function formatVideoSubtitle(
    url: string,
    metadata?: VideoMetadata | null,
): string {
    if (!metadata) return url;

    if (metadata.authorName && metadata.providerName) {
        return `${metadata.authorName} • ${metadata.providerName}`;
    }
    if (metadata.authorName) {
        return metadata.authorName;
    }
    if (metadata.providerName) {
        return metadata.providerName;
    }
    return url;
}

export function clearVideoMetadataCache(): void {
    metadataCache.clear();
}
