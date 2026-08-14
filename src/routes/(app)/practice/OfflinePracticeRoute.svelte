<script lang="ts">
    import { onMount } from "svelte";
    import type { PageData } from "./$types";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { offlineRepository } from "$lib/offline/browser";
    import {
        bindOfflinePracticePackage,
        type OfflinePracticeBinding,
    } from "$lib/offline/practice-binding";
    import PracticeView from "./PracticeView.svelte";

    let { data, packageId }: { data: PageData; packageId: string } = $props();
    let binding = $state<OfflinePracticeBinding | null>(null);
    let error = $state<string | null>(null);

    onMount(async () => {
        try {
            binding = await bindOfflinePracticePackage(
                await offlineRepository(),
                packageId,
                data.user?.id ?? null,
            );
        } catch (cause) {
            error = cause instanceof Error ? cause.message : String(cause);
        }
    });
</script>

{#if binding}
    <PracticeView
        {data}
        sessionParam={String(binding.manifest.sessionId)}
        trainerSource={binding.source}
        backHref="/offline"
    />
{:else if error}
    <div class="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <Icon name="error" class="text-destructive" fontsize={24} />
        <div class="max-w-lg">
            <h1 class="text-base font-semibold">Could not open this download</h1>
            <p class="mt-1 text-xs text-muted-foreground">{error}</p>
        </div>
        <Button href="/offline" size="sm" variant="outline">Back to downloads</Button>
    </div>
{:else}
    <div class="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
        <Icon name="progress_activity" class="animate-spin" />
        Opening downloaded practice…
    </div>
{/if}
