<script lang="ts" module>
    export interface CoachConversationListProps {
        /**
         * The "back to conversation" control. Present when the list *replaces* the
         * transcript (the panel, and the `/coach` page below its rail breakpoint);
         * absent when it is docked beside a transcript that never went away.
         */
        showBack?: boolean;
        class?: string;
    }
</script>

<script lang="ts">
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { groupConversations } from "$lib/ai/conversations";
    import { coach } from "$lib/state/coach.svelte";
    import { cn } from "$lib/utils";
    import CoachConversationRow from "./coach-conversation-row.svelte";

    let { showBack = true, class: className }: CoachConversationListProps = $props();

    const STREAMING_HINT = "Stop the response before switching conversations.";

    const groups = $derived(groupConversations(coach.conversations));

    const showEmpty = $derived(
        coach.conversationsLoaded &&
            coach.conversations.length === 0 &&
            !coach.conversationListLoading &&
            !coach.conversationListError,
    );
    const showInitialLoading = $derived(coach.conversationListLoading && !coach.conversationsLoaded);
</script>

<div class={cn("flex min-h-0 flex-1 flex-col", className)}>
    <div class="flex items-center gap-1 border-b border-border/40 px-3 py-2">
        {#if showBack}
            <Button variant="ghost" size="icon-sm" onclick={() => coach.closeConversationList()} aria-label="Back to conversation">
                <Icon name="arrow_back" fontsize={16} />
            </Button>
        {/if}
        <h3 class={cn("mr-auto text-sm font-semibold tracking-tight text-foreground", !showBack && "px-1.5")}>History</h3>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <Button
            variant="ghost"
            size="sm"
            class="mb-2 w-full justify-start gap-2 text-xs font-medium"
            onclick={() => coach.newConversation()}
        >
            <Icon name="add_comment" fontsize={16} />
            New conversation
        </Button>

        {#if !coach.historyEnabled}
            <p class="px-2.5 py-6 text-center text-xs leading-5 text-muted-foreground">
                Saved conversations are off. Turn on “Save conversations” to browse your history.
            </p>
        {:else if showInitialLoading}
            <p class="px-2.5 py-6 text-center text-xs text-muted-foreground" aria-live="polite">
                Loading conversations…
            </p>
        {:else if coach.conversationListError && coach.conversations.length === 0}
            <div class="px-2.5 py-6 text-center">
                <p class="text-xs leading-5 text-muted-foreground">
                    {coach.conversationListError.message}
                </p>
                <Button size="sm" variant="outline" class="mt-3 text-xs" onclick={() => coach.retryConversationList()}>
                    Try again
                </Button>
            </div>
        {:else if showEmpty}
            <p class="px-2.5 py-6 text-center text-xs leading-5 text-muted-foreground">
                No saved conversations yet. Your chats will appear here once you send a message.
            </p>
        {:else}
            {#if coach.streaming}
                <p class="mx-1 mb-2 rounded-md bg-surface-container px-2.5 py-1.5 text-xs leading-4 text-muted-foreground">
                    {STREAMING_HINT}
                </p>
            {/if}
            {#each groups as group (group.label)}
                <section class="mb-3">
                    <h4 class="px-2.5 py-1 text-xs font-medium tracking-wide text-muted-foreground">
                        {group.label}
                    </h4>
                    <ul class="flex flex-col gap-0.5">
                        {#each group.conversations as conversation (conversation.id)}
                            <li>
                                <CoachConversationRow
                                    {conversation}
                                    active={conversation.id === coach.conversationId}
                                    loading={coach.loadingConversationId === conversation.id}
                                    disabled={coach.streaming}
                                    disabledReason={STREAMING_HINT}
                                    onselect={(id) => coach.selectConversation(id)}
                                    onarchive={(id) => coach.archiveConversation(id)}
                                />
                            </li>
                        {/each}
                    </ul>
                </section>
            {/each}

            {#if coach.conversationListError}
                <p class="px-2.5 py-2 text-center text-xs leading-4 text-muted-foreground" role="status">
                    {coach.conversationListError.message}
                </p>
            {/if}

            {#if coach.conversationsCursor}
                <Button
                    variant="ghost"
                    size="sm"
                    class="w-full text-xs"
                    disabled={coach.conversationListLoading}
                    onclick={() => coach.loadMoreConversations()}
                >
                    {coach.conversationListLoading ? "Loading…" : "Load more"}
                </Button>
            {/if}
        {/if}
    </div>
</div>
