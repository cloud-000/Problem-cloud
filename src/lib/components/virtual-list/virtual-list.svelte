<script lang="ts" generics="Item">
    import {
        createVirtualizer,
        defaultRangeExtractor,
        type Range,
    } from "@tanstack/svelte-virtual";
    import type { Snippet } from "svelte";
    import { get } from "svelte/store";
    import { cn } from "$lib/utils";
    import {
        getAppScrollViewport,
        observeScrollOffset,
    } from "./context";

    let {
        items,
        getKey,
        estimateSize,
        item,
        overscan = 4,
        gap = 0,
        endThreshold = 4,
        onEndReached,
        resetKey,
        class: className,
        ariaLabel,
    }: {
        items: Item[];
        getKey: (item: Item, index: number) => string | number;
        estimateSize: (item: Item, index: number) => number;
        item: Snippet<[Item, number]>;
        overscan?: number;
        gap?: number;
        endThreshold?: number;
        onEndReached?: () => void;
        resetKey?: unknown;
        class?: string;
        ariaLabel?: string;
    } = $props();

    const viewport = getAppScrollViewport();
    let root = $state<HTMLElement | null>(null);
    let scrollMargin = $state(0);
    let focusedIndex = $state<number | null>(null);
    let lastEndNotificationCount = -1;
    let previousResetKey: unknown = Symbol("initial virtual list key");

    function rangeExtractor(range: Range): number[] {
        const indexes = defaultRangeExtractor(range);
        if (
            focusedIndex != null &&
            focusedIndex >= 0 &&
            focusedIndex < range.count &&
            !indexes.includes(focusedIndex)
        ) {
            indexes.push(focusedIndex);
            indexes.sort((a, b) => a - b);
        }
        return indexes;
    }

    const virtualizer = createVirtualizer<HTMLElement, HTMLElement>({
        count: 0,
        getScrollElement: viewport.getElement,
        estimateSize: () => 1,
        overscan: 1,
        rangeExtractor,
        useAnimationFrameWithResizeObserver: true,
    });

    $effect(() => {
        // TanStack may call the previous options between a prop update and this
        // effect. Close over one immutable array reference so an old `count`
        // can never index into a newer, shorter items array.
        const currentItems = items;
        const currentEstimateSize = estimateSize;
        const currentGetKey = getKey;
        get(virtualizer).setOptions({
            count: currentItems.length,
            estimateSize: (index) =>
                currentEstimateSize(currentItems[index], index),
            getItemKey: (index) => currentGetKey(currentItems[index], index),
            overscan,
            gap,
            scrollMargin,
            rangeExtractor,
            useAnimationFrameWithResizeObserver: true,
        });
    });

    $effect(() => {
        const element = root;
        const scrollElement = viewport.getElement();
        if (!element || !scrollElement) return;
        return observeScrollOffset(element, scrollElement, (offset) => {
            scrollMargin = offset;
        });
    });

    $effect(() => {
        const key = resetKey;
        if (Object.is(key, previousResetKey)) return;
        previousResetKey = key;
        lastEndNotificationCount = -1;
        const instance = get(virtualizer);
        instance.measure();
        queueMicrotask(() => instance.scrollToOffset(scrollMargin));
    });

    const virtualItems = $derived(
        $virtualizer
            .getVirtualItems()
            .filter((entry) => entry.index >= 0 && entry.index < items.length),
    );
    const totalSize = $derived($virtualizer.getTotalSize());

    $effect(() => {
        if (!onEndReached || items.length === 0) return;
        const lastIndex = virtualItems.at(-1)?.index ?? -1;
        if (
            lastIndex >= items.length - 1 - endThreshold &&
            lastEndNotificationCount !== items.length
        ) {
            lastEndNotificationCount = items.length;
            onEndReached();
        }
    });

    function measureElement(node: HTMLElement) {
        get(virtualizer).measureElement(node);
        return {
            destroy() {
                get(virtualizer).measureElement(null);
            },
        };
    }

    function handleFocusIn(event: FocusEvent) {
        const target = event.target as HTMLElement | null;
        const row = target?.closest<HTMLElement>("[data-virtual-row]");
        focusedIndex = row ? Number(row.dataset.index) : null;
    }

    function handleFocusOut(event: FocusEvent) {
        const next = event.relatedTarget as Node | null;
        if (!root?.contains(next)) focusedIndex = null;
    }
</script>

<div
    bind:this={root}
    role="list"
    aria-label={ariaLabel}
    class={cn("relative w-full", className)}
    style:height={`${totalSize}px`}
    onfocusin={handleFocusIn}
    onfocusout={handleFocusOut}
>
    {#each virtualItems as virtualItem (virtualItem.key)}
        {@const currentItem = items[virtualItem.index]}
        {#if currentItem !== undefined}
            <div
                data-virtual-row
                data-index={virtualItem.index}
                use:measureElement
                role="listitem"
                aria-posinset={virtualItem.index + 1}
                aria-setsize={items.length}
                class="absolute top-0 left-0 w-full hover:z-10 focus-within:z-10"
                style:top={`${virtualItem.start - scrollMargin}px`}
            >
                {@render item(currentItem, virtualItem.index)}
            </div>
        {/if}
    {/each}
</div>
