<script lang="ts">
    import { Icon } from "$lib/components/icon";
    import Track from "../../(app)/practice/Track.svelte";
    import {
        WELCOME_SERIES_OPTIONS,
        initialWelcomeTrack,
        loadWelcomeSeriesDimensions,
        loadWelcomeSeriesNumberLine,
        loadWelcomeSeriesYearSpan,
    } from "./welcome-filters";

    /**
     * A self-contained filter mock for the public splash. The real practice
     * Track (topic / series comboboxes, per-series division, format, numbers,
     * years) with a sample vocabulary so a visitor can slice without an
     * account.
     */
    let track = $state(initialWelcomeTrack());
</script>

<div
    class="border-border bg-background w-full max-w-[32rem] overflow-visible rounded-xl border"
    role="region"
    aria-label="Sample catalog filters"
>
    <div
        class="border-border/60 flex items-center justify-between gap-sm border-b px-md py-sm"
    >
        <div class="flex items-center gap-2">
            <Icon
                name="tune"
                fontsize="16px"
                class="text-muted-foreground"
            />
            <span class="type-caption text-foreground">Filters</span>
        </div>
        <span class="type-caption text-muted-foreground">Sample</span>
    </div>
    <div class="p-md">
        <Track
            bind:value={track}
            seriesOptions={WELCOME_SERIES_OPTIONS}
            loadSeriesDimensions={loadWelcomeSeriesDimensions}
            loadSeriesNumberLine={loadWelcomeSeriesNumberLine}
            loadSeriesYearSpan={loadWelcomeSeriesYearSpan}
        />
    </div>
</div>
