<script lang="ts">
    import { onMount } from "svelte";
    import { Button } from "$lib/components/button";
    import { Input } from "$lib/components/input";
    import { modal } from "$lib/state/modal.svelte";
    import { offlineRepository } from "$lib/offline/browser";
    import { downloadOfflinePackage, scopeFromSettings, type DownloadProgress } from "$lib/offline/download";
    import type { OfflinePackageCreatedV1 } from "$lib/offline/types";
    import type { PracticeSessionRow } from "$lib/sessions";
    import type { PracticeSettings } from "$lib/trainer";
    import {
        DOWNLOAD_DEFAULT_PROBLEMS,
        PACKAGE_MAX_CANONICALS,
    } from "$lib/offline/limits";

    let { userId, session, packageId, onDone }: {
        userId: string;
        session: PracticeSessionRow;
        packageId?: string;
        onDone?: () => void;
    } = $props();

    let progress = $state<DownloadProgress | null>(null);
    let problemLimit = $state<number | undefined>(DOWNLOAD_DEFAULT_PROBLEMS);
    let inputError = $state<string | null>(null);
    let estimate = $state<OfflinePackageCreatedV1 | null>(null);
    let requiredBytes = $state(0);
    let persistent = $state<boolean | null>(null);
    let resolveConfirmation = $state<((accepted: boolean) => void) | null>(null);
    let controller = new AbortController();
    let scope = $derived(scopeFromSettings(session.settings as unknown as PracticeSettings));

    function formatBytes(bytes: number) {
        return new Intl.NumberFormat(undefined, { style: "unit", unit: "megabyte", maximumFractionDigits: 1 }).format(bytes / 1024 / 1024);
    }

    function decide(accepted: boolean) {
        resolveConfirmation?.(accepted);
        resolveConfirmation = null;
        if (!accepted) modal.close();
    }

    function updateProgress(value: DownloadProgress) {
        progress = value;
        if (value.state === "ready") onDone?.();
    }

    async function startDownload() {
        if (
            problemLimit === undefined ||
            !Number.isInteger(problemLimit) ||
            problemLimit < 1 ||
            problemLimit > PACKAGE_MAX_CANONICALS
        ) {
            inputError = `Choose between 1 and ${PACKAGE_MAX_CANONICALS.toLocaleString()} problems.`;
            return;
        }
        inputError = null;
        progress = { state: "estimating" };
        try {
            await downloadOfflinePackage({
                repository: await offlineRepository(),
                userId,
                session,
                packageId,
                problemLimit,
                signal: controller.signal,
                onProgress: updateProgress,
                confirm: (created, bytes, granted) => {
                    estimate = created;
                    requiredBytes = bytes;
                    persistent = granted;
                    return new Promise<boolean>((resolve) => (resolveConfirmation = resolve));
                },
            });
        } catch {
            // Progress contains the durable, user-facing failure state.
        }
    }

    onMount(() => {
        return () => {
            decide(false);
            controller.abort();
        };
    });
</script>

{#if progress === null}
    <div class="space-y-3 text-sm">
        <p>
            Choose how many problems from this session's filters to store on this
            device. The online practice session remains unlimited.
        </p>
        <label class="flex flex-col gap-1">
            <span class="font-medium">Problems to download</span>
            <Input
                type="number"
                min="1"
                max={PACKAGE_MAX_CANONICALS}
                step="1"
                bind:value={problemLimit}
            />
        </label>
        {#if inputError}<p class="text-destructive">{inputError}</p>{/if}
        <div class="flex justify-end gap-2">
            <Button variant="ghost" onclick={() => modal.close()}>Cancel</Button>
            <Button variant="primary" onclick={startDownload}>
                Download {problemLimit ?? ""} problems
            </Button>
        </div>
    </div>
{:else if estimate && resolveConfirmation}
    <div class="space-y-3 text-sm">
        <p>{estimate.problemCount} problems and {estimate.assetCount} required images will use about {formatBytes(requiredBytes)} including the refresh safety copy.</p>
        <p class="text-muted-foreground">Scope: {scope.topic.length ? scope.topic.join(", ") : "all topics"}{scope.seriesIds.length ? ` · ${scope.seriesIds.length} series` : ""}.</p>
        <p class="text-warning-foreground">Answer keys are included in local browser storage so grading works without a connection.</p>
        {#if persistent === false}<p class="text-warning-foreground">This browser did not grant persistent storage, so it may evict the download when space is low.</p>{/if}
        <div class="flex justify-end gap-2">
            <Button variant="ghost" onclick={() => decide(false)}>Cancel</Button>
            <Button variant="primary" onclick={() => decide(true)}>Download</Button>
        </div>
    </div>
{:else if progress.state === "estimating"}
    <p class="text-muted-foreground text-sm" aria-live="polite">Preparing the download and checking storage…</p>
{:else if progress.state === "fetching-package"}
    <div class="space-y-2 text-sm">
        <p>Downloaded {progress.problems} of {progress.totalProblems} problems ({formatBytes(progress.bytes)}).</p>
        <progress class="w-full" max={progress.totalProblems} value={progress.problems}></progress>
        <Button variant="ghost" onclick={() => controller.abort()}>Cancel</Button>
    </div>
{:else if progress.state === "ready"}
    <div class="space-y-3 text-sm"><p>Downloaded and ready for offline use.</p><Button onclick={() => modal.close()}>Done</Button></div>
{:else}
    <div class="space-y-3 text-sm"><p class="text-destructive">{progress.message}</p><p>Your previous ready download and pending work were preserved.</p><Button onclick={() => modal.close()}>Close</Button></div>
{/if}
