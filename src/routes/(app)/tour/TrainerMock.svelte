<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { cn } from "$lib/utils";

    type Tool = "none" | "coach" | "whiteboard" | "settings";

    const choices = ["7", "8", "9", "10", "11"] as const;
    const letters = ["A", "B", "C", "D", "E"] as const;

    let tool = $state<Tool>("none");
    let picked = $state<number | null>(null);

    const toolCaption: Record<Tool, string> = {
        none: "Try Coach, whiteboard, or ··· for settings.",
        coach: "Coach is the sparkle in the top bar. Ask for a hint, not the answer.",
        whiteboard: "Whiteboard is the pencil. Scratch work stays next to the problem.",
        settings: "Settings live under ···. Tries, timer, and focus mode are here.",
    };

    function toggle(next: Tool) {
        tool = tool === next ? "none" : next;
    }
</script>

<div
    class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface-container-lowest"
>
    <div
        class="flex items-center gap-1 border-b border-border px-2 py-1.5"
        role="toolbar"
        aria-label="Practice tools"
    >
        <span
            class="mr-1 inline-flex size-8 items-center justify-center text-muted-foreground"
            aria-hidden="true"
        >
            <Icon name="arrow_back" />
        </span>
        <span class="min-w-0 flex-1 truncate type-caption text-foreground">
            Mixed practice
        </span>
        <span class="px-2 font-mono type-caption tabular-nums text-foreground">
            0:42
        </span>
        <Button
            variant="ghost"
            size="icon-sm"
            class={cn(
                "size-9 text-muted-foreground hover:text-foreground",
                tool === "coach" && "bg-muted text-foreground",
            )}
            aria-pressed={tool === "coach"}
            aria-label="Coach"
            title="Coach"
            onclick={() => toggle("coach")}
        >
            <Icon name="auto_awesome" fill={tool === "coach"} />
        </Button>
        <Button
            variant="ghost"
            size="icon-sm"
            class={cn(
                "size-9 text-muted-foreground hover:text-foreground",
                tool === "whiteboard" && "bg-muted text-foreground",
            )}
            aria-pressed={tool === "whiteboard"}
            aria-label="Whiteboard"
            title="Whiteboard"
            onclick={() => toggle("whiteboard")}
        >
            <Icon name="draw" fill={tool === "whiteboard"} />
        </Button>
        <Button
            variant="ghost"
            size="icon-sm"
            class={cn(
                "size-9 text-muted-foreground hover:text-foreground",
                tool === "settings" && "bg-muted text-foreground",
            )}
            aria-pressed={tool === "settings"}
            aria-label="More Practice options"
            title="More options · Settings"
            onclick={() => toggle("settings")}
        >
            <Icon name="more_horiz" />
        </Button>
    </div>

    <div class="flex min-h-0 flex-1">
        <div class="flex min-w-0 flex-1 flex-col overflow-y-auto px-4 py-3">
            <p class="type-secondary text-foreground">
                What is 2³ + 1?
            </p>
            <ul class="mt-3 flex flex-col gap-1.5">
                {#each choices as choice, index (choice)}
                    <li>
                        <button
                            type="button"
                            class={cn(
                                "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left type-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                                picked === index
                                    ? "border-foreground bg-muted/60 text-foreground"
                                    : "border-border bg-transparent text-foreground hover:bg-muted/40",
                            )}
                            aria-pressed={picked === index}
                            onclick={() =>
                                (picked = picked === index ? null : index)}
                        >
                            <span class="font-mono text-muted-foreground">
                                {letters[index]}.
                            </span>
                            {choice}
                        </button>
                    </li>
                {/each}
            </ul>
        </div>

        {#if tool === "coach"}
            <aside
                class="flex w-[42%] min-w-28 flex-col border-l border-border bg-surface-container-low p-3"
                aria-label="Sample Coach"
            >
                <p class="flex items-center gap-1.5 type-caption font-medium text-foreground">
                    <Icon name="auto_awesome" class="size-3.5" fill />
                    Coach
                </p>
                <p class="mt-2 type-caption text-muted-foreground">
                    Think about powers of two, then add one. I will not give the
                    answer unless you ask after you have tried.
                </p>
            </aside>
        {:else if tool === "whiteboard"}
            <aside
                class="flex w-[42%] min-w-28 flex-col border-l border-border bg-surface-container-low p-3"
                aria-label="Sample whiteboard"
            >
                <p class="flex items-center gap-1.5 type-caption font-medium text-foreground">
                    <Icon name="draw" class="size-3.5" fill />
                    Scratch paper
                </p>
                <div
                    class="mt-2 min-h-20 flex-1 rounded-md border border-dashed border-border bg-surface-container-lowest"
                    aria-hidden="true"
                ></div>
            </aside>
        {:else if tool === "settings"}
            <aside
                class="flex w-[42%] min-w-28 flex-col border-l border-border bg-surface-container-low p-3"
                aria-label="Sample settings"
            >
                <p class="flex items-center gap-1.5 type-caption font-medium text-foreground">
                    <Icon name="tune" class="size-3.5" />
                    Settings
                </p>
                <ul class="mt-2 flex flex-col gap-1.5 type-caption text-muted-foreground">
                    <li>Tries per problem</li>
                    <li>Timer</li>
                    <li>Focus mode</li>
                </ul>
            </aside>
        {/if}
    </div>

    <p class="border-t border-border px-3 py-2 type-caption text-muted-foreground">
        {toolCaption[tool]}
    </p>
</div>
