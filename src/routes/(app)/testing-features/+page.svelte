<script lang="ts">
    import { resolve } from "$app/paths";
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
            icon: "chat",
            name: "AI Chat",
            description:
                "Provider-neutral transcript, composer, streaming, and error states.",
            href: "/testing-features/ai-chat",
        },
        {
            icon: "functions",
            name: "LaTeX",
            description: "BBCode + LaTeX + Asymptote rendering.",
            href: "/testing-features/latex",
        },
        {
            icon: "visibility",
            name: "Hidden Text",
            description: "Click-to-reveal spoiler text with optional bound state.",
            href: "/testing-features/hidden-text",
        },
        {
            icon: "tune",
            name: "Range Slider",
            description: "Two-handle range slider with push behavior.",
            href: "/testing-features/range-slider",
        },
        {
            icon: "toggle_on",
            name: "Toggle & Switch",
            description: "Accessible toggle button and switch components.",
            href: "/testing-features/toggle",
        },
        {
            icon: "calendar_month",
            name: "Date Picker",
            description:
                "Timezone-safe calendar and range constraints selector.",
            href: "/testing-features/date-picker",
        },
        {
            icon: "data_usage",
            name: "Segment Bar",
            description:
                "Proportional segmented bar from a list of value/color sections.",
            href: "/testing-features/segment-bar",
        },
        {
            icon: "menu",
            name: "Dropdown Menu",
            description:
                "Recursive, boundary-aware dropdown menus with submenus.",
            href: "/testing-features/dropdown-menu",
        },
        {
            icon: "picture_in_picture",
            name: "Modal",
            description:
                "Premium dialog modals with custom sizes and keyboard control.",
            href: "/testing-features/modal",
        },
        {
            icon: "tab",
            name: "Subtabs",
            description:
                "Compound tabbed navigation with line, pill, and card variants.",
            href: "/testing-features/subtabs",
        },
        {
            icon: "insights",
            name: "Graph",
            description: "Responsive base SVG line graph canvas supporting custom overlays.",
            href: "/testing-features/graph",
        },
        {
            icon: "show_chart",
            name: "Rating Chart",
            description: "Glicko rating history line chart with RD confidence band.",
            href: "/testing-features/rating-chart",
        },
        {
            icon: "",
            name: "math edit",
            description: "Math editing & interactive block",
            href: "/testing-features/math-editor",
        },
        {
            icon: "countertops",
            name: "Rating Counter",
            description: "Animated Glicko rating counter with RPG change delta popups.",
            href: "/testing-features/rating-counter",
        },
        {
            icon: "bar_chart",
            name: "Rating Life Bar",
            description: "Dark Souls-style health bar mapping player rating outcomes.",
            href: "/testing-features/rating-life-bar",
        },
        {
            icon: "shapes",
            name: "Whiteboard",
            description: "A geometric whiteboard",
            href: "/testing-features/whiteboard"
        }
    ];
</script>

<div class="space-y-8">
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
        {#each cards as card (card.href)}
            <a
                href={resolve(card.href as "/")}
                class="border border-border/80 rounded-xl p-5 bg-surface-container-lowest shadow-xs hover:bg-surface-container transition-colors flex flex-col gap-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
                <Icon
                    name={card.icon}
                    fontsize="1.75rem"
                    class="text-primary-foreground"
                />
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
