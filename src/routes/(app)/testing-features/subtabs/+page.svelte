<script lang="ts">
    import { Subtabs } from "$lib/components/subtabs";
    import { Icon } from "$lib/components/icon";
    import { Input } from "$lib/components/input";

    // Bindings for active tabs
    let lineTab = $state("general");
    let pillTab = $state("algebra");
    let cardTab = $state("overview");
    let verticalTab = $state("step1");
    let mountTab = $state("tabA");

    // Dynamic state monitor trackers
    let inputValA = $state("");
    let inputValB = $state("");
</script>

<div class="space-y-8 p-6 max-w-4xl mx-auto pb-12">
    <!-- Header -->
    <div class="border-b border-border/80 pb-4 flex items-center justify-between">
        <div>
            <h1 class="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-2">
                <Icon name="tab" fontsize="2.25rem" class="text-primary-foreground" />
                Subtabs Test Bench
            </h1>
            <p class="text-sm text-muted-foreground mt-1">
                Verify compound tab layouts, keyboard navigation, keepMounted behavior, and styling variants.
            </p>
        </div>
        <a
            href="/testing-features"
            class="text-sm font-medium text-primary-foreground hover:underline flex items-center gap-1 border border-border rounded-md px-3 py-1.5 bg-surface-container-lowest shadow-xs hover:bg-surface-container transition-colors"
        >
            <Icon name="arrow_back" fontsize="1.1rem" />
            Back to Hub
        </a>
    </div>

    <!-- Live Status Console -->
    <div class="bg-surface-container-lowest border border-border rounded-xl p-5 shadow-xs">
        <h2 class="text-base font-semibold text-foreground mb-3 flex items-center gap-2">
            <Icon name="terminal" class="text-muted-foreground" />
            Live State Monitor
        </h2>
        <div class="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-5 gap-4 text-xs font-mono bg-muted/30 p-4 rounded-lg border border-border/40">
            <div>
                <span class="text-muted-foreground">Line Tab:</span>
                <span class="text-primary-foreground font-semibold ml-1">{lineTab}</span>
            </div>
            <div>
                <span class="text-muted-foreground">Pill Tab:</span>
                <span class="text-primary-foreground font-semibold ml-1">{pillTab}</span>
            </div>
            <div>
                <span class="text-muted-foreground">Card Tab:</span>
                <span class="text-primary-foreground font-semibold ml-1">{cardTab}</span>
            </div>
            <div>
                <span class="text-muted-foreground">Vertical Tab:</span>
                <span class="text-primary-foreground font-semibold ml-1">{verticalTab}</span>
            </div>
            <div>
                <span class="text-muted-foreground">Mount Tab:</span>
                <span class="text-primary-foreground font-semibold ml-1">{mountTab}</span>
            </div>
        </div>
    </div>

    <!-- 1. Line Variant Showcase (Horizontal) -->
    <div class="bg-surface-container-lowest border border-border rounded-xl p-6 shadow-xs space-y-6">
        <div>
            <h2 class="text-lg font-semibold text-foreground flex items-center gap-2">
                <Icon name="linear_scale" class="text-primary-foreground" />
                Line Underline Variant (Horizontal)
            </h2>
            <p class="text-xs text-muted-foreground mt-0.5">
                Standard flat tabbar layout with clean slide/fade indicator and optional icons.
            </p>
        </div>

        <Subtabs variant="line" bind:value={lineTab}>
            <Subtabs.List>
                <Subtabs.Trigger value="general" icon="settings">General</Subtabs.Trigger>
                <Subtabs.Trigger value="security" icon="security">Security</Subtabs.Trigger>
                <Subtabs.Trigger value="notifications" icon="notifications">Notifications</Subtabs.Trigger>
                <Subtabs.Trigger value="disabled-demo" icon="block" disabled>Disabled</Subtabs.Trigger>
            </Subtabs.List>

            <div class="pt-2">
                <Subtabs.Content value="general" class="text-sm text-muted-foreground">
                    <h3 class="text-sm font-semibold text-foreground mb-1">General Settings</h3>
                    Configure your username, display language, and general profile preferences.
                </Subtabs.Content>
                <Subtabs.Content value="security" class="text-sm text-muted-foreground">
                    <h3 class="text-sm font-semibold text-foreground mb-1">Security & Privacy</h3>
                    Manage multi-factor authentication, security questions, and active sessions.
                </Subtabs.Content>
                <Subtabs.Content value="notifications" class="text-sm text-muted-foreground">
                    <h3 class="text-sm font-semibold text-foreground mb-1">Notification Controls</h3>
                    Opt in or out of email updates, push alarms, and weekly performance reports.
                </Subtabs.Content>
            </div>
        </Subtabs>
    </div>

    <!-- 2. Pill Variant Showcase -->
    <div class="bg-surface-container-lowest border border-border rounded-xl p-6 shadow-xs space-y-6">
        <div>
            <h2 class="text-lg font-semibold text-foreground flex items-center gap-2">
                <Icon name="pill" class="text-primary-foreground" />
                Pill Variant (Segmented Control style)
            </h2>
            <p class="text-xs text-muted-foreground mt-0.5">
                Rounded pill buttons contained inside a shaded tray container background.
            </p>
        </div>

        <Subtabs variant="pill" bind:value={pillTab}>
            <Subtabs.List>
                <Subtabs.Trigger value="algebra">Algebra</Subtabs.Trigger>
                <Subtabs.Trigger value="combinatorics">Combinatorics</Subtabs.Trigger>
                <Subtabs.Trigger value="geometry">Geometry</Subtabs.Trigger>
                <Subtabs.Trigger value="number-theory">Number Theory</Subtabs.Trigger>
            </Subtabs.List>

            <div class="pt-2">
                <Subtabs.Content value="algebra" class="text-sm text-muted-foreground bg-surface-container-low/30 p-4 border border-border/50 rounded-lg">
                    Focuses on equation solving, polynomials, coordinate structures, and inequalities.
                </Subtabs.Content>
                <Subtabs.Content value="combinatorics" class="text-sm text-muted-foreground bg-surface-container-low/30 p-4 border border-border/50 rounded-lg">
                    Deals with permutations, combinations, graph theory, and discrete arrangements.
                </Subtabs.Content>
                <Subtabs.Content value="geometry" class="text-sm text-muted-foreground bg-surface-container-low/30 p-4 border border-border/50 rounded-lg">
                    Covers Euclidean properties, triangles, circles, and 3D space relationships.
                </Subtabs.Content>
                <Subtabs.Content value="number-theory" class="text-sm text-muted-foreground bg-surface-container-low/30 p-4 border border-border/50 rounded-lg">
                    Investigates prime numbers, modular arithmetic, divisibility, and sequences.
                </Subtabs.Content>
            </div>
        </Subtabs>
    </div>

    <!-- 3. Card Variant Showcase -->
    <div class="bg-surface-container-lowest border border-border rounded-xl p-6 shadow-xs space-y-6">
        <div>
            <h2 class="text-lg font-semibold text-foreground flex items-center gap-2">
                <Icon name="folder_open" class="text-primary-foreground" />
                Card Folder Variant (Integrated Content Panel)
            </h2>
            <p class="text-xs text-muted-foreground mt-0.5">
                Tabs sit on top of the content border, with the active tab merging seamlessly.
            </p>
        </div>

        <Subtabs variant="card" bind:value={cardTab}>
            <Subtabs.List>
                <Subtabs.Trigger value="overview">Overview</Subtabs.Trigger>
                <Subtabs.Trigger value="details">Details</Subtabs.Trigger>
                <Subtabs.Trigger value="logs">Activity Logs</Subtabs.Trigger>
            </Subtabs.List>

            <div class="border border-border p-6 rounded-b-xl bg-surface-container-lowest -mt-px relative z-10">
                <Subtabs.Content value="overview" class="text-sm text-muted-foreground">
                    <p class="font-medium text-foreground mb-2">Workspace Overview</p>
                    Here is a quick snapshot of your math progress. You have completed 12 tasks this week.
                </Subtabs.Content>
                <Subtabs.Content value="details" class="text-sm text-muted-foreground">
                    <p class="font-medium text-foreground mb-2">Performance Details</p>
                    Algebra: 92% correctness. Combinatorics: 78% correctness. Geometry: 85% correctness. Number Theory: 64% correctness.
                </Subtabs.Content>
                <Subtabs.Content value="logs" class="text-sm text-muted-foreground">
                    <p class="font-medium text-foreground mb-2">Recent Submissions</p>
                    <ul class="list-disc pl-5 space-y-1 mt-2">
                        <li>Correctly solved problem #3094 (Number Theory) — 10m ago</li>
                        <li>Attempted problem #1283 (Algebra) — 1h ago</li>
                        <li>Unlocked achievement: "Geometry Wizard" — 1d ago</li>
                    </ul>
                </Subtabs.Content>
            </div>
        </Subtabs>
    </div>

    <!-- 4. Vertical Tab layout Showcase -->
    <div class="bg-surface-container-lowest border border-border rounded-xl p-6 shadow-xs space-y-6">
        <div>
            <h2 class="text-lg font-semibold text-foreground flex items-center gap-2">
                <Icon name="view_week" class="text-primary-foreground" />
                Vertical Tab Orientation
            </h2>
            <p class="text-xs text-muted-foreground mt-0.5">
                Layout adapts to side-by-side display. Keyboard navigation uses Up/Down arrows to shift focus.
            </p>
        </div>

        <Subtabs orientation="vertical" variant="line" bind:value={verticalTab} class="border border-border/60 p-4 rounded-xl">
            <Subtabs.List class="w-40 border-r-0">
                <Subtabs.Trigger value="step1">Step 1: Read</Subtabs.Trigger>
                <Subtabs.Trigger value="step2">Step 2: Try</Subtabs.Trigger>
                <Subtabs.Trigger value="step3">Step 3: Solve</Subtabs.Trigger>
            </Subtabs.List>

            <div class="flex-1 pl-4 border-l border-border/80 min-h-32">
                <Subtabs.Content value="step1" class="text-sm text-muted-foreground">
                    <p class="font-semibold text-foreground mb-1">Analyze the problem statement</p>
                    Write down given variables, constraints, and make a sketch or diagram to identify geometric shapes or algebraic structures.
                </Subtabs.Content>
                <Subtabs.Content value="step2" class="text-sm text-muted-foreground">
                    <p class="font-semibold text-foreground mb-1">Formulate a strategy</p>
                    Pick a formula, test small values, find patterns, or use algebraic substitutions. Write out the initial equation steps.
                </Subtabs.Content>
                <Subtabs.Content value="step3" class="text-sm text-muted-foreground">
                    <p class="font-semibold text-foreground mb-1">Compute and verify the output</p>
                    Perform calculations, double check edge cases, verify units, and plug the result back in to check consistency.
                </Subtabs.Content>
            </div>
        </Subtabs>
    </div>

    <!-- 5. DOM mounting behavior (keepMounted Showcase) -->
    <div class="bg-surface-container-lowest border border-border rounded-xl p-6 shadow-xs space-y-6">
        <div>
            <h2 class="text-lg font-semibold text-foreground flex items-center gap-2">
                <Icon name="layers" class="text-primary-foreground" />
                State Preservation vs. Fresh Unmounting
            </h2>
            <p class="text-xs text-muted-foreground mt-0.5">
                Type something in both inputs, switch tabs, and switch back. Notice how Tab A retains your input value (`keepMounted={true}`), while Tab B resets on switch (`keepMounted={false}`).
            </p>
        </div>

        <Subtabs variant="pill" bind:value={mountTab}>
            <Subtabs.List>
                <Subtabs.Trigger value="tabA">Tab A (keepMounted)</Subtabs.Trigger>
                <Subtabs.Trigger value="tabB">Tab B (destroys DOM)</Subtabs.Trigger>
            </Subtabs.List>

            <div class="pt-2 grid grid-cols-1 md:grid-cols-2 gap-6">
                <!-- Keep Mounted -->
                <Subtabs.Content value="tabA" keepMounted class="border border-border p-4 rounded-xl space-y-4">
                    <div>
                        <span class="text-xs font-semibold text-foreground block">Tab A Panel (keepMounted)</span>
                        <span class="text-xs text-muted-foreground">This pane stays in the DOM hidden when inactive.</span>
                    </div>
                    <div class="space-y-1">
                        <label for="input-a" class="text-xs font-medium text-foreground">Input field A</label>
                        <Input id="input-a" placeholder="Type here..." bind:value={inputValA} />
                    </div>
                </Subtabs.Content>

                <!-- Destroy on Hide -->
                <Subtabs.Content value="tabB" class="border border-border p-4 rounded-xl space-y-4">
                    <div>
                        <span class="text-xs font-semibold text-foreground block">Tab B Panel (destroy)</span>
                        <span class="text-xs text-muted-foreground">This pane is completely unmounted when inactive.</span>
                    </div>
                    <div class="space-y-1">
                        <label for="input-b" class="text-xs font-medium text-foreground">Input field B</label>
                        <Input id="input-b" placeholder="Type here..." bind:value={inputValB} />
                    </div>
                </Subtabs.Content>
            </div>
        </Subtabs>
    </div>
</div>
