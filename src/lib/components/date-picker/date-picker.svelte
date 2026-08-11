<script lang="ts" module>
    import { cn, type WithElementRef } from "$lib/utils.js";
    import type { HTMLAttributes } from "svelte/elements";

    export type DatePickerProps = WithElementRef<
        Omit<HTMLAttributes<HTMLDivElement>, "onchange" | "value">,
        HTMLDivElement
    > & {
        /** Selected date value in YYYY-MM-DD format */
        value?: string;
        /** Placeholder text when value is not selected */
        placeholder?: string;
        /** Disable the picker */
        disabled?: boolean;
        /** Minimum selectables date in YYYY-MM-DD format */
        min?: string;
        /** Maximum selectables date in YYYY-MM-DD format */
        max?: string;
        /** Callback when value changes */
        onchange?: (value: string) => void;
    };
</script>

<script lang="ts">
    import { Icon } from "$lib/components/icon/index.js";
    import { Select } from "$lib/components/select/index.js";

    let {
        ref = $bindable(null),
        class: className,
        value = $bindable(""),
        placeholder = "Select date...",
        disabled = false,
        min = undefined,
        max = undefined,
        onchange,
        ...restProps
    }: DatePickerProps = $props();

    // --- State ---
    let open = $state(false);
    let currentMonth = $state(new Date().getMonth());
    let currentYear = $state(new Date().getFullYear());
    let containerEl = $state<HTMLDivElement | null>(null);
    let calendarEl = $state<HTMLDivElement | null>(null);

    // The calendar is absolutely positioned, so inside a scrolling container (a
    // dialog body) it can open below the fold. Bring it into view on open, the
    // same courtesy Select does for its highlighted option.
    $effect(() => {
        if (open && calendarEl) {
            calendarEl.scrollIntoView({ block: "nearest" });
        }
    });

    // Sync calendar view month/year to selected value when the picker is opened or value is set
    $effect(() => {
        if (open && value) {
            const parsed = parseDateString(value);
            if (parsed) {
                currentMonth = parsed.getMonth();
                currentYear = parsed.getFullYear();
            }
        }
    });

    // --- Helper Functions ---
    function parseDateString(str: string): Date | null {
        if (!str) return null;
        const parts = str.split("-");
        if (parts.length !== 3) return null;
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1; // 0-based
        const day = parseInt(parts[2], 10);
        if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
        return new Date(year, month, day);
    }

    function formatDateString(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    // --- Derived Models ---
    const displayValue = $derived.by(() => {
        if (!value) return "";
        const parsed = parseDateString(value);
        if (!parsed) return value;
        return parsed.toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
        });
    });

    const MONTH_NAMES = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];

    const WEEK_DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

    const years = $derived.by(() => {
        const currentYearNum = new Date().getFullYear();
        const startYear = min ? parseDateString(min)?.getFullYear() ?? 1950 : 1950;
        const endYear = max ? parseDateString(max)?.getFullYear() ?? (currentYearNum + 10) : (currentYearNum + 10);
        const list = [];
        for (let y = Math.max(endYear, currentYearNum + 10); y >= Math.min(startYear, 1950); y--) {
            list.push(y);
        }
        return list;
    });

    function isDateDisabled(dateStr: string): boolean {
        if (min && dateStr < min) return true;
        if (max && dateStr > max) return true;
        return false;
    }

    const monthDays = $derived.by(() => {
        const firstDayIndex = new Date(currentYear, currentMonth, 1).getDay();
        const totalDays = new Date(currentYear, currentMonth + 1, 0).getDate();
        const prevMonthTotalDays = new Date(currentYear, currentMonth, 0).getDate();
        
        const days = [];
        const today = new Date();
        const todayStr = formatDateString(today);
        
        // Previous month trailing days
        for (let i = firstDayIndex - 1; i >= 0; i--) {
            const d = prevMonthTotalDays - i;
            const m = currentMonth === 0 ? 11 : currentMonth - 1;
            const y = currentMonth === 0 ? currentYear - 1 : currentYear;
            const dateStr = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
            days.push({
                day: d,
                month: m,
                year: y,
                isCurrentMonth: false,
                isToday: dateStr === todayStr,
                isSelected: value === dateStr,
                disabled: isDateDisabled(dateStr),
                dateString: dateStr,
            });
        }
        
        // Current month days
        for (let d = 1; d <= totalDays; d++) {
            const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
            days.push({
                day: d,
                month: currentMonth,
                year: currentYear,
                isCurrentMonth: true,
                isToday: dateStr === todayStr,
                isSelected: value === dateStr,
                disabled: isDateDisabled(dateStr),
                dateString: dateStr,
            });
        }
        
        // Next month trailing days
        const remainingCells = 42 - days.length;
        for (let d = 1; d <= remainingCells; d++) {
            const m = currentMonth === 11 ? 0 : currentMonth + 1;
            const y = currentMonth === 11 ? currentYear + 1 : currentYear;
            const dateStr = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
            days.push({
                day: d,
                month: m,
                year: y,
                isCurrentMonth: false,
                isToday: dateStr === todayStr,
                isSelected: value === dateStr,
                disabled: isDateDisabled(dateStr),
                dateString: dateStr,
            });
        }
        
        return days;
    });

    // --- Actions ---
    function prevMonth() {
        if (currentMonth === 0) {
            currentMonth = 11;
            currentYear -= 1;
        } else {
            currentMonth -= 1;
        }
    }

    // Adjust viewed year/month if either goes out of constraints
    $effect(() => {
        // Safe boundaries check
        if (currentYear < 1900) currentYear = 1900;
    });

    function nextMonth() {
        if (currentMonth === 11) {
            currentMonth = 0;
            currentYear += 1;
        } else {
            currentMonth += 1;
        }
    }

    function selectDate(dateStr: string) {
        value = dateStr;
        // Keep the calendar open on selection, per user request.
        onchange?.(dateStr);
        ref?.focus();
    }

    // Prevent direct date typing block / manual parsing on keyboard input if they click open

    function selectToday() {
        const today = new Date();
        const todayStr = formatDateString(today);
        if (!isDateDisabled(todayStr)) {
            selectDate(todayStr);
        }
    }

    function clearDate(e?: MouseEvent) {
        e?.stopPropagation();
        value = "";
        onchange?.("");
        ref?.focus();
    }

    function handleWindowClick(e: MouseEvent) {
        if (!open) return;
        const target = e.target as HTMLElement;
        // If the target element was removed from the DOM during click processing,
        // it was likely inside our component (e.g. Month/Year select options).
        if (target && !document.contains(target)) {
            return;
        }
        if (containerEl && !containerEl.contains(target)) {
            open = false;
        }
    }

    let currentMonthStr = $derived(String(currentMonth));
    let currentYearStr = $derived(String(currentYear));

    function handleMonthChange(val: string) {
        currentMonth = parseInt(val, 10);
    }

    function handleYearChange(val: string) {
        currentYear = parseInt(val, 10);
    }

    const monthSelectOptions = MONTH_NAMES.map((name, index) => ({
        value: String(index),
        label: name
    }));

    const yearSelectOptions = $derived(
        years.map(y => ({
            value: String(y),
            label: String(y)
        }))
    );

    function handleFocusOut(e: FocusEvent) {
        const next = e.relatedTarget;
        if (next instanceof Node) {
            if (containerEl && containerEl.contains(next)) {
                return;
            }
            open = false;
        }
        // If next is null, do NOT close here. The svelte:window click listener
        // will safely close on actual clicks outside, avoiding Safari focus loss bugs.
    }

    function handleKeydown(e: KeyboardEvent) {
        if (disabled) return;
        switch (e.key) {
            case "Escape":
                if (open) {
                    e.preventDefault();
                    open = false;
                    ref?.focus();
                }
                break;
            case "Enter":
            case " ":
                e.preventDefault();
                open = !open;
                break;
            case "Tab":
                open = false;
                break;
        }
    }
</script>

<svelte:window onclick={handleWindowClick} />

<!-- Outer wrapper container -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    bind:this={containerEl}
    class="relative w-full min-w-0"
    onfocusout={handleFocusOut}
>
    <div
        bind:this={ref}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-disabled={disabled ? "true" : undefined}
        tabindex={disabled ? -1 : 0}
        class={cn(
            "dark:bg-input/30 border-input focus:border-ring focus:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 h-9 rounded-md border bg-transparent px-2.5 py-1 text-sm shadow-xs transition-[color,box-shadow] focus:ring-3 aria-expanded:border-ring aria-expanded:ring-3 aria-expanded:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 outline-none flex items-center justify-between cursor-pointer w-full text-left select-none",
            className
        )}
        onclick={() => !disabled && (open = !open)}
        onkeydown={handleKeydown}
        {...restProps}
    >
        <div class="flex items-center gap-2 min-w-0 flex-1">
            <Icon fontsize={18} class="text-muted-foreground shrink-0">calendar_month</Icon>
            <span class="truncate" class:text-muted-foreground={!value}>
                {value ? displayValue : placeholder}
            </span>
        </div>

        <div class="flex items-center gap-1.5 shrink-0 pl-2">
            {#if value && !disabled}
                <button
                    type="button"
                    class="text-muted-foreground hover:text-foreground cursor-pointer rounded-full p-0.5 hover:bg-muted focus:outline-none focus:ring-1 focus:ring-ring shrink-0"
                    onclick={clearDate}
                    aria-label="Clear date"
                >
                    <Icon fontsize={14}>close</Icon>
                </button>
            {/if}

            <Icon
                fontsize={18}
                class={cn(
                    "transition-transform duration-200 text-muted-foreground origin-center shrink-0",
                    open && "rotate-180"
                )}
            >
                keyboard_arrow_down
            </Icon>
        </div>
    </div>

    {#if open}
        <div
            bind:this={calendarEl}
            role="dialog"
            aria-label="Calendar view"
            class="absolute top-full left-0 md:right-auto right-0 z-50 mt-1 w-[310px] rounded-md border border-border bg-surface-container-low p-3 shadow-md outline-none"
        >
            <!-- Header: Month and Year Selector -->
            <div class="flex items-center justify-between mb-3 gap-1">
                <button
                    type="button"
                    class="size-7 flex items-center justify-center rounded-md border border-border bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer disabled:pointer-events-none disabled:opacity-40 shrink-0"
                    onclick={prevMonth}
                    aria-label="Previous month"
                >
                    <Icon fontsize={18}>chevron_left</Icon>
                </button>

                <div class="flex items-center gap-1.5 min-w-0 flex-1 justify-center">
                    <!-- Month Selector Dropdown -->
                    <div class="w-[125px] shrink-0">
                        <Select
                            options={monthSelectOptions}
                            value={currentMonthStr}
                            onchange={handleMonthChange}
                            class="h-7 [&_button]:h-7 [&_button]:text-xs [&_button]:px-2 [&_button]:py-0"
                        />
                    </div>

                    <!-- Year Selector Dropdown -->
                    <div class="w-[95px] shrink-0">
                        <Select
                            options={yearSelectOptions}
                            value={currentYearStr}
                            onchange={handleYearChange}
                            class="h-7 [&_button]:h-7 [&_button]:text-xs [&_button]:px-2 [&_button]:py-0"
                        />
                    </div>
                </div>

                <button
                    type="button"
                    class="size-7 flex items-center justify-center rounded-md border border-border bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer disabled:pointer-events-none disabled:opacity-40 shrink-0"
                    onclick={nextMonth}
                    aria-label="Next month"
                >
                    <Icon fontsize={18}>chevron_right</Icon>
                </button>
            </div>

            <!-- Days of Week Row -->
            <div class="grid grid-cols-7 gap-1 text-center mb-1">
                {#each WEEK_DAYS as dayName}
                    <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground select-none">
                        {dayName}
                    </span>
                {/each}
            </div>

            <!-- Calendar Grid -->
            <div class="grid grid-cols-7 gap-1">
                {#each monthDays as cell}
                    <button
                        type="button"
                        disabled={cell.disabled}
                        class={cn(
                            "aspect-square flex items-center justify-center text-xs rounded-md transition-colors cursor-pointer select-none relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-medium",
                            cell.isCurrentMonth
                                ? "text-foreground hover:bg-muted"
                                : "text-muted-foreground/45 hover:bg-muted/40",
                            cell.isSelected && "bg-primary text-primary-foreground font-bold hover:bg-primary/95",
                            cell.isToday && !cell.isSelected && "border border-primary-foreground/50 dark:border-primary-foreground/30 text-foreground font-bold",
                            cell.disabled && "opacity-25 cursor-not-allowed pointer-events-none"
                        )}
                        onclick={() => selectDate(cell.dateString)}
                        aria-label={cell.dateString}
                    >
                        {cell.day}
                    </button>
                {/each}
            </div>

            <!-- Bottom Quick Actions Footer -->
            <div class="border-t border-border/40 pt-2 mt-2.5 flex items-center justify-between">
                <button
                    type="button"
                    disabled={isDateDisabled(formatDateString(new Date()))}
                    class="text-[11px] font-semibold text-primary-foreground hover:underline transition-all cursor-pointer disabled:opacity-30 disabled:pointer-events-none"
                    onclick={selectToday}
                >
                    Today
                </button>
                {#if value}
                    <button
                        type="button"
                        class="text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-all cursor-pointer"
                        onclick={() => clearDate()}
                    >
                        Clear
                    </button>
                {/if}
            </div>
        </div>
    {/if}
</div>
