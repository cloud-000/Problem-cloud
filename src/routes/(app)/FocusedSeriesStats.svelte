<script lang="ts">
    import { resolve } from "$app/paths";
    import { Button } from "$lib/components/button";
    import { BreakdownRow } from "$lib/components/breakdown-row";
    import { Icon } from "$lib/components/icon";
    import type { ProblemStateSummary } from "$lib/progress";

    type Entry = {
        seriesId: number;
        name: string;
        summary: ProblemStateSummary;
    };

    let { entries }: { entries: Entry[] } = $props();

    /** Of problems attempted at least once, the share now rated confident. */
    function masteryScore(summary: ProblemStateSummary): number | null {
        const attempted = summary.total - summary.unseen;
        return attempted > 0 ? summary.confident / attempted : null;
    }

    function plural(value: number, singular: string, pluralForm = `${singular}s`) {
        return value === 1 ? singular : pluralForm;
    }

    function matrixHref(seriesId: number) {
        return `${resolve("/progress")}?view=matrix&series=${seriesId}`;
    }
</script>

<div class="flex flex-col gap-2">
    {#each entries as entry (entry.seriesId)}
        <BreakdownRow
            label={entry.name}
            sublabel={`${entry.summary.total} ${plural(entry.summary.total, "problem")}`}
            score={masteryScore(entry.summary)}
            scoreLabel="confident"
            metrics={[
                { label: "due", value: String(entry.summary.review_due) },
                { label: "needs work", value: String(entry.summary.needs_work) },
            ]}
        >
            {#snippet action()}
                <Button
                    href={matrixHref(entry.seriesId)}
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Open ${entry.name} in the series matrix`}
                >
                    <Icon name="arrow_forward" />
                </Button>
            {/snippet}
        </BreakdownRow>
    {/each}
</div>
