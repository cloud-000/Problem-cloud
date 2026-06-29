<script lang="ts">
    import {
        Toggle,
        Switch,
        TriStateSwitch,
        type TriState,
    } from "$lib/components/toggle";
    import { Icon } from "$lib/components/icon";

    // Toggle button state
    let isBold = $state(false);
    let isItalic = $state(false);
    let isUnderline = $state(false);

    let pressedDefault = $state(false);
    let pressedOutline = $state(false);
    let pressedGhost = $state(false);

    let sizeSm = $state(false);
    let sizeMd = $state(false);
    let sizeLg = $state(false);

    // Switch state
    let switchChecked1 = $state(true);
    let switchChecked2 = $state(false);

    let switchSizeSm = $state(false);
    let switchSizeMd = $state(true);
    let switchSizeLg = $state(false);

    // Colored switches
    let algebraChecked = $state(true);
    let combinatoricsChecked = $state(true);
    let geometryChecked = $state(true);
    let numberTheoryChecked = $state(true);

    // Tri-State states
    let triStateVal = $state<TriState>("neutral");
    let triStateSm = $state<TriState>("off");
    let triStateLg = $state<TriState>("on");

    // Settings example
    let emailNotifications = $state(true);
    let pushNotifications = $state(false);
    let weeklyDigest = $state(true);
    let devMode = $state(false);
</script>

<div class="space-y-8 pb-12">
    <!-- Header -->
    <div
        class="border-b border-border/80 pb-4"
    >
        <h1
            class="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-2"
        >
            <Icon
                name="toggle_on"
                fontsize="2.25rem"
                class="text-primary-foreground"
            />
            Toggle & Switch Test Bench
        </h1>
        <p class="text-sm text-muted-foreground mt-1">
            Interactive playground to verify state bindings, sizes, and
            styling variants.
        </p>
    </div>

    <!-- Live Status Console -->
    <div
        class="bg-surface-container-lowest border border-border rounded-xl p-5 shadow-xs"
    >
        <h2
            class="text-base font-semibold text-foreground mb-3 flex items-center gap-2"
        >
            <Icon name="terminal" class="text-muted-foreground" />
            Live State Monitor
        </h2>
        <div
            class="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs font-mono bg-muted/30 p-4 rounded-lg border border-border/40"
        >
            <div>
                <span class="text-muted-foreground">Bold:</span>
                <span
                    class={isBold
                        ? "text-primary-foreground font-semibold"
                        : "text-foreground"}>{isBold}</span
                >
            </div>
            <div>
                <span class="text-muted-foreground">Italic:</span>
                <span
                    class={isItalic
                        ? "text-primary-foreground font-semibold"
                        : "text-foreground"}>{isItalic}</span
                >
            </div>
            <div>
                <span class="text-muted-foreground">Underline:</span>
                <span
                    class={isUnderline
                        ? "text-primary-foreground font-semibold"
                        : "text-foreground"}>{isUnderline}</span
                >
            </div>
            <div>
                <span class="text-muted-foreground">Switch 1:</span>
                <span
                    class={switchChecked1
                        ? "text-primary-foreground font-semibold"
                        : "text-foreground"}>{switchChecked1}</span
                >
            </div>
            <div>
                <span class="text-muted-foreground">Algebra:</span>
                <span
                    class={algebraChecked
                        ? "text-primary-foreground font-semibold"
                        : "text-foreground"}>{algebraChecked}</span
                >
            </div>
            <div>
                <span class="text-muted-foreground">Geometry:</span>
                <span
                    class={geometryChecked
                        ? "text-primary-foreground font-semibold"
                        : "text-foreground"}>{geometryChecked}</span
                >
            </div>
            <div>
                <span class="text-muted-foreground">Dev Mode:</span>
                <span
                    class={devMode
                        ? "text-primary-foreground font-semibold"
                        : "text-foreground"}>{devMode}</span
                >
            </div>
            <div>
                <span class="text-muted-foreground">Push-Notif:</span>
                <span
                    class={pushNotifications
                        ? "text-primary-foreground font-semibold"
                        : "text-foreground"}>{pushNotifications}</span
                >
            </div>
            <div>
                <span class="text-muted-foreground">Tri-State:</span>
                <span class="text-primary-foreground font-semibold"
                    >{triStateVal}</span
                >
            </div>
        </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
        <!-- Toggle Buttons Column -->
        <div class="space-y-8">
            <div
                class="border border-border/80 rounded-xl p-5 bg-surface-container-lowest shadow-xs space-y-4"
            >
                <h3
                    class="text-lg font-semibold text-foreground border-b border-border/50 pb-2"
                >
                    Toggle Button Variants
                </h3>

                <div class="space-y-3">
                    <p
                        class="text-xs text-muted-foreground uppercase font-semibold"
                    >
                        Format Toolbar Group
                    </p>
                    <div
                        class="flex items-center gap-1 border border-border p-1.5 rounded-lg bg-muted/10 w-fit"
                    >
                        <Toggle
                            bind:pressed={isBold}
                            aria-label="Toggle Bold"
                            title="Bold"
                        >
                            <Icon name="format_bold" />
                        </Toggle>
                        <Toggle
                            bind:pressed={isItalic}
                            aria-label="Toggle Italic"
                            title="Italic"
                        >
                            <Icon name="format_italic" />
                        </Toggle>
                        <Toggle
                            bind:pressed={isUnderline}
                            aria-label="Toggle Underline"
                            title="Underline"
                        >
                            <Icon name="format_underlined" />
                        </Toggle>
                    </div>
                </div>

                <div class="space-y-3">
                    <p
                        class="text-xs text-muted-foreground uppercase font-semibold"
                    >
                        Individual Styles
                    </p>
                    <div class="flex flex-wrap gap-3">
                        <Toggle variant="default" bind:pressed={pressedDefault}>
                            Default Variant
                        </Toggle>
                        <Toggle variant="outline" bind:pressed={pressedOutline}>
                            Outline Variant
                        </Toggle>
                        <Toggle variant="ghost" bind:pressed={pressedGhost}>
                            Ghost Variant
                        </Toggle>
                    </div>
                </div>

                <div class="space-y-3">
                    <p
                        class="text-xs text-muted-foreground uppercase font-semibold"
                    >
                        Sizes
                    </p>
                    <div class="flex flex-wrap items-center gap-3">
                        <Toggle size="sm" bind:pressed={sizeSm}
                            >Small (sm)</Toggle
                        >
                        <Toggle size="default" bind:pressed={sizeMd}
                            >Default (md)</Toggle
                        >
                        <Toggle size="lg" bind:pressed={sizeLg}
                            >Large (lg)</Toggle
                        >
                    </div>
                </div>

                <div class="space-y-3">
                    <p
                        class="text-xs text-muted-foreground uppercase font-semibold"
                    >
                        States & Disabled
                    </p>
                    <div class="flex flex-wrap gap-3">
                        <Toggle disabled>Disabled Unpressed</Toggle>
                        <Toggle disabled pressed>Disabled Pressed</Toggle>
                    </div>
                </div>
            </div>
        </div>

        <!-- Toggle Switch Column -->
        <div class="space-y-8">
            <div
                class="border border-border/80 rounded-xl p-5 bg-surface-container-lowest shadow-xs space-y-4"
            >
                <h3
                    class="text-lg font-semibold text-foreground border-b border-border/50 pb-2"
                >
                    Toggle Switch Variants
                </h3>

                <div class="space-y-4">
                    <div class="flex items-center justify-between">
                        <div>
                            <p class="text-sm font-medium text-foreground">
                                Standard Switch
                            </p>
                            <p class="text-xs text-muted-foreground">
                                Default size slider
                            </p>
                        </div>
                        <Switch
                            bind:checked={switchChecked1}
                            aria-label="Standard Switch"
                        />
                    </div>

                    <div class="flex items-center justify-between">
                        <div>
                            <p class="text-sm font-medium text-foreground">
                                Initial Off Switch
                            </p>
                            <p class="text-xs text-muted-foreground">
                                Starts unchecked
                            </p>
                        </div>
                        <Switch
                            bind:checked={switchChecked2}
                            aria-label="Initial Off Switch"
                        />
                    </div>
                </div>

                <div class="space-y-3">
                    <p
                        class="text-xs text-muted-foreground uppercase font-semibold"
                    >
                        Sizes
                    </p>
                    <div
                        class="flex flex-wrap items-center gap-6 bg-muted/10 p-3 rounded-lg border border-border/40"
                    >
                        <div class="flex items-center gap-2">
                            <Switch
                                size="sm"
                                bind:checked={switchSizeSm}
                                id="sw-sm"
                            />
                            <label
                                for="sw-sm"
                                class="text-xs font-medium text-muted-foreground"
                                >Small</label
                            >
                        </div>
                        <div class="flex items-center gap-2">
                            <Switch
                                size="default"
                                bind:checked={switchSizeMd}
                                id="sw-md"
                            />
                            <label
                                for="sw-md"
                                class="text-xs font-medium text-muted-foreground"
                                >Default</label
                            >
                        </div>
                        <div class="flex items-center gap-2">
                            <Switch
                                size="lg"
                                bind:checked={switchSizeLg}
                                id="sw-lg"
                            />
                            <label
                                for="sw-lg"
                                class="text-xs font-medium text-muted-foreground"
                                >Large</label
                            >
                        </div>
                    </div>
                </div>

                <div class="space-y-3">
                    <p
                        class="text-xs text-muted-foreground uppercase font-semibold"
                    >
                        States & Disabled
                    </p>
                    <div class="flex items-center gap-6">
                        <div class="flex items-center gap-2 opacity-60">
                            <Switch
                                disabled
                                checked={false}
                                aria-label="Disabled unchecked"
                            />
                            <span class="text-xs text-muted-foreground"
                                >Disabled Off</span
                            >
                        </div>
                        <div class="flex items-center gap-2 opacity-60">
                            <Switch
                                disabled
                                checked={true}
                                aria-label="Disabled checked"
                            />
                            <span class="text-xs text-muted-foreground"
                                >Disabled On</span
                            >
                        </div>
                    </div>
                </div>

                <div class="space-y-3">
                    <p
                        class="text-xs text-muted-foreground uppercase font-semibold"
                    >
                        Discipline Themed Accents
                    </p>
                    <div class="grid grid-cols-2 gap-4">
                        <div
                            class="flex items-center justify-between border border-border/40 p-2.5 rounded-lg"
                        >
                            <span
                                class="text-xs font-semibold text-indigo-600 dark:text-indigo-400"
                                >Algebra</span
                            >
                            <Switch
                                bind:checked={algebraChecked}
                                class="data-[state=checked]:bg-[var(--algebra)] text-white"
                                aria-label="Algebra themed switch"
                            />
                        </div>
                        <div
                            class="flex items-center justify-between border border-border/40 p-2.5 rounded-lg"
                        >
                            <span
                                class="text-xs font-semibold text-pink-600 dark:text-pink-400"
                                >Combinatorics</span
                            >
                            <Switch
                                bind:checked={combinatoricsChecked}
                                class="data-[state=checked]:bg-[var(--combinatorics)] text-white"
                                aria-label="Combinatorics themed switch"
                            />
                        </div>
                        <div
                            class="flex items-center justify-between border border-border/40 p-2.5 rounded-lg"
                        >
                            <span
                                class="text-xs font-semibold text-teal-600 dark:text-teal-400"
                                >Geometry</span
                            >
                            <Switch
                                bind:checked={geometryChecked}
                                class="data-[state=checked]:bg-[var(--geometry)] text-white"
                                aria-label="Geometry themed switch"
                            />
                        </div>
                        <div
                            class="flex items-center justify-between border border-border/40 p-2.5 rounded-lg"
                        >
                            <span
                                class="text-xs font-semibold text-orange-600 dark:text-orange-400"
                                >Number Theory</span
                            >
                            <Switch
                                bind:checked={numberTheoryChecked}
                                class="data-[state=checked]:bg-[var(--number-theory)] text-white"
                                aria-label="Number Theory themed switch"
                            />
                        </div>
                    </div>
                </div>
            </div>

            <!-- Tri-State Switch Card -->
            <div
                class="border border-border/80 rounded-xl p-5 bg-surface-container-lowest shadow-xs space-y-4"
            >
                <h3
                    class="text-lg font-semibold text-foreground border-b border-border/50 pb-2 flex items-center gap-2"
                >
                    <Icon
                        name="looks_3"
                        fontsize="1.75rem"
                        class="text-primary-foreground"
                    />
                    Tri-State Switches
                </h3>
                <p class="text-xs text-muted-foreground">
                    Cycles between <strong>Off</strong>,
                    <strong>Neutral</strong>, and <strong>On</strong>. Features
                    custom micro-icons inside the thumb.
                </p>

                <div class="space-y-4">
                    <div class="flex items-center justify-between">
                        <div>
                            <p class="text-sm font-medium text-foreground">
                                Standard Tri-State
                            </p>
                            <p class="text-xs text-muted-foreground">
                                Current: <span
                                    class="font-semibold text-primary-foreground"
                                    >{triStateVal}</span
                                >
                            </p>
                        </div>
                        <TriStateSwitch
                            bind:value={triStateVal}
                            aria-label="Standard Tri-State"
                        />
                    </div>
                </div>

                <div class="space-y-3">
                    <p
                        class="text-xs text-muted-foreground uppercase font-semibold"
                    >
                        Sizes
                    </p>
                    <div
                        class="flex flex-wrap items-center gap-6 bg-muted/10 p-3 rounded-lg border border-border/40"
                    >
                        <div class="flex items-center gap-2">
                            <TriStateSwitch
                                size="sm"
                                bind:value={triStateSm}
                                id="tri-sm"
                            />
                            <label
                                for="tri-sm"
                                class="text-xs font-medium text-muted-foreground"
                                >Small</label
                            >
                        </div>
                        <div class="flex items-center gap-2">
                            <TriStateSwitch
                                size="default"
                                bind:value={triStateVal}
                                id="tri-md"
                            />
                            <label
                                for="tri-md"
                                class="text-xs font-medium text-muted-foreground"
                                >Default</label
                            >
                        </div>
                        <div class="flex items-center gap-2">
                            <TriStateSwitch
                                size="lg"
                                bind:value={triStateLg}
                                id="tri-lg"
                            />
                            <label
                                for="tri-lg"
                                class="text-xs font-medium text-muted-foreground"
                                >Large</label
                            >
                        </div>
                    </div>
                </div>

                <div class="space-y-3">
                    <p
                        class="text-xs text-muted-foreground uppercase font-semibold"
                    >
                        States & Disabled
                    </p>
                    <div class="flex items-center gap-6">
                        <div class="flex items-center gap-2 opacity-60">
                            <TriStateSwitch
                                disabled
                                value="off"
                                aria-label="Disabled off"
                            />
                            <span class="text-xs text-muted-foreground"
                                >Disabled Off</span
                            >
                        </div>
                        <div class="flex items-center gap-2 opacity-60">
                            <TriStateSwitch
                                disabled
                                value="neutral"
                                aria-label="Disabled neutral"
                            />
                            <span class="text-xs text-muted-foreground"
                                >Disabled Neutral</span
                            >
                        </div>
                        <div class="flex items-center gap-2 opacity-60">
                            <TriStateSwitch
                                disabled
                                value="on"
                                aria-label="Disabled on"
                            />
                            <span class="text-xs text-muted-foreground"
                                >Disabled On</span
                            >
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Application / Real-world mock settings panel -->
    <div
        class="border border-border/80 rounded-xl bg-surface-container-lowest shadow-xs overflow-hidden"
    >
        <div
            class="bg-muted/30 border-b border-border/80 px-6 py-4 flex items-center justify-between"
        >
            <div>
                <h3 class="text-lg font-semibold text-foreground">
                    User Preferences
                </h3>
                <p class="text-xs text-muted-foreground">
                    Demoing switches in a realistic settings form layout
                </p>
            </div>
            <Icon name="settings" class="text-muted-foreground" />
        </div>
        <div class="divide-y divide-border/60">
            <!-- Row 1 -->
            <div
                class="flex items-center justify-between px-6 py-4 hover:bg-muted/10 transition-colors"
            >
                <div class="space-y-0.5">
                    <label
                        for="email-notif"
                        class="text-sm font-medium text-foreground cursor-pointer"
                        >Email Notifications</label
                    >
                    <p class="text-xs text-muted-foreground">
                        Receive weekly math challenges and account updates.
                    </p>
                </div>
                <Switch bind:checked={emailNotifications} id="email-notif" />
            </div>
            <!-- Row 2 -->
            <div
                class="flex items-center justify-between px-6 py-4 hover:bg-muted/10 transition-colors"
            >
                <div class="space-y-0.5">
                    <label
                        for="push-notif"
                        class="text-sm font-medium text-foreground cursor-pointer"
                        >Push Notifications</label
                    >
                    <p class="text-xs text-muted-foreground">
                        Get instant alerts when someone likes your solutions.
                    </p>
                </div>
                <Switch bind:checked={pushNotifications} id="push-notif" />
            </div>
            <!-- Row 3 -->
            <div
                class="flex items-center justify-between px-6 py-4 hover:bg-muted/10 transition-colors"
            >
                <div class="space-y-0.5">
                    <label
                        for="weekly-digest"
                        class="text-sm font-medium text-foreground cursor-pointer"
                        >Weekly Digest</label
                    >
                    <p class="text-xs text-muted-foreground">
                        Summarize notifications into a single weekly email
                        digest.
                    </p>
                </div>
                <Switch bind:checked={weeklyDigest} id="weekly-digest" />
            </div>
            <!-- Row 4 -->
            <div
                class="flex items-center justify-between px-6 py-4 hover:bg-muted/10 transition-colors"
            >
                <div class="space-y-0.5">
                    <label
                        for="dev-mode"
                        class="text-sm font-medium text-foreground cursor-pointer"
                        >Developer Sandbox Mode</label
                    >
                    <p class="text-xs text-muted-foreground">
                        Expose advanced troubleshooting panel and debug views.
                    </p>
                </div>
                <Switch bind:checked={devMode} id="dev-mode" />
            </div>
        </div>
    </div>
</div>
