<script lang="ts">
    import type { ComponentProps } from "svelte";
    import type { Pacing } from "#lib/test-timing.js";
    import { formatDuration } from "#lib/test-timing.js";
    import { Button } from "#lib/components/button/index.js";
    import { Icon } from "#lib/components/icon/index.js";
    import { Switch } from "#lib/components/toggle/index.js";
    import PracticeFilters from "./PracticeFilters.svelte";

    let {
        form = $bindable(), isTest = false, testName = null,
        timeLimitSeconds = null, pacing = null, strictTiming = true,
        onFocusModeChange, onClose, ...filters
    }: ComponentProps<typeof PracticeFilters> & {
        isTest?: boolean;
        testName?: string | null;
        timeLimitSeconds?: number | null;
        pacing?: Pacing | null;
        strictTiming?: boolean;
        onClose?: () => void;
    } = $props();
</script>

<div class="flex h-full min-h-0 flex-col bg-surface-container-lowest">
    <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overflow-x-hidden p-5 lg:px-6 lg:pb-6 [scrollbar-gutter:stable] [&>*]:shrink-0">
        <div class="flex items-center justify-between gap-3 border-b border-border/50 pb-3">
            <h2 class="text-sm font-semibold">{isTest ? "Test" : "Settings"}</h2>
            <Button variant="ghost" size="icon-xs" aria-label="Close settings" onclick={() => onClose?.()}><Icon name="close" /></Button>
        </div>
        {#if isTest}
            <div class="flex items-center justify-between gap-3">
                <span class="text-xs font-medium text-muted-foreground">Focus mode</span>
                <Switch checked={form.focusMode} onclick={() => { form.focusMode = !form.focusMode; onFocusModeChange?.(form.focusMode); }} size="sm" aria-label="Focus mode" />
            </div>
            <div class="flex flex-col gap-4">
                <div class="flex flex-col gap-1"><span class="text-xs font-medium text-muted-foreground">Test</span><span class="text-sm font-semibold">{testName ?? "Selected test"}</span></div>
                <div class="flex flex-col gap-1"><span class="text-xs font-medium text-muted-foreground">Time limit</span><span class="text-sm">{timeLimitSeconds == null ? "Unlimited" : `${Math.round(timeLimitSeconds / 60)} min`}</span></div>
                {#if pacing?.kind === "segmented"}
                    <div class="flex flex-col gap-1">
                        <span class="text-xs font-medium text-muted-foreground">Pacing</span>
                        <span class="text-sm">{pacing.segmentSize === 1 ? `${formatDuration(pacing.secondsPerSegment)} per problem` : `${formatDuration(pacing.secondsPerSegment)} per ${pacing.segmentSize}-problem segment`}</span>
                        <span class="text-xxs text-muted-foreground">{strictTiming ? "Strict — each segment locks at 0:00" : "Lenient — timer turns red, overrun allowed"}</span>
                    </div>
                {/if}
            </div>
        {:else}
            <PracticeFilters bind:form {onFocusModeChange} {...filters} />
        {/if}
    </div>
</div>
