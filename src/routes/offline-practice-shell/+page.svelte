<script lang="ts">
    import { onMount } from "svelte";
    import { dev } from "$app/environment";
    import { createBrowserClient } from "@supabase/ssr";
    import {
        PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        PUBLIC_SUPABASE_URL,
    } from "$env/static/public";
    import type { Database } from "$lib/types/database.types";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { ModalContainer } from "$lib/components/modal";
    import { ToastContainer } from "$lib/components/toast";
    import { UtilityPanel } from "$lib/components/utility-panel";
    import { offlineRepository } from "$lib/offline/browser";
    import { startForegroundOfflineSync } from "$lib/offline/sync";
    import { topbar } from "$lib/state/topbar.svelte";
    import OfflinePracticeRoute from "../(app)/practice/OfflinePracticeRoute.svelte";

    let packageId = $state<string | null>(null);
    let stopSync: (() => void) | null = null;
    // The offline branch reads only optional identity fields from PageData; its
    // actual data contract is the bound repository source below. Keep the
    // neutral document free of a fabricated Supabase/session object.
    const neutralPageData = {} as never;

    onMount(() => {
        const bootWindow = window as Window & { __pcOfflineRequestedUrl?: string | null };
        const requested = bootWindow.__pcOfflineRequestedUrl;
        const requestedUrl = new URL(requested ?? window.location.href, window.location.origin);
        packageId = requestedUrl.searchParams.get("offlinePackage");
        if (requested) {
            history.replaceState(
                history.state,
                "",
                requestedUrl.pathname + requestedUrl.search + requestedUrl.hash,
            );
            delete bootWindow.__pcOfflineRequestedUrl;
        }

        if (dev || import.meta.env.VITE_OFFLINE_E2E === "1") {
            void (async () => {
                const [{ offlineRepository: open }, fixtures, network] = await Promise.all([
                    import("$lib/offline/browser"),
                    import("$lib/offline/fixtures"),
                    import("$lib/offline/network"),
                ]);
                Object.assign(window, {
                    __pcOffline: { open, fixtures, network, refresh: async () => undefined },
                });
            })();
        }

        // Offline boot is local-only. Supabase is not even constructed until a
        // reconnect signal arrives; it is then used solely to validate the
        // owning account and flush the outbox. The mounted trainer remains
        // bound to its immutable local source throughout.
        const reconnect = async () => {
            if (!navigator.onLine || stopSync) return;
            const repository = await offlineRepository();
            const marker = await repository.getAccountMarker();
            if (!marker) return;
            const supabase = createBrowserClient<Database>(
                PUBLIC_SUPABASE_URL,
                PUBLIC_SUPABASE_PUBLISHABLE_KEY,
            );
            const { data, error } = await supabase.auth.getUser();
            if (error || data.user?.id !== marker.userId) return;
            stopSync = startForegroundOfflineSync({
                userId: marker.userId,
                label: marker.label,
                supabase,
            });
        };

        window.addEventListener("online", reconnect);
        void reconnect();
        return () => {
            window.removeEventListener("online", reconnect);
            stopSync?.();
            stopSync = null;
        };
    });
</script>

<svelte:head>
    <title>Offline Practice · ProblemCloud</title>
    <meta name="robots" content="noindex" />
</svelte:head>

<div class="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground">
    {#if topbar.visible}
        <div class="relative z-40 flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border/50 px-2 select-none">
            <div class="absolute inset-0 -z-10 bg-background"></div>
            {#if topbar.leftSnippet}{@render topbar.leftSnippet()}{/if}
            {#if topbar.rightSnippet}{@render topbar.rightSnippet()}{/if}
        </div>
    {/if}

    <div class="min-h-0 flex-1 overflow-hidden">
        {#if packageId}
            {#key packageId}
                <OfflinePracticeRoute data={neutralPageData} {packageId} />
            {/key}
        {:else}
            <div class="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
                <Icon name="error" class="text-destructive" fontsize={24} />
                <div class="max-w-lg">
                    <h1 class="text-base font-semibold">No download was selected</h1>
                    <p class="mt-1 text-xs text-muted-foreground">
                        Offline Practice opens only from an explicit downloaded package.
                    </p>
                </div>
                <Button href="/offline" size="sm" variant="outline">Back to downloads</Button>
            </div>
        {/if}
    </div>

    <UtilityPanel />
    <ToastContainer />
    <ModalContainer />
</div>
