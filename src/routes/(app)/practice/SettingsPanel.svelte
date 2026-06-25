<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Combobox } from "$lib/components/combobox";
    import { Icon } from "$lib/components/icon";
    import { RangeSlider } from "$lib/components/range-slider";
    import {
        Switch,
        TriStateSwitch,
        type TriState,
    } from "$lib/components/toggle";
    import { DIFFICULTY_RANGE, TOPICS } from "$lib/library";
    import { fly } from "svelte/transition";

    let {
        topic = $bindable<string[]>([]),
        difficulty = $bindable<[number, number]>([...DIFFICULTY_RANGE]),
        verifiedOnly = $bindable(false),
        computational = $bindable<TriState>("neutral"),
        onClose,
    }: {
        topic: string[];
        difficulty: [number, number];
        verifiedOnly: boolean;
        computational: TriState;
        onClose?: () => void;
    } = $props();

    function computationalLabel(value: TriState) {
        if (value === "on") return "Computational";
        if (value === "off") return "Not computational";
        return "Any";
    }
</script>

<aside
    transition:fly={{ x: 30, duration: 200 }}
    class="w-full lg:w-72 shrink-0 flex flex-col gap-5 rounded-lg border border-border/50 bg-surface-container-lowest p-5 h-full overflow-y-auto lg:sticky lg:top-6 lg:border-y-0 lg:border-r-0 lg:rounded-none lg:bg-transparent lg:pl-6"
>
    <div class="flex items-center justify-between gap-3 border-b border-border/50 pb-3">
        <div>
            <h2 class="text-sm font-semibold">Settings</h2>
            <p class="text-[10px] text-muted-foreground">
                Applies to the next problem.
            </p>
        </div>
        <Button
            class="lg:hidden"
            variant="ghost"
            size="icon-xs"
            aria-label="Close settings"
            onclick={() => onClose?.()}
        >
            <Icon name="close" />
        </Button>
    </div>

    <div class="flex flex-col gap-2 border-b border-border/30 pb-4">
        <span class="text-xs font-medium text-muted-foreground">Topic</span>
        <Combobox
            bind:value={topic}
            options={TOPICS}
            strict
            placeholder="Any topic"
            inputPlaceholder="Add topic"
        />
    </div>

    <div class="flex flex-col gap-2 border-b border-border/30 pb-4">
        <span class="text-xs font-medium text-muted-foreground">
            Difficulty ({difficulty[0]}-{difficulty[1]})
        </span>
        <RangeSlider
            bind:value={difficulty}
            min={DIFFICULTY_RANGE[0]}
            max={DIFFICULTY_RANGE[1]}
            step={1}
            label="Difficulty"
        />
    </div>

    <div class="flex items-center justify-between gap-3">
        <div class="flex flex-col gap-0.5">
            <span class="text-xs font-medium text-muted-foreground">
                Verified only
            </span>
            <span class="text-[10px] text-muted-foreground">
                {verifiedOnly ? "Verified" : "Any"}
            </span>
        </div>
        <Switch bind:checked={verifiedOnly} size="sm" />
    </div>

    <div class="flex items-center justify-between gap-3">
        <div class="flex flex-col gap-0.5">
            <span class="text-xs font-medium text-muted-foreground">
                Computational
            </span>
            <span class="text-[10px] text-muted-foreground">
                {computationalLabel(computational)}
            </span>
        </div>
        <TriStateSwitch bind:value={computational} size="sm" />
    </div>

    <Button
        variant="outline"
        size="sm"
        class="w-full text-xs"
        onclick={() => {
            topic = [];
            difficulty = [...DIFFICULTY_RANGE];
            verifiedOnly = false;
            computational = "neutral";
        }}
    >
        Reset settings
    </Button>
</aside>
