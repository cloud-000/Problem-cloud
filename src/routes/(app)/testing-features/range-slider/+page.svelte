<script lang="ts">
    import { Icon } from "$lib/components/icon";
    import {
        RangeSlider,
        type RangeValue,
    } from "$lib/components/range-slider";

    // Default: push gap + stepped scale.
    let scoreValue = $state<RangeValue>([20, 80]);
    // Fine-grained: decimal step, custom formatting.
    let priceValue = $state<RangeValue>([2.5, 7.5]);
    // No tooltip, no labels via formatValue, larger push gap.
    let yearValue = $state<RangeValue>([2005, 2015]);
    // Disabled.
    let disabledValue = $state<RangeValue>([30, 60]);
</script>

<div class="space-y-8 p-6 max-w-4xl mx-auto">
    <!-- Header -->
    <div class="border-b border-border/80 pb-4 space-y-2">
        <a
            href="/testing-features"
            class="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
            ← Back to tests
        </a>
        <h1
            class="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-2"
        >
            <Icon name="tune" fontsize="2rem" class="text-primary-foreground" />
            Range Slider
        </h1>
        <p class="text-sm text-muted-foreground">
            Two-handle range slider — drag a handle, tap the track, or drag the
            filled bar. Handles push each other to keep a minimum gap.
        </p>
    </div>

    <!-- Variants -->
    <div
        class="border border-border/80 rounded-xl p-5 bg-surface-container-lowest shadow-xs space-y-8"
    >
        <h2 class="text-lg font-semibold text-foreground">Variants</h2>

        <div class="flex flex-col gap-2">
            <span
                class="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
                Score (0–100, step 5, push gap 10)
            </span>
            <RangeSlider
                bind:value={scoreValue}
                min={0}
                max={100}
                step={5}
                minGap={10}
                label="Score"
            />
            <code class="text-xs text-muted-foreground"
                >{JSON.stringify(scoreValue)}</code
            >
        </div>

        <div class="flex flex-col gap-2">
            <span
                class="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
                Price (0–10, step 0.5, currency format)
            </span>
            <RangeSlider
                bind:value={priceValue}
                min={0}
                max={10}
                step={0.5}
                minGap={1}
                label="Price"
                formatValue={(v) => `$${v.toFixed(2)}`}
            />
            <code class="text-xs text-muted-foreground"
                >{JSON.stringify(priceValue)}</code
            >
        </div>

        <div class="flex flex-col gap-2">
            <span
                class="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
                Year (2000–2025, no tooltip)
            </span>
            <RangeSlider
                bind:value={yearValue}
                min={2000}
                max={2025}
                step={1}
                minGap={1}
                showTooltip={false}
                label="Year"
                formatValue={(v) => String(v)}
            />
            <code class="text-xs text-muted-foreground"
                >{JSON.stringify(yearValue)}</code
            >
        </div>

        <div class="flex flex-col gap-2">
            <span
                class="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
                Disabled
            </span>
            <RangeSlider bind:value={disabledValue} min={0} max={100} disabled />
            <code class="text-xs text-muted-foreground"
                >{JSON.stringify(disabledValue)}</code
            >
        </div>
    </div>
</div>
