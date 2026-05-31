<script lang="ts">
    import X from "@lucide/svelte/icons/x";
    import { tick } from "svelte";
    import * as Command from "$lib/components/ui/command/index.js";
    import { Input } from "$lib/components/ui/input/.";
    interface itemType {
        value: any;
        label: string;
    }
    let {
        class: className = "",
        value = $bindable(""),
        items = [],
        placeholder = "Type Something",
        emptyMessage = "Nothing found :(",
    }: {
        class?: string;
        value?: string;
        items: itemType[];
        placeholder?: string;
        emptyMessage?: string;
    } = $props();

    let open = $state(false);
    let triggerRef = $state<HTMLInputElement>(null!);
    let listRef = $state<HTMLElement>(null!);
    let selectedValues: Array<any> = $state([]);
    let values = $derived(selectedValues.map((i) => i.value));
    let unselectValues = $derived(
        items.filter(
            (i) =>
                !values.includes(i.value) &&
                i.label.toLowerCase().includes(value.toLowerCase()),
        ),
    );

    function triggerDelete() {
        if (selectedValues.length > 0) {
            selectedValues.pop();
        }
    }
</script>

<div class={className}>
    <div
        class="box-border border flex flex-row combobox-select overflow-x-auto p-1"
    >
        <div class="flex flex-row w-fit gap-1 combobox-selection-wrapper">
            {#each selectedValues as selected}
                <div
                    class="whitespace-pre border flex flex-row justify-center items-center rounded-md bg-muted px-2 gap-1 combobox-item"
                >
                    <span> {selected.label} </span>
                    <button
                        class="combobox-item-close"
                        onclick={() => {
                            selectedValues.splice(
                                values.indexOf(selected.value),
                                1,
                            );
                        }}
                    >
                        <X size={16} />
                    </button>
                </div>
            {/each}
        </div>
        <div class="grow no-select min-w-[150px] h-full">
            <!-- <ChevronsUpDownIcon class="ms-2 size-4 shrink-0 opacity-50" /> -->
            <input
                bind:value
                onfocus={() => {
                    open = true;
                }}
                onblur={(e) => {
                    if (e.relatedTarget != listRef) {
                        open = false;
                    } else {
                        tick().then(() => triggerRef.focus());
                    }
                }}
                onkeydown={(e) => {
                    if (e.key === "Backspace") {
                        if (triggerRef.value === "") {
                            triggerDelete();
                        }
                    } else {
                        if (
                            e.key === "ArrowDown" ||
                            e.key === "ArrowUp" ||
                            e.key === "Enter"
                        ) {
                            e.preventDefault();
                            // Dispatch an identical event directly onto the command root
                            listRef.dispatchEvent(
                                new KeyboardEvent("keydown", {
                                    key: e.key,
                                    code: e.code,
                                    bubbles: true,
                                    cancelable: true,
                                }),
                            );
                        }
                    }
                }}
                bind:this={triggerRef}
                class="border-none w-full h-full"
                {placeholder}
            />
        </div>
    </div>
    <div class="p-0 {open ? '' : 'hidden'} combobox-popover">
        <Command.Root
            bind:ref={listRef}
            shouldFilter={false}
            class="border shadow-md"
        >
            <!-- <Command.Input placeholder="Search framework..." /> -->
            <Command.List class="rounded-none">
                <Command.Empty
                    class={unselectValues.length === 0 ? "" : "hidden"}
                    >{emptyMessage}</Command.Empty
                >
                <Command.Group>
                    {#each unselectValues as item}
                        <Command.Item
                            value={item.value}
                            onSelect={() => {
                                selectedValues.push(item);
                            }}
                            class="transition-colors duration-300 ease-in-out"
                        >
                            <!-- <CheckIcon
                                class={cn("me-2 size-4", "text-transparent")}
                            /> -->
                            {item.label}
                        </Command.Item>
                    {/each}
                </Command.Group>
            </Command.List>
        </Command.Root>
    </div>
</div>

<style>
    .combobox-select {
        border-radius: var(--radius);
        scrollbar-width: thin;
        align-items: center;
    }

    ::-webkit-scrollbar-thumb {
        background: blue;
        border-radius: 5px;
    }
    .combobox-selection-wrapper {
    }
    .combobox-popover {
    }
    .combobox-item {
        border-color: transparent;
        background-color: var(--color-muted);
        &:hover {
            /*border-color: var(--color-primary-foreground);*/
            background-color: var(--color-primary);
            color: var(--color-primary-foreground);
            opacity: 1;
            & > .combobox-item-close {
                opacity: 1;
            }
        }
        transition:
            background 0.2s ease,
            color 0.2s ease;
    }
    .combobox-item-close {
        color: var(--color-muted-foreground);
        opacity: 0.25;
        &:hover {
            color: var(--color-destructive);
        }
        transition:
            color 0.2s ease,
            opacity 0.3s ease-in-out;
    }
</style>
