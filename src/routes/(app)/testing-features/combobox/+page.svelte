<script lang="ts">
    import { Icon } from "$lib/components/icon";
    import { Combobox, type Option } from "$lib/components/combobox";

    // Combobox demo state
    const topicOptions: Option[] = [
        { value: "algebra", label: "Algebra" },
        { value: "combinatorics", label: "Combinatorics" },
        { value: "geometry", label: "Geometry" },
        { value: "number-theory", label: "Number Theory" },
        { value: "calculus", label: "Calculus", disabled: true },
    ];
    let strictValue = $state<string[]>(["algebra"]);
    let nonStrictValue = $state<string[]>([]);
    let freestyleValue = $state<string[]>(["alice@example.com"]);
</script>

<div class="space-y-8">
    <!-- Header -->
    <div class="border-b border-border/80 pb-4 space-y-2">
        <h1
            class="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-2"
        >
            <Icon name="checklist" fontsize="2rem" class="text-primary-foreground" />
            Combobox
        </h1>
        <p class="text-sm text-muted-foreground">
            Multi-select hybrid combobox variants.
        </p>
    </div>

    <!-- Combobox demo -->
    <div
        class="border border-border/80 rounded-xl p-5 bg-surface-container-lowest shadow-xs space-y-5"
    >
        <h2 class="text-lg font-semibold text-foreground">
            Multi-Select Hybrid Combobox
        </h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div class="flex flex-col gap-2">
                <span
                    class="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                    Strict + list
                </span>
                <Combobox
                    options={topicOptions}
                    strict
                    bind:value={strictValue}
                    placeholder="Pick topics…"
                    inputPlaceholder="Add more…"
                />
                <code class="text-xs text-muted-foreground"
                    >{JSON.stringify(strictValue)}</code
                >
            </div>

            <div class="flex flex-col gap-2">
                <span
                    class="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                    Non-strict + list (Create rows)
                </span>
                <Combobox
                    options={topicOptions}
                    bind:value={nonStrictValue}
                    placeholder="Pick or create…"
                />
                <code class="text-xs text-muted-foreground"
                    >{JSON.stringify(nonStrictValue)}</code
                >
            </div>

            <div class="flex flex-col gap-2">
                <span
                    class="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                >
                    Freestyle (no list, comma to commit)
                </span>
                <Combobox
                    bind:value={freestyleValue}
                    placeholder="Type emails, comma to add…"
                />
                <code class="text-xs text-muted-foreground"
                    >{JSON.stringify(freestyleValue)}</code
                >
            </div>
        </div>
    </div>
</div>
