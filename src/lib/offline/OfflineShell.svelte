<script lang="ts">
    import { onMount } from "svelte";
    import { dev } from "$app/environment";
    import { resolve } from "$app/paths";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { Input } from "$lib/components/input";
    import { createBrowserClient } from "@supabase/ssr";
    import {
        PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        PUBLIC_SUPABASE_URL,
    } from "$env/static/public";
    import type { SupabaseClient } from "@supabase/supabase-js";
    import type { Database } from "$lib/types/database.types";
    import { offlineRepository, offlineSupport } from "$lib/offline/browser";
    import { fetchAllSeries, topicLabel } from "$lib/library";
    import type { OfflinePackageManifestV1 } from "$lib/offline/types";
    import {
        downloadFailureMessage,
        downloadOfflinePackage,
        type DownloadProgress,
    } from "$lib/offline/download";
    import { checkoutAction } from "$lib/offline/network";
    import {
        DOWNLOAD_DEFAULT_PROBLEMS,
        PACKAGE_MAX_CANONICALS,
    } from "$lib/offline/limits";
    import { defaultPracticeSettings } from "$lib/trainer";
    import Track from "../../routes/(app)/practice/Track.svelte";
    import {
        createTrackValue,
        type TrackValue,
    } from "../../routes/(app)/practice/practice-settings";
    import OfflinePracticeRoute from "../../routes/(app)/practice/OfflinePracticeRoute.svelte";
    import DownloadedPracticeRoute from "../../routes/(app)/practice/DownloadedPracticeRoute.svelte";
    import LibraryPage from "../../routes/(app)/library/+page.svelte";
    import { offlinePresentation, type OfflinePresentation } from "$lib/offline/presentations";
    import { offlineMode } from "$lib/state/offline-mode.svelte";
    import AppLayout from "../../routes/(app)/+layout.svelte";
    import { beforeNavigate, pushState, replaceState } from "$app/navigation";
    import OfflineModeChip from "$lib/offline/OfflineModeChip.svelte";

    let {
        embedded = false,
        appSupabase = null,
    }: {
        embedded?: boolean;
        appSupabase?: SupabaseClient<Database> | null;
    } = $props();

    type BootWindow = Window & {
        __pcOfflineRequestedUrl?: string | null;
        __pcOfflinePresentationAllowed?: boolean;
    };

    let presentation = $state<OfflinePresentation | null>(null);
    let requestedPath = $state("/offline");
    let practicePackageId = $state<string | null>(null);
    let practiceSessionId = $state<string | null>(null);

    function selectPresentation(url: URL, history: "push" | "replace" | "none" = "none") {
        requestedPath = url.pathname;
        presentation = offlinePresentation(url.pathname);
        practicePackageId = url.searchParams.get("offlinePackage");
        practiceSessionId = url.searchParams.get("session");
        const href = url.pathname + url.search + url.hash;
        if (history === "push") pushState(resolve(href as "/"), {});
        else if (history === "replace") replaceState(resolve(href as "/"), {});
    }

    beforeNavigate((navigation) => {
        if (embedded) return;
        const target = navigation.to?.url;
        if (!target || target.origin !== location.origin) return;
        if (target.pathname.startsWith("/auth/") || target.pathname.startsWith("/api/")) return;
        navigation.cancel();
        selectPresentation(target, navigation.type === "popstate" ? "replace" : "push");
    });

    type View =
        | { kind: "loading" }
        | { kind: "unsupported"; missing: string[] }
        | { kind: "unavailable"; message: string }
        | { kind: "signed-out" }
        | {
              kind: "packages";
              userId: string;
              label: string | null;
              packages: OfflinePackageManifestV1[];
          };

    let view = $state<View>({ kind: "loading" });
    let action = $state<{ packageId: string; progress: DownloadProgress } | null>(null);
    let createProgress = $state<DownloadProgress | null>(null);
    let online = $state(false);
    let supabase = $state<SupabaseClient<Database> | null>(null);
    let seriesOptions = $state<{ value: string; label: string }[]>([]);
    let downloadScope = $state<TrackValue>(createTrackValue());
    let downloadName = $state("");
    let downloadAmount = $state<number | undefined>(DOWNLOAD_DEFAULT_PROBLEMS);
    let scopeError = $state<string | null>(null);

    function plainSeriesScopes(
        scopes: TrackValue["seriesScopes"],
    ): TrackValue["seriesScopes"] {
        return Object.fromEntries(
            Object.entries(scopes).map(([seriesId, scope]) => [
                seriesId,
                {
                    divisions: [...scope.divisions],
                    formats: [...scope.formats],
                },
            ]),
        );
    }

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
            let marker = await repository.getAccountMarker();
            // The authenticated app normally writes this marker at foreground
            // startup. A direct online visit can race that startup (or be the
            // first page opened), so establish the same credential-free marker
            // from a freshly validated user before deciding the page is signed
            // out. Cached/local auth state alone is never trusted here.
            if (!marker && navigator.onLine && supabase) {
                const { data, error: authError } = await supabase.auth.getUser();
                if (!authError && data.user) {
                    await repository.setActiveUser(
                        data.user.id,
                        data.user.email ?? null,
                    );
                    marker = await repository.getAccountMarker();
                }
            }
            if (!marker) {
                // No account marker means no download may be opened. A cached
                // response is never used to decide that someone is signed in.
                view = { kind: "signed-out" };
                return;
            }
            view = {
                kind: "packages",
                userId: marker.userId,
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
        const bootWindow = window as BootWindow;
        const isOfflineBoot = Boolean(bootWindow.__pcOfflineRequestedUrl);
        const directHref = window.location.pathname === "/offline-shell"
            ? "/offline"
            : window.location.href;
        const requestedUrl = new URL(
            bootWindow.__pcOfflineRequestedUrl ?? directHref,
            window.location.origin,
        );
        selectPresentation(requestedUrl);
        if (bootWindow.__pcOfflinePresentationAllowed === false) presentation = null;
        if (bootWindow.__pcOfflineRequestedUrl) {
            selectPresentation(requestedUrl, "replace");
            delete bootWindow.__pcOfflineRequestedUrl;
            delete bootWindow.__pcOfflinePresentationAllowed;
        }
        if (isOfflineBoot || !navigator.onLine) offlineMode.noteRemoteFailure();
        online = navigator.onLine;
        const updateOnline = () => (online = navigator.onLine);
        window.addEventListener("online", updateOnline);
        window.addEventListener("offline", updateOnline);
        supabase = appSupabase ?? createBrowserClient<Database>(
            PUBLIC_SUPABASE_URL,
            PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        );
        if ((presentation?.kind ?? "downloads") === "downloads") {
            void fetchAllSeries(supabase)
                .then((rows) => {
                    seriesOptions = rows.map((row) => ({ value: String(row.id), label: row.name }));
                })
                .catch((error) => {
                    scopeError = `Could not load series: ${String(error)}`;
                });
            void refresh();
        }
        if (!dev && import.meta.env.VITE_OFFLINE_E2E !== "1") {
            return () => {
                window.removeEventListener("online", updateOnline);
                window.removeEventListener("offline", updateOnline);
            };
        }
        // A test-only handle for the Playwright package-lifecycle spec, which
        // has to drive a real download against real IndexedDB. Normal builds
        // tree-shake it; production-browser acceptance opts in at build time
        // with VITE_OFFLINE_E2E=1.
        void (async () => {
            const [{ offlineRepository: open }, fixtures, network] = await Promise.all([
                import("$lib/offline/browser"),
                import("$lib/offline/fixtures"),
                import("$lib/offline/network"),
            ]);
            Object.assign(window, {
                __pcOffline: { open, fixtures, network, refresh },
            });
        })();
        return () => {
            window.removeEventListener("online", updateOnline);
            window.removeEventListener("offline", updateOnline);
        };
    });

    async function downloadSelectedScope() {
        if (view.kind !== "packages" || !online || !supabase) return;
        scopeError = null;
        if (
            downloadAmount === undefined ||
            !Number.isInteger(downloadAmount) ||
            downloadAmount < 1 ||
            downloadAmount > PACKAGE_MAX_CANONICALS
        ) {
            scopeError = `Choose between 1 and ${PACKAGE_MAX_CANONICALS.toLocaleString()} problems.`;
            return;
        }
        // Give the click immediate, visible acknowledgement. Authentication,
        // opening IndexedDB and obtaining the device id can all take long enough
        // that waiting for the orchestrator's first callback looks like a no-op.
        createProgress = { state: "estimating" };
        let confirmed = false;
        try {
            const { data, error: authError } = await supabase.auth.getUser();
            if (authError || !data.user) {
                const message = "Sign in again before starting this download.";
                scopeError = message;
                createProgress = { state: "failed", message };
                return;
            }
            if (data.user.id !== view.userId) {
                const message =
                    "This device is open for a different account. Return to the app once to switch the offline account safely.";
                scopeError = message;
                createProgress = { state: "failed", message };
                return;
            }
            await downloadOfflinePackage({
                repository: await offlineRepository(),
                userId: view.userId,
                session: {
                    name: downloadName.trim() || "Offline practice",
                    settings: {
                        ...defaultPracticeSettings(),
                        topic: [...downloadScope.topic],
                        seriesIds: [...downloadScope.seriesIds],
                        // `downloadScope` is a Svelte state proxy, which the
                        // browser structured-clone algorithm rejects. Rebuild
                        // the small nested map as ordinary request data.
                        seriesScopes: plainSeriesScopes(downloadScope.seriesScopes),
                    },
                },
                problemLimit: downloadAmount,
                onProgress: (progress) => {
                    createProgress = progress;
                    if (progress.state === "ready") {
                        downloadScope = createTrackValue();
                        downloadName = "";
                    }
                },
                confirm: async (created, bytes, persistent) => {
                    confirmed = confirm(
                        `Download ${created.problemCount} problems using about ${Math.ceil(bytes / 1024 / 1024)} MB? Answer keys are stored on this device.${persistent === false ? " This browser did not grant persistent storage." : ""}`,
                    );
                    return confirmed;
                },
            });
            if (!confirmed && createProgress?.state === "estimating") {
                createProgress = null;
            }
        } catch (error) {
            // Errors thrown before the orchestrator starts (for example while
            // opening IndexedDB) still need a durable visible state.
            if (createProgress?.state === "estimating") {
                createProgress = {
                    state: "failed",
                    message: downloadFailureMessage(error),
                };
            }
        } finally {
            await refresh();
        }
    }

    function scopeSummary(manifest: OfflinePackageManifestV1): string {
        const topics = manifest.scope.topic.map((code) => topicLabel(code) ?? code);
        const parts: string[] = [];
        if (topics.length) parts.push(topics.join(", "));
        const series = manifest.scope.seriesIds.length;
        if (series) parts.push(series === 1 ? "1 series" : `${series} series`);
        return parts.length ? parts.join(" · ") : "Any topic or series";
    }

    function downloadedOn(value: string): string {
        return new Date(value).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
        });
    }

    async function refreshPackage(manifest: OfflinePackageManifestV1) {
        const repository = await offlineRepository();
        const session = manifest.sessionId != null
            ? await repository.loadSession(manifest.userId, manifest.sessionId)
            : null;
        try {
            await downloadOfflinePackage({
                repository,
                userId: manifest.userId,
                session: session?.row ?? {
                    name: null,
                    settings: {
                        ...defaultPracticeSettings(),
                        topic: [...manifest.scope.topic],
                        seriesIds: [...manifest.scope.seriesIds],
                        seriesScopes: manifest.scope.seriesScopes,
                    },
                },
                packageId: manifest.packageId,
                onProgress: (progress) => (action = { packageId: manifest.packageId, progress }),
                confirm: async (created, bytes, persistent) => confirm(
                    `Refresh ${created.problemCount} problems using about ${Math.ceil(bytes / 1024 / 1024)} MB? The current ready copy remains usable until the refresh commits.`,
                ),
            });
        } finally {
            await refresh();
        }
    }

    async function deletePackage(manifest: OfflinePackageManifestV1) {
        const warning = manifest.pendingOperations
            ? `Discard this download and its ${manifest.pendingOperations} pending change(s)? This cannot be undone.`
            : `Delete this ${manifest.problemCount}-problem download?`;
        if (!confirm(warning)) return;
        const repository = await offlineRepository();
        await repository.deletePackage(manifest.packageId, {
            discardPending: manifest.pendingOperations > 0,
        });
        await checkoutAction(
            manifest.checkoutId,
            manifest.pendingOperations > 0 ? "abandon" : "close",
        ).catch(() => undefined);
        await refresh();
    }

    function launchPractice(manifest: OfflinePackageManifestV1) {
        // A document navigation lets the service worker choose the neutral
        // Practice shell when this package is launched without networking.
        // Client routing would ask for credentialed `__data.json` instead.
        // Packages that still have a leftover dedicated session keep the
        // explicit selector; new downloads open ordinary local Practice.
        const href = manifest.sessionId != null
            ? (`/practice?offlinePackage=${encodeURIComponent(manifest.packageId)}` as const)
            : "/practice";
        window.location.assign(resolve(href));
    }
</script>

{#snippet downloadForm()}
    {#if online && supabase}
        <section
            class="border-border bg-surface-container-lowest mt-lg rounded-lg border p-md"
        >
            <h2 class="text-base font-semibold">Download problems</h2>
            <p class="text-muted-foreground type-caption mt-1">
                Choose how many problems to keep on this device. Topic and series
                filters are optional; practice sessions themselves remain unlimited.
            </p>
            <div class="mt-md flex flex-col gap-3">
                <Input
                    bind:value={downloadName}
                    placeholder="Download name (optional)"
                    aria-label="Download name"
                />
                <label class="type-caption flex flex-col gap-1">
                    <span class="font-medium">Problems to download</span>
                    <Input
                        type="number"
                        min="1"
                        max={PACKAGE_MAX_CANONICALS}
                        step="1"
                        bind:value={downloadAmount}
                        aria-describedby="download-amount-help"
                    />
                    <span id="download-amount-help" class="text-muted-foreground">
                        Defaults to {DOWNLOAD_DEFAULT_PROBLEMS}. This does not limit
                        the online practice session.
                    </span>
                </label>
                <Track
                    bind:value={downloadScope}
                    {seriesOptions}
                    {supabase}
                />
            </div>
            <div aria-live="polite">
                {#if scopeError}
                    <p class="text-destructive type-caption mt-sm">{scopeError}</p>
                {/if}
                {#if createProgress?.state === "estimating"}
                    <p class="text-muted-foreground type-caption mt-sm">
                        Preparing the download and checking storage…
                    </p>
                {:else if createProgress?.state === "fetching-package"}
                    <p class="text-muted-foreground type-caption mt-sm">
                        Downloaded {createProgress.problems} of {createProgress.totalProblems}
                        problems.
                    </p>
                    <progress
                        class="mt-2 w-full"
                        max={createProgress.totalProblems}
                        value={createProgress.problems}
                    ></progress>
                {:else if createProgress?.state === "failed" || createProgress?.state === "storage-full"}
                    <p class="text-destructive type-caption mt-sm">
                        {createProgress.message}
                    </p>
                {:else if createProgress?.state === "ready"}
                    <p class="text-primary type-caption mt-sm">
                        Downloaded and ready for offline use. It is listed below.
                    </p>
                {/if}
            </div>
            <Button
                class="mt-md"
                onclick={downloadSelectedScope}
                disabled={createProgress?.state === "estimating" || createProgress?.state === "fetching-package"}
            >
                {createProgress?.state === "estimating"
                    ? "Preparing download…"
                    : createProgress?.state === "fetching-package"
                      ? `Downloading ${createProgress.problems} of ${createProgress.totalProblems}…`
                      : createProgress?.state === "ready"
                        ? `Download another ${downloadAmount ?? ""} problems`
                        : `Download ${downloadAmount ?? ""} problems`}
            </Button>
        </section>
    {/if}
{/snippet}

<svelte:head>
    <title>{presentation?.title ?? "Offline"} · ProblemCloud</title>
    <meta name="robots" content="noindex" />
</svelte:head>

{#snippet presentationContent()}
{#if presentation?.kind === "practice" && practicePackageId}
    <OfflinePracticeRoute data={{} as never} packageId={practicePackageId} />
{:else if presentation?.kind === "library" && supabase}
    <div class="h-full overflow-y-auto bg-background text-foreground">
        <LibraryPage data={{ supabase } as never} />
    </div>
{:else if presentation?.kind === "practice"}
    <DownloadedPracticeRoute data={{} as never} requestedSessionId={practiceSessionId} />
{:else if presentation?.kind === "unavailable" || (presentation === null && requestedPath !== "/offline")}
    <div class="flex h-full items-center justify-center bg-background px-6 text-center text-foreground">
        <div class="max-w-lg">
            <p class="type-caption text-muted-foreground">{presentation?.title ?? requestedPath}</p>
            <h1 class="mt-2 text-xl font-semibold">This page needs a connection</h1>
            <p class="mt-2 type-secondary text-muted-foreground">The ProblemCloud frame is available, but this page’s data is held by the server. Your downloaded problems and unsynced Practice work are still safe.</p>
            <div class="mt-4 flex justify-center gap-2">
                <Button onclick={() => location.reload()}>Retry</Button>
                <Button variant="outline" href="/offline">Open downloads</Button>
            </div>
        </div>
    </div>
{:else}
<div
    class="bg-background text-foreground flex h-full flex-col overflow-y-auto"
>
    <header class="border-border/60 border-b">
        <div
            class="mx-auto flex h-16 w-full max-w-[720px] items-center gap-2 px-md"
        >
            <Icon
                name="cloud"
                fontsize="22px"
                class={offlineMode.isLocal ? "text-muted-foreground transition-colors" : "text-primary-foreground transition-colors"}
            />
            <span class="text-base font-semibold tracking-[-0.01em]"
                >ProblemCloud</span
            >
            <span class="ml-auto">
                <OfflineModeChip floating={false} />
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
                {online ? "You are online" : "You are offline"}{view.label
                    ? `, signed in as ${view.label}`
                    : ""}. Once a download finishes, it is available here without
                a connection.
            </p>
            {@render downloadForm()}
            {#if !online}
                <Button class="mt-md" onclick={refresh}>Check again</Button>
            {/if}
        {:else}
            <h1 class="text-xl font-semibold">Downloaded and ready</h1>
            <p class="text-muted-foreground type-secondary mt-sm">
                {online ? "You are online" : "You are offline"}{view.label
                    ? `, signed in as ${view.label}`
                    : ""}.
                These problem sets are stored on this device.
            </p>

            {@render downloadForm()}

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
                            {:else}
                                <span
                                    class="text-primary bg-primary/10 rounded-full px-2.5 py-1 text-xs whitespace-nowrap"
                                >
                                    Downloaded
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
                        {#if action?.packageId === manifest.packageId && action.progress.state === "fetching-package"}
                            <p class="text-muted-foreground type-caption mt-sm">Refreshing: {action.progress.problems} / {action.progress.totalProblems} problems</p>
                        {/if}
                        <div class="mt-sm flex gap-2">
                            <Button size="sm" onclick={() => launchPractice(manifest)}>
                                Practice offline
                            </Button>
                            {#if typeof navigator !== "undefined" && navigator.onLine}
                                <Button size="sm" variant="ghost" onclick={() => refreshPackage(manifest)}>Refresh</Button>
                            {/if}
                            <Button size="sm" variant="ghost" onclick={() => deletePackage(manifest)}>Delete</Button>
                        </div>
                    </li>
                {/each}
            </ul>

        {/if}
    </main>
</div>
{/if}
{/snippet}

{#if supabase}
    {#if embedded}
        {@render presentationContent()}
    {:else}
        <AppLayout data={{ supabase, session: null, user: null, profile: null, aiCoachEnabled: false } as never}>
            {@render presentationContent()}
        </AppLayout>
    {/if}
{:else}
    <div class="fixed inset-0 flex items-center justify-center bg-background text-muted-foreground">Opening ProblemCloud…</div>
{/if}
