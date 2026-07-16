<script lang="ts">
    import { Icon } from "$lib/components/icon";
    import type { ConversationSummary } from "$lib/ai/types";
    import { cn } from "$lib/utils";

    interface Props {
        conversation: ConversationSummary;
        active?: boolean;
        loading?: boolean;
        /** Set while a response streams; selection and archiving are unsafe until it stops. */
        disabled?: boolean;
        disabledReason?: string;
        onselect: (id: string) => void;
        onarchive: (id: string) => void;
    }

    let {
        conversation,
        active = false,
        loading = false,
        disabled = false,
        disabledReason,
        onselect,
        onarchive,
    }: Props = $props();

    let menuOpen = $state(false);

    function closeMenu(event: KeyboardEvent) {
        if (!menuOpen || event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        menuOpen = false;
    }

    function archive() {
        menuOpen = false;
        onarchive(conversation.id);
    }

    const updatedLabel = $derived(formatUpdated(conversation.updatedAt));

    function formatUpdated(value: string): string {
        const updated = new Date(value);
        if (Number.isNaN(updated.getTime())) return "";
        const now = new Date();
        const sameDay = updated.toDateString() === now.toDateString();
        return sameDay
            ? updated.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
            : updated.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    }
</script>

<svelte:window onkeydown={closeMenu} />

<div class="group relative">
    <button
        type="button"
        class={cn(
            "flex w-full flex-col gap-0.5 rounded-lg py-2 pl-2.5 pr-9 text-left transition-colors",
            "hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
            active && "bg-surface-container",
            disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
        )}
        aria-current={active ? "true" : undefined}
        disabled={disabled || loading}
        title={disabled ? disabledReason : undefined}
        onclick={() => onselect(conversation.id)}
    >
        <span class="flex w-full items-center gap-1.5">
            {#if active}
                <span class="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true"></span>
            {/if}
            <span class="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                {conversation.title}
            </span>
            {#if loading}
                <Icon name="progress_activity" fontsize={14} class="shrink-0 animate-spin text-muted-foreground" />
            {:else}
                <span class="shrink-0 text-[0.6875rem] text-muted-foreground">{updatedLabel}</span>
            {/if}
        </span>
        {#if conversation.preview}
            <span class="line-clamp-1 text-[0.6875rem] leading-4 text-muted-foreground">
                {conversation.preview}
            </span>
        {/if}
        {#if active}
            <span class="sr-only">Current conversation</span>
        {/if}
    </button>

    <button
        type="button"
        class={cn(
            "absolute right-1 top-1.5 flex size-6 items-center justify-center rounded-md text-muted-foreground",
            "opacity-0 transition-opacity hover:bg-surface-container-high hover:text-foreground",
            "group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-primary",
            menuOpen && "opacity-100",
            disabled && "hidden",
        )}
        aria-label="Conversation options"
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        disabled={disabled}
        onclick={() => (menuOpen = !menuOpen)}
    >
        <Icon name="more_horiz" fontsize={16} />
    </button>

    {#if menuOpen}
        <div
            class="absolute right-1 top-8 z-70 w-36 rounded-lg border border-border/70 bg-surface-container-lowest p-1 shadow-xl"
            role="menu"
        >
            <button
                type="button"
                class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground hover:bg-surface-container"
                role="menuitem"
                onclick={archive}
            >
                <Icon name="archive" fontsize={15} />
                Archive
            </button>
        </div>
    {/if}
</div>
