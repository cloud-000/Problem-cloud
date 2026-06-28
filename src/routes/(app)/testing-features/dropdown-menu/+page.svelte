<script lang="ts">
    import { DropdownMenu, type DropdownOption } from "$lib/components/dropdown-menu";
    import { Button } from "$lib/components/button";
    import { Icon } from "$lib/components/icon";
    import { toasts } from "$lib/state/toast.svelte";

    let lastClicked = $state<string>("None");

    function logClick(optionName: string) {
        lastClicked = optionName;
        toasts.success(`Clicked: ${optionName}`);
    }

    const dropdownOptions: DropdownOption[] = [
        { type: "header", label: "Account Options" },
        { label: "View Profile", icon: "person", onclick: () => logClick("View Profile") },
        { label: "Notifications", icon: "notifications", onclick: () => logClick("Notifications") },
        { type: "divider" },
        { type: "header", label: "Export & Settings" },
        {
            label: "Export Options",
            icon: "download",
            submenu: [
                { label: "Export as PDF", icon: "picture_as_pdf", onclick: () => logClick("Export PDF") },
                { label: "Export as JSON", icon: "data_object", onclick: () => logClick("Export JSON") },
                {
                    label: "Deep Submenu",
                    icon: "arrow_forward",
                    submenu: [
                        { label: "Sub-sub option A", icon: "star", onclick: () => logClick("Sub-sub option A") },
                        { label: "Sub-sub option B", icon: "favorite", onclick: () => logClick("Sub-sub option B") }
                    ]
                }
            ]
        },
        {
            label: "Display Settings",
            icon: "visibility",
            submenu: [
                { label: "Light Mode", icon: "light_mode", onclick: () => logClick("Light Mode") },
                { label: "Dark Mode", icon: "dark_mode", onclick: () => logClick("Dark Mode") },
                { label: "Custom Theme Color", icon: "palette", color: "#4f46e5", onclick: () => logClick("Custom Color") }
            ]
        },
        { label: "Disabled Option", icon: "block", disabled: true, onclick: () => logClick("Disabled Option") },
        { type: "divider" },
        { label: "Delete Profile", icon: "delete", color: "var(--destructive)", onclick: () => logClick("Delete Profile") }
    ];
</script>

<div class="space-y-8 p-6 max-w-4xl mx-auto pb-48">
    <!-- Header -->
    <div class="border-b border-border/80 pb-4">
        <div class="flex items-center gap-2">
            <a href="/testing-features" class="text-muted-foreground hover:text-foreground transition-colors">
                <Icon name="arrow_back" fontsize="1.5rem" />
            </a>
            <h1 class="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-2">
                <Icon name="menu" fontsize="2rem" class="text-primary-foreground" />
                Dropdown Menu Feature Tests
            </h1>
        </div>
        <p class="text-sm text-muted-foreground mt-1">
            Test the recursive submenus, custom styling, accessibility, and window collision detection of the new Dropdown Menu component.
        </p>
    </div>

    <!-- Overview Card -->
    <div class="border border-border/80 rounded-xl p-5 bg-surface-container-lowest shadow-xs flex flex-col gap-4">
        <h2 class="text-lg font-semibold text-foreground flex items-center gap-1.5">
            <Icon name="info" class="text-primary-foreground" />
            Component Features & State
        </h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-muted-foreground">
            <div class="space-y-2">
                <p><strong>Collision Aware:</strong> The dropdown lists automatically reposition themselves (above/below or left/right) depending on space available within the browser viewport.</p>
                <p><strong>Recursive Submenus:</strong> Nest options arbitrarily using the `submenu` property in the options configuration.</p>
                <p><strong>Accessibility:</strong> Full arrow-key navigation support, `Escape` to close, and `Enter`/`Space` selection.</p>
            </div>
            <div class="bg-surface-container-low rounded-lg p-4 flex flex-col justify-center items-center border border-border/50">
                <span class="text-xs uppercase font-bold tracking-wider text-muted-foreground">Last Action Selected</span>
                <span class="text-xl font-mono text-foreground mt-1 font-semibold">{lastClicked}</span>
            </div>
        </div>
    </div>

    <!-- Playground Section -->
    <div class="space-y-4">
        <h2 class="text-xl font-semibold text-foreground">Interactive Showcase</h2>
        <div class="border border-border/80 rounded-xl p-8 bg-surface-container-lowest shadow-xs flex flex-wrap gap-4 items-center justify-center min-h-[200px]">
            <DropdownMenu options={dropdownOptions}>
                <Button variant="outline" size="lg" class="cursor-pointer">
                    <Icon name="settings" class="mr-1" />
                    Open Menu (Outline Button)
                </Button>
            </DropdownMenu>

            <DropdownMenu options={dropdownOptions}>
                <Button variant="default" size="default" class="cursor-pointer">
                    <Icon name="apps" class="mr-1" />
                    Actions (Primary Button)
                </Button>
            </DropdownMenu>
            
            <DropdownMenu options={dropdownOptions}>
                <button class="inline-flex items-center justify-center p-2 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors border border-border/50">
                    <Icon name="more_vert" fontsize={20} />
                </button>
            </DropdownMenu>
        </div>
    </div>

    <!-- Viewport Collision Testing Matrix -->
    <div class="space-y-4">
        <div>
            <h2 class="text-xl font-semibold text-foreground">Window Collision Edge-Case Testing</h2>
            <p class="text-xs text-muted-foreground mt-1">
                Scroll the page or resize the screen and try opening the dropdowns below. They should stay fully contained in the viewport.
            </p>
        </div>
        
        <div class="relative border border-dashed border-border rounded-xl p-1 bg-surface-container-low/50 h-[350px] overflow-hidden flex flex-col justify-between">
            <!-- Top row of testing matrix -->
            <div class="flex justify-between p-4">
                <DropdownMenu options={dropdownOptions}>
                    <Button variant="secondary" size="sm" class="cursor-pointer">
                        Top Left
                    </Button>
                </DropdownMenu>

                <DropdownMenu options={dropdownOptions}>
                    <Button variant="secondary" size="sm" class="cursor-pointer">
                        Top Right
                    </Button>
                </DropdownMenu>
            </div>

            <!-- Middle/Center row -->
            <div class="flex justify-center p-4">
                <DropdownMenu options={dropdownOptions}>
                    <Button variant="outline" size="sm" class="cursor-pointer">
                        Center
                    </Button>
                </DropdownMenu>
            </div>

            <!-- Bottom row -->
            <div class="flex justify-between p-4">
                <DropdownMenu options={dropdownOptions}>
                    <Button variant="secondary" size="sm" class="cursor-pointer">
                        Bottom Left
                    </Button>
                </DropdownMenu>

                <DropdownMenu options={dropdownOptions}>
                    <Button variant="secondary" size="sm" class="cursor-pointer">
                        Bottom Right
                    </Button>
                </DropdownMenu>
            </div>
        </div>
    </div>
</div>
