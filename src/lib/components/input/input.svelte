<script lang="ts">
    import type {
        HTMLInputAttributes,
        HTMLInputTypeAttribute,
    } from "svelte/elements";
    import { Icon } from "$lib/components/icon";
    import { cn, type WithElementRef } from "$lib/utils.js";
    type InputType = Exclude<HTMLInputTypeAttribute, "file">;
    type Props = WithElementRef<
        Omit<HTMLInputAttributes, "type"> &
            (
                | { type: "file"; files?: FileList; revealable?: never }
                | { type?: InputType; files?: undefined; revealable?: boolean }
            )
    >;
    let {
        ref = $bindable(null),
        value = $bindable(),
        type,
        files = $bindable(),
        revealable,
        class: className,
        "data-slot": dataSlot = "input",
        ...restProps
    }: Props = $props();

    const fieldClass =
        "dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 h-9 rounded-md border bg-transparent px-2.5 py-1 text-base shadow-xs transition-[color,box-shadow] file:h-7 file:text-sm file:font-medium focus-visible:ring-3 aria-invalid:ring-3 md:text-sm file:text-foreground placeholder:text-muted-foreground w-full min-w-0 outline-none file:inline-flex file:border-0 file:bg-transparent disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50";

    let revealed = $state(false);
    const canReveal = $derived(revealable ?? type === "password");
    const inputType = $derived(canReveal && revealed ? "text" : type);
</script>

{#if type === "file"}
    <input
        bind:this={ref}
        data-slot={dataSlot}
        class={cn(fieldClass, className)}
        type="file"
        bind:files
        bind:value
        {...restProps}
    />
{:else if canReveal}
    <div class="relative w-full">
        <input
            bind:this={ref}
            data-slot={dataSlot}
            class={cn(fieldClass, "pr-10", className)}
            type={inputType}
            bind:value
            {...restProps}
        />
        <button
            type="button"
            class="text-muted-foreground hover:text-foreground absolute top-1/2 right-1.5 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md"
            aria-label={revealed ? "Hide password" : "Show password"}
            aria-pressed={revealed}
            onclick={() => {
                revealed = !revealed;
            }}
        >
            <Icon name={revealed ? "visibility_off" : "visibility"} fontsize={18} />
        </button>
    </div>
{:else}
    <input
        bind:this={ref}
        data-slot={dataSlot}
        class={cn(fieldClass, className)}
        {type}
        bind:value
        {...restProps}
    />
{/if}
