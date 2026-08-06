<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { coach } from "$lib/state/coach.svelte";
    import { cn } from "$lib/utils";

    interface Props {
        class?: string;
    }

    let { class: className }: Props = $props();

    let busy = $state(false);
    // Read once per render rather than through `coach.resumePrompt` everywhere: both
    // choices clear it, so a template reading it after the await would find null.
    let offered = $derived(coach.resumePrompt);

    /**
     * How long ago the thread was last written to. Coarse on purpose — the point is
     * "is this the conversation I was just having?", not a timestamp.
     */
    function idleLabel(lastActiveAt: string): string {
        const last = Date.parse(lastActiveAt);
        if (!Number.isFinite(last)) return "";
        const minutes = Math.max(0, Math.round((Date.now() - last) / 60_000));
        if (minutes < 1) return "just now";
        if (minutes < 60) return `${minutes} min ago`;
        const hours = Math.round(minutes / 60);
        return hours === 1 ? "an hour ago" : `${hours} hours ago`;
    }

    async function choose(resume: boolean) {
        if (busy) return;
        busy = true;
        try {
            if (resume) await coach.resumeWorkThread();
            else await coach.startNewWorkThread();
        } finally {
            busy = false;
        }
    }
</script>

{#if offered}
    <div
        class={cn(
            "flex flex-col gap-2.5 rounded-xl border border-outline-variant bg-surface-container-low p-3",
            className,
        )}
        role="group"
        aria-label="Resume Coach conversation"
    >
        <div class="flex items-start gap-2.5">
            <span
                class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-container text-muted-foreground"
            >
                <Icon name="history" fontsize={16} />
            </span>
            <div class="min-w-0 flex-1">
                <p class="text-xs font-medium text-foreground">
                    You were talking about this problem {idleLabel(offered.lastActiveAt)}
                </p>
                {#if offered.preview}
                    <p class="mt-0.5 truncate text-xs leading-5 text-muted-foreground">
                        {offered.preview}
                    </p>
                {/if}
            </div>
        </div>
        <div class="flex items-center gap-2 pl-9.5">
            <Button size="sm" class="text-xs" disabled={busy} onclick={() => choose(true)}>
                Continue
            </Button>
            <Button
                size="sm"
                variant="outline"
                class="text-xs"
                disabled={busy}
                onclick={() => choose(false)}
            >
                Start new chat
            </Button>
        </div>
    </div>
{/if}
