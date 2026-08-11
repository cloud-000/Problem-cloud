<script lang="ts">
    import { cn } from "$lib/utils";
    import type { GoalProgressResult } from "$lib/goals";

    let {
        result,
        met = false,
        class: className,
    }: {
        /** null when the goal could not be evaluated — never rendered as zero. */
        result: GoalProgressResult | null;
        met?: boolean;
        class?: string;
    } = $props();

    // An unmeasurable window fills by its sample, not by its metric: it says how
    // close the number is to existing, which is the only honest thing to show
    // when the number itself does not exist yet (`docs/goals.md` §6).
    let fill = $derived.by(() => {
        if (!result) return 0;
        if (result.status === "insufficient_data") {
            const need = result.requiredSample ?? 0;
            if (need <= 0) return 0;
            return Math.min(100, ((result.sampleSize ?? 0) / need) * 100);
        }
        return result.percentToTarget;
    });
    let pending = $derived(result?.status === "insufficient_data");
</script>

<div
    class={cn("h-2 w-full overflow-hidden rounded-full bg-surface-container-high", className)}
    role="progressbar"
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.round(fill)}
>
    <div
        class={cn(
            "h-full rounded-full transition-[width] duration-300",
            met ? "bg-correct" : pending ? "bg-muted-foreground/50" : "bg-primary",
        )}
        style={`width: ${Math.max(fill > 0 ? 2 : 0, Math.min(100, fill))}%`}
    ></div>
</div>
