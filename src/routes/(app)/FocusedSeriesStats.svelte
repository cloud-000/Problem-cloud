<script lang="ts">
    import { BreakdownRow } from "$lib/components/breakdown-row";
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
        />
    {/each}
</div>
