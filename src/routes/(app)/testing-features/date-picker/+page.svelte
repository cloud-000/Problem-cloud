<script lang="ts">
    import { DatePicker } from "$lib/components/date-picker";
    import { Icon } from "$lib/components/icon";

    // DatePicker states
    let dateDefault = $state("");
    let dateInitial = $state("2026-06-26");
    let dateDisabled = $state("2026-06-26");
    
    // Bounds restricted states
    let minDateConstraint = "2026-06-10";
    let maxDateConstraint = "2026-06-25";
    let dateBounded = $state("2026-06-15");

    // Range select state
    let rangeStart = $state("");
    let rangeEnd = $state("");

    // Callback event logs
    let eventLog = $state<string[]>([]);
    
    function logEvent(message: string) {
        const time = new Date().toLocaleTimeString("en-US", { hour12: false });
        eventLog = [`[${time}] ${message}`, ...eventLog.slice(0, 19)];
    }
</script>

<div class="space-y-8 pb-12">
    <!-- Header -->
    <div class="border-b border-border/80 pb-4">
        <h1 class="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-2">
            <Icon name="calendar_month" fontsize="2.25rem" class="text-primary-foreground" />
            DatePicker Test Bench
        </h1>
        <p class="text-sm text-muted-foreground mt-1">
            Interactive playground to verify date picker behaviors, bounds constraints, and value bindings.
        </p>
    </div>

    <!-- Live Status Console -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <!-- State Monitor -->
        <div class="bg-surface-container-lowest border border-border rounded-xl p-5 shadow-xs md:col-span-2 space-y-3">
            <h2 class="text-base font-semibold text-foreground flex items-center gap-2">
                <Icon name="terminal" class="text-muted-foreground" />
                Live State Monitor
            </h2>
            <div class="grid grid-cols-2 gap-4 text-xs font-mono bg-muted/30 p-4 rounded-lg border border-border/40">
                <div>
                    <span class="text-muted-foreground">Default:</span>
                    <span class="text-primary-foreground font-semibold ml-1">{dateDefault || '"" (empty)'}</span>
                </div>
                <div>
                    <span class="text-muted-foreground">Initial:</span>
                    <span class="text-primary-foreground font-semibold ml-1">{dateInitial}</span>
                </div>
                <div>
                    <span class="text-muted-foreground">Bounded (10th-25th):</span>
                    <span class="text-primary-foreground font-semibold ml-1">{dateBounded || '""'}</span>
                </div>
                <div>
                    <span class="text-muted-foreground">Disabled:</span>
                    <span class="text-primary-foreground font-semibold ml-1">{dateDisabled}</span>
                </div>
                <div>
                    <span class="text-muted-foreground">Range Start:</span>
                    <span class="text-primary-foreground font-semibold ml-1">{rangeStart || '""'}</span>
                </div>
                <div>
                    <span class="text-muted-foreground">Range End:</span>
                    <span class="text-primary-foreground font-semibold ml-1">{rangeEnd || '""'}</span>
                </div>
            </div>
        </div>

        <!-- Event Log -->
        <div class="bg-surface-container-lowest border border-border rounded-xl p-5 shadow-xs flex flex-col space-y-3">
            <h2 class="text-base font-semibold text-foreground flex items-center justify-between">
                <span class="flex items-center gap-2">
                    <Icon name="history" class="text-muted-foreground" />
                    Event Callback Log
                </span>
                {#if eventLog.length > 0}
                    <button type="button" onclick={() => eventLog = []} class="text-[10px] uppercase font-bold text-muted-foreground hover:text-foreground cursor-pointer">
                        Clear
                    </button>
                {/if}
            </h2>
            <div class="flex-1 min-h-[90px] max-h-[120px] overflow-y-auto text-[10px] font-mono bg-muted/30 p-3 rounded-lg border border-border/40 space-y-1">
                {#if eventLog.length === 0}
                    <span class="text-muted-foreground italic">No events logged yet. Change values to trigger updates.</span>
                {:else}
                    {#each eventLog as entry}
                        <div class="text-foreground truncate">{entry}</div>
                    {/each}
                {/if}
            </div>
        </div>
    </div>

    <!-- Playground Grid -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
        <!-- Left Column: Single Pickers -->
        <div class="space-y-8">
            <div class="border border-border/80 rounded-xl p-5 bg-surface-container-lowest shadow-xs space-y-6">
                <h3 class="text-lg font-semibold text-foreground border-b border-border/50 pb-2">
                    Single DatePicker Configurations
                </h3>

                <!-- Configuration 1: Default -->
                <div class="space-y-2">
                    <label for="picker-default" class="text-sm font-medium text-foreground">
                        Default Standalone Picker
                    </label>
                    <p class="text-xs text-muted-foreground">
                        Starts empty. Triggers live event callback when date selected.
                    </p>
                    <DatePicker
                        id="picker-default"
                        bind:value={dateDefault}
                        onchange={(val) => logEvent(`Default changed: "${val}"`)}
                    />
                </div>

                <!-- Configuration 2: Custom Placeholder and Initial Value -->
                <div class="space-y-2">
                    <label for="picker-init" class="text-sm font-medium text-foreground">
                        Custom Placeholder & Preselected Value
                    </label>
                    <p class="text-xs text-muted-foreground">
                        Starts preselected on 2026-06-26. Uses customized placeholder when cleared.
                    </p>
                    <DatePicker
                        id="picker-init"
                        bind:value={dateInitial}
                        placeholder="Choose a special date..."
                        onchange={(val) => logEvent(`Initial value changed: "${val}"`)}
                    />
                </div>

                <!-- Configuration 3: Disabled State -->
                <div class="space-y-2">
                    <label for="picker-disabled" class="text-sm font-medium text-foreground">
                        Disabled State
                    </label>
                    <p class="text-xs text-muted-foreground">
                        Interaction disabled, buttons cannot be triggered.
                    </p>
                    <DatePicker
                        id="picker-disabled"
                        bind:value={dateDisabled}
                        disabled={true}
                    />
                </div>
            </div>
        </div>

        <!-- Right Column: Date Constraints -->
        <div class="space-y-8">
            <div class="border border-border/80 rounded-xl p-5 bg-surface-container-lowest shadow-xs space-y-6">
                <h3 class="text-lg font-semibold text-foreground border-b border-border/50 pb-2">
                    Boundary & Range Constraints
                </h3>

                <!-- Bounded Picker -->
                <div class="space-y-2">
                    <label for="picker-bounded" class="text-sm font-medium text-foreground">
                        Hard Bounds constraints
                    </label>
                    <p class="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                        <span class="inline-block px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">Min: 2026-06-10</span>
                        <span class="inline-block px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">Max: 2026-06-25</span>
                    </p>
                    <DatePicker
                        id="picker-bounded"
                        bind:value={dateBounded}
                        min={minDateConstraint}
                        max={maxDateConstraint}
                        onchange={(val) => logEvent(`Bounded changed: "${val}"`)}
                    />
                </div>

                <!-- Linked Date Range Selection -->
                <div class="space-y-4 pt-2">
                    <div>
                        <h4 class="text-sm font-semibold text-foreground">Linked Range Selection</h4>
                        <p class="text-xs text-muted-foreground">
                            Selecting a Start Date dynamically enforces `min` constraint on the End Date. Vice-versa for `max`.
                        </p>
                    </div>

                    <div class="grid grid-cols-2 gap-4">
                        <div class="space-y-1.5">
                            <span class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Start Date</span>
                            <DatePicker
                                bind:value={rangeStart}
                                placeholder="From date..."
                                max={rangeEnd || undefined}
                                onchange={(val) => logEvent(`Range Start changed: "${val}"`)}
                            />
                        </div>
                        <div class="space-y-1.5">
                            <span class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">End Date</span>
                            <DatePicker
                                bind:value={rangeEnd}
                                placeholder="To date..."
                                min={rangeStart || undefined}
                                onchange={(val) => logEvent(`Range End changed: "${val}"`)}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>
