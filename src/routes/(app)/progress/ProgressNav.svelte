<script lang="ts">
    import { resolve } from "$app/paths";
    import { cn } from "$lib/utils";

    export type ProgressView = "overview" | "review" | "matrix" | "history";

    let { active }: { active: ProgressView } = $props();

    const tabClass =
        "type-secondary -mb-px flex min-h-11 shrink-0 items-center border-b-2 px-px text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";
</script>

<nav
    aria-label="Progress views"
    class="flex min-w-0 gap-6 overflow-x-auto overflow-y-hidden border-b border-border"
>
    <a
        href={resolve("/progress")}
        aria-current={active === "overview" ? "page" : undefined}
        class={cn(tabClass, active === "overview" ? "border-foreground text-foreground" : "border-transparent")}
    >Overview</a>
    <a
        href={resolve("/progress?view=review")}
        aria-current={active === "review" ? "page" : undefined}
        class={cn(tabClass, active === "review" ? "border-foreground text-foreground" : "border-transparent")}
    >Review</a>
    <a
        href={resolve("/progress?view=matrix")}
        aria-current={active === "matrix" ? "page" : undefined}
        class={cn(tabClass, active === "matrix" ? "border-foreground text-foreground" : "border-transparent")}
    >Series matrix</a>
    <a
        href={resolve("/history")}
        aria-current={active === "history" ? "page" : undefined}
        class={cn(tabClass, active === "history" ? "border-foreground text-foreground" : "border-transparent")}
    >History</a>
</nav>
