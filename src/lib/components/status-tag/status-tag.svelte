<script lang="ts" module>
    import { cn } from "$lib/utils.js";
    import { type VariantProps, tv } from "tailwind-variants";

    export const statusTagVariants = tv({
        base: "inline-flex items-center rounded-full border font-semibold whitespace-nowrap select-none",
        variants: {
            tone: {
                correct: "bg-correct/10 text-correct border-correct/20",
                destructive:
                    "bg-destructive/15 text-destructive border-destructive/20",
                unsure: "bg-surface-container text-unsure border-border/50",
                neutral:
                    "bg-surface-container text-muted-foreground border-border/50",
                primary:
                    "bg-primary text-primary-foreground border-primary shadow-xs",
                accent: "bg-primary text-primary-foreground border-primary",
            },
            size: {
                sm: "gap-1 px-2 py-0.5 text-xs",
                md: "gap-1.5 px-2.5 py-1 text-xs",
            },
        },
        defaultVariants: { size: "md" },
    });

    export type StatusTagTone = NonNullable<
        VariantProps<typeof statusTagVariants>["tone"]
    >;
    export type StatusTagSize = VariantProps<typeof statusTagVariants>["size"];

    /** The reusable outcome/state kinds used across practice, history, and explore. */
    export type StatusKind =
        | "correct"
        | "incorrect"
        | "ungraded"
        | "skipped"
        | "solved"
        | "attempted"
        | "active"
        | "ended"
        | "review"
        | "new"
        | "unanswered"
        | "ungrouped";

    type Meta = {
        icon: string;
        fill: boolean;
        label: string;
        tone: StatusTagTone;
    };

    /** Icon + default label + tone per status. Single source of truth for the look. */
    export const STATUS_META: Record<StatusKind, Meta> = {
        correct: {
            icon: "check_circle",
            fill: true,
            label: "Correct",
            tone: "correct",
        },
        solved: {
            icon: "check_circle",
            fill: true,
            label: "Solved",
            tone: "correct",
        },
        incorrect: {
            icon: "cancel",
            fill: true,
            label: "Incorrect",
            tone: "destructive",
        },
        ungraded: {
            icon: "pending",
            fill: false,
            label: "Ungraded",
            tone: "neutral",
        },
        skipped: {
            icon: "skip_next",
            fill: false,
            label: "Skipped",
            tone: "unsure",
        },
        attempted: {
            icon: "history",
            fill: false,
            label: "Attempted",
            tone: "unsure",
        },
        active: {
            icon: "play_circle",
            fill: true,
            label: "Active",
            tone: "primary",
        },
        ended: {
            icon: "check_circle",
            fill: false,
            label: "Ended",
            tone: "neutral",
        },
        review: {
            icon: "history",
            fill: false,
            label: "Review",
            tone: "accent",
        },
        new: {
            icon: "auto_awesome",
            fill: false,
            label: "New",
            tone: "neutral",
        },
        unanswered: {
            icon: "help",
            fill: false,
            label: "No answer",
            tone: "unsure",
        },
        ungrouped: {
            icon: "filter_none",
            fill: false,
            label: "Ungrouped",
            tone: "neutral",
        },
    };
</script>

<script lang="ts">
    import { Icon } from "$lib/components/icon";
    import type { HTMLAttributes } from "svelte/elements";

    /** An action the tag morphs into on hover/focus (e.g. a status that's also a button). */
    export type StatusTagAction = {
        label: string;
        icon: string;
        onclick: () => void;
    };

    let {
        status,
        label,
        size = "md",
        action,
        tone,
        icon = true,
        disabled = false,
        class: className,
        children,
        ...restProps
    }: {
        status: StatusKind;
        /** Override the default label text. */
        label?: string;
        size?: StatusTagSize;
        /**
         * When set, the tag becomes interactive: it shows the status at rest and
         * morphs into this action (icon + label, button styling) on hover/focus.
         */
        action?: StatusTagAction;
        /** Override the kind's default tone (e.g. a softer accent in a header). */
        tone?: StatusTagTone;
        /** Set false to render the label/children only, without the leading icon. */
        icon?: boolean;
        disabled?: boolean;
    } & HTMLAttributes<HTMLElement> = $props();

    let meta = $derived(STATUS_META[status]);
    let resolvedTone = $derived(tone ?? meta.tone);
    let iconSize = $derived(size === "sm" ? "1em" : "1.1em");
    let gapClass = $derived(size === "sm" ? "gap-1" : "gap-1.5");
</script>

{#if action}
    <!-- Interactive: status at rest, action on hover/focus. -->
    <button
        type="button"
        onclick={action.onclick}
        {disabled}
        aria-label={action.label}
        title={action.label}
        class={cn(
            statusTagVariants({ tone: resolvedTone, size }),
            "group cursor-pointer shadow-xs transition disabled:pointer-events-none",
            "hover:bg-primary hover:text-primary-foreground hover:border-primary hover:brightness-95 hover:shadow-sm",
            "focus-visible:bg-primary focus-visible:text-primary-foreground focus-visible:border-primary focus-visible:brightness-95 focus-visible:outline-none",
            className,
        )}
        {...restProps}
    >
        <!-- Resting: the status -->
        <span
            class={cn(
                "inline-flex items-center leading-none group-hover:hidden group-focus-visible:hidden",
                gapClass,
            )}
        >
            {#if icon}
                <Icon
                    name={meta.icon}
                    fill={meta.fill}
                    fontsize={iconSize}
                    class="shrink-0 leading-none"
                />
            {/if}
            {label ?? meta.label}
        </span>
        <!-- Hover/focus: the action -->
        <span
            class={cn(
                "hidden items-center leading-none group-hover:inline-flex group-focus-visible:inline-flex",
                gapClass,
            )}
        >
            <Icon
                name={action.icon}
                fontsize={iconSize}
                class="shrink-0 leading-none"
            />
            {action.label}
        </span>
    </button>
{:else}
    <span
        class={cn(statusTagVariants({ tone: resolvedTone, size }), className)}
        {...restProps}
    >
        {#if icon}
            <Icon
                name={meta.icon}
                fill={meta.fill}
                fontsize={iconSize}
                class="shrink-0 leading-none"
            />
        {/if}
        {#if children}{@render children()}{:else}{label ?? meta.label}{/if}
    </span>
{/if}
