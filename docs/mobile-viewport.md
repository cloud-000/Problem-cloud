# Mobile viewport and bottom navigation

The app should keep its navigation and Coach button at a stable height while
pages scroll inside the shell. Safari and an iPhone Home Screen app can report
different viewport sizes, even on the same device.

## Viewport height versus safe areas

`100dvh` follows the current viewport height, including changes as browser
toolbars appear or disappear. `100vh` generally uses the large viewport height.
Neither value is a padding or a measurement of the space around a button.

`viewport-fit=cover` lets the app extend into the device's safe areas. The shell
reserves `env(safe-area-inset-top)` so content stays below the status bar.
WebKit has a [reported standalone viewport sizing issue](https://bugs.webkit.org/show_bug.cgi?id=254868)
where some viewport measurements exclude safe-area space unexpectedly.

The [app shell](../src/routes/(app)/+layout.svelte) uses `100dvh` in a browser and
overrides it with `100vh` under `display-mode: standalone`. This is a workaround
to evaluate on iPhone, not a guarantee about every iOS version or keyboard state.

## Why Progress could trigger a jump

The Progress skeleton ended with an absolutely positioned, visually hidden
`sr-only` loading label. Without a positioned ancestor, it escaped the internal
scroll region and enlarged the document. An isolated 390 × 844 browser
reproduction measured a document height of 1,231px instead of 844px.

Loading wrappers now use `position: relative` to contain their labels. The
384px skeleton also needed `min-w-0` on its grid parent to shrink on narrow screens.
These overflow bugs were confirmed. Their connection to the exact iPhone
viewport jump remains an inference until tested on-device.

## Why 10px?

**10px is a design choice, not a measured iPhone safe-area inset.** It is the
midpoint of the proposed 8–12px clearance range. The 56px navigation row already
centers 40px buttons, leaving approximately 8px beneath them. Adding 10px below
the row gives approximately 18px of clearance beneath the buttons.

[layout.css](../src/routes/layout.css) defines `--mobile-nav-bottom-space` as
10px in standalone mode and 0px otherwise. `--mobile-nav-height` includes that
space, and both the navigation and Coach button use it. Adjust this one token
to tune placement. The existing `--safe-area-bottom: 0px` remains because the
code records a previous stale, toolbar-sized iOS inset.

## Device check

Cold-launch the Home Screen app, then navigate Home → Progress → Home during
loading and after loading. Navigation and Coach should stay aligned without a
jump; only page content should scroll. Also check rotation and keyboard opening
and closing, since a stable viewport height does not itself handle keyboards.
