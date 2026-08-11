<script lang="ts">
    import { Problem } from "$lib/components/problem";
    import type { ProblemRow } from "$lib/library";

    let { problem }: { problem: ProblemRow } = $props();
</script>

<!-- The modal title (set by `SeriesReviewPanel.openProblem`) already names the
     test and problem number, so this renders metadata only. The solution is
     collapsed rather than hidden: this is a review surface, not an attempt. -->
<Problem {problem} header="meta" solution="collapsed" isInstantFeedback />
