<script lang="ts">
    import { Icon } from "$lib/components/icon";

    const cards = [
        {
            icon: "notifications",
            name: "Toast",
            description: "Notification toasts across all severities.",
            href: "/testing-features/toast",
        },
        {
            icon: "checklist",
            name: "Combobox",
            description: "Multi-select hybrid combobox variants.",
            href: "/testing-features/combobox",
        },
        {
            icon: "functions",
            name: "LaTeX",
            description: "BBCode + LaTeX + Asymptote rendering.",
            href: "/testing-features/latex",
        },
    ];
</script>

<div class="space-y-8 p-6 max-w-4xl mx-auto">
    <!-- Header -->
    <div class="border-b border-border/80 pb-4">
        <h1
            class="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-2"
        >
            <Icon name="labs" fontsize="2rem" class="text-primary-foreground" />
            Feature Tests
        </h1>
        <p class="text-sm text-muted-foreground mt-1">
            Pick a component to open its dedicated test page.
        </p>
    </div>

    <!-- Cards -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        {#each cards as card}
            <a
                href={card.href}
                class="border border-border/80 rounded-xl p-5 bg-surface-container-lowest shadow-xs hover:bg-surface-container transition-colors flex flex-col gap-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
                <Icon name={card.icon} fontsize="1.75rem" class="text-primary-foreground" />
                <span class="text-lg font-semibold text-foreground"
                    >{card.name}</span
                >
                <span class="text-sm text-muted-foreground"
                    >{card.description}</span
                >
            </a>
        {/each}
    </div>
</div>
