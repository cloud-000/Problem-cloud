<script lang="ts">
    import { onMount } from "svelte";
    import { dev } from "$app/environment";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { offlineRepository, offlineSupport } from "$lib/offline/browser";
    import { topicLabel } from "$lib/library";
    import type { OfflinePackageManifestV1 } from "$lib/offline/types";

    type View =
        | { kind: "loading" }
        | { kind: "unsupported"; missing: string[] }
        | { kind: "unavailable"; message: string }
        | { kind: "signed-out" }
        | {
              kind: "packages";
              label: string | null;
              packages: OfflinePackageManifestV1[];
          };

    let view = $state<View>({ kind: "loading" });

    async function refresh() {
        const support = offlineSupport();
        const missing = [
            support.indexedDB ? null : "IndexedDB",
            support.cacheStorage ? null : "CacheStorage",
            support.serviceWorker ? null : "service workers",
        ].filter((name): name is string => name !== null);
        if (!support.indexedDB || !support.cacheStorage) {
            view = { kind: "unsupported", missing };
            return;
        }

        try {
            const repository = await offlineRepository();
            const marker = await repository.getAccountMarker();
            if (!marker) {
                // No account marker means no download may be opened. A cached
                // response is never used to decide that someone is signed in.
                view = { kind: "signed-out" };
                return;
            }
            view = {
                kind: "packages",
                label: marker.label,
                packages: await repository.listPackages(marker.userId),
            };
        } catch (error) {
            // A migration or open failure is reported, never answered by
            // deleting the database — it holds unsynced work.
            view = { kind: "unavailable", message: String(error) };
        }
    }

    onMount(() => {
        void refresh();
        if (!dev) return;
        // A dev-only handle for the Playwright package-lifecycle spec, which
        // has to drive a real download against real IndexedDB. It is gated on
        // `dev` purely to keep it out of the shipped bundle — it grants nothing
        // a same-origin script could not already do through IndexedDB directly.
        void (async () => {
            const [{ offlineRepository: open }, fixtures] = await Promise.all([
                import("$lib/offline/browser"),
                import("$lib/offline/fixtures"),
            ]);
            Object.assign(window, {
                __pcOffline: { open, fixtures, refresh },
            });
        })();
    });

    function scopeSummary(manifest: OfflinePackageManifestV1): string {
        const topics = manifest.scope.topic.map((code) => topicLabel(code) ?? code);
        const parts: string[] = [];
        if (topics.length) parts.push(topics.join(", "));
        const series = manifest.scope.seriesIds.length;
        if (series) parts.push(series === 1 ? "1 series" : `${series} series`);
        return parts.length ? parts.join(" · ") : "Everything downloaded";
    }

    function downloadedOn(value: string): string {
        return new Date(value).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
        });
    }
</script>

<svelte:head>
    <title>Offline · ProblemCloud</title>
    <meta name="robots" content="noindex" />
</svelte:head>

<div
    class="bg-background text-foreground fixed inset-0 flex flex-col overflow-y-auto"
>
    <header class="border-border/60 border-b">
        <div
            class="mx-auto flex h-16 w-full max-w-[720px] items-center gap-2 px-md"
        >
            <Icon name="cloud" fontsize="22px" class="text-primary-foreground" />
            <span class="text-base font-semibold tracking-[-0.01em]"
                >ProblemCloud</span
            >
            <span
                class="text-muted-foreground bg-surface-container ml-auto rounded-full px-2.5 py-1 text-xs"
            >
                Offline
            </span>
        </div>
    </header>

    <main class="mx-auto w-full max-w-[720px] flex-1 px-md py-lg">
        {#if view.kind === "loading"}
            <p class="text-muted-foreground type-secondary">
                Looking for downloaded problems on this device…
            </p>
        {:else if view.kind === "unsupported"}
            <h1 class="text-xl font-semibold">Offline mode is not available here</h1>
            <p class="text-muted-foreground type-secondary mt-sm">
                This browser is missing {view.missing.join(", ")}, which
                ProblemCloud needs to keep problems on your device. Nothing was
                downloaded, so nothing is lost — reopen the app once you are back
                online.
            </p>
        {:else if view.kind === "unavailable"}
            <h1 class="text-xl font-semibold">Local storage could not be opened</h1>
            <p class="text-muted-foreground type-secondary mt-sm">
                Your downloads and any unsynced work are still on this device.
                Closing other ProblemCloud tabs and reloading usually fixes this.
            </p>
            <p class="text-muted-foreground mt-sm font-mono text-xs">
                {view.message}
            </p>
            <Button class="mt-md" onclick={refresh}>Try again</Button>
        {:else if view.kind === "signed-out"}
            <h1 class="text-xl font-semibold">No account is open on this device</h1>
            <p class="text-muted-foreground type-secondary mt-sm">
                Downloads belong to the account that made them, and signing out
                hides them. Sign in as that account — while you are online — to
                see them again. Nothing was deleted.
            </p>
            <Button class="mt-md" href="/auth/login">Go to sign in</Button>
        {:else if view.packages.length === 0}
            <h1 class="text-xl font-semibold">Nothing is downloaded yet</h1>
            <p class="text-muted-foreground type-secondary mt-sm">
                You are offline{view.label ? `, signed in as ${view.label}` : ""}.
                Downloading a set of problems happens from Practice while you are
                online; once a download finishes, it is available here.
            </p>
            <Button class="mt-md" onclick={refresh}>Check again</Button>
        {:else}
            <h1 class="text-xl font-semibold">Downloaded and ready</h1>
            <p class="text-muted-foreground type-secondary mt-sm">
                You are offline{view.label ? `, signed in as ${view.label}` : ""}.
                These problem sets are stored on this device.
            </p>

            <ul class="mt-lg flex flex-col gap-md">
                {#each view.packages as manifest (manifest.packageId)}
                    <li
                        class="border-border bg-surface-container-lowest rounded-lg border p-md"
                    >
                        <div class="flex items-start justify-between gap-md">
                            <div>
                                <p class="font-medium">{scopeSummary(manifest)}</p>
                                <p class="text-muted-foreground type-caption mt-1">
                                    {manifest.problemCount} problems · downloaded {downloadedOn(
                                        manifest.downloadedAt,
                                    )}
                                </p>
                            </div>
                            {#if manifest.state === "stale"}
                                <span
                                    class="text-warning-foreground bg-warning/15 rounded-full px-2.5 py-1 text-xs whitespace-nowrap"
                                >
                                    Out of date
                                </span>
                            {/if}
                        </div>

                        {#if manifest.pendingOperations > 0}
                            <p class="text-muted-foreground type-caption mt-sm">
                                {manifest.pendingOperations} answer{manifest.pendingOperations ===
                                1
                                    ? ""
                                    : "s"} waiting to sync. They are kept until this
                                account is signed in and the sync succeeds.
                            </p>
                        {/if}
                    </li>
                {/each}
            </ul>

            <!-- Practising from a download arrives with the offline trainer
                 (docs/offline.md §12, slice 6). Offering a button now would be
                 UI ahead of its persistence and recovery path. -->
            <p class="text-muted-foreground type-caption mt-lg">
                Practising from a download is not switched on yet. Everything
                listed here is stored and will be waiting.
            </p>
        {/if}
    </main>
</div>
