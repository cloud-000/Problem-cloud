# ProblemCloud Component Inventory & Exploration Report

This report provides a comprehensive, read-only analysis and inventory of all Svelte components located under `src/lib/components` in the ProblemCloud repository.

---

## 1. Directory Overview & Structure

The components directory structure is organized with a single-file component at the root, along with several directory-based components that encapsulate their styles, TypeScript types, and sub-parts.

```
src/lib/components/
├── LaTeX.svelte
├── DOCS.md (Empty)
├── asy-image/
│   ├── index.ts
│   └── asy-image.svelte
├── button/
│   ├── index.ts
│   └── button.svelte
├── combobox/
│   ├── index.ts
│   ├── combobox.ts
│   └── combobox.svelte
├── date-picker/
│   ├── index.ts
│   └── date-picker.svelte
├── dropdown-menu/
│   ├── index.ts
│   ├── dropdown-menu.ts
│   ├── dropdown-menu.svelte
│   └── DropdownMenuList.svelte
├── icon/
│   ├── index.ts
│   └── material.svelte
├── input/
│   ├── index.ts
│   └── input.svelte
├── link-menu/
│   ├── index.ts
│   └── link-menu.svelte
├── math-statement/
│   ├── index.ts
│   └── math-statement.svelte
├── problem/
│   ├── index.ts
│   ├── problem-answer.svelte
│   └── problem.svelte
├── profile/ (Empty Directory)
├── range-slider/
│   ├── index.ts
│   ├── range-slider.ts
│   └── range-slider.svelte
├── segment-bar/
│   ├── index.ts
│   └── segment-bar.svelte
├── select/
│   ├── index.ts
│   ├── select.ts
│   └── select.svelte
├── sidebar/
│   ├── index.ts
│   ├── sidebar.svelte
│   ├── sidebar-header.svelte
│   ├── sidebar-group.svelte
│   ├── sidebar-item.svelte
│   ├── sidebar-footer.svelte
│   └── sidebar-trigger.svelte
├── status-tag/
│   ├── index.ts
│   └── status-tag.svelte
├── toast/
│   ├── index.ts
│   ├── toast.svelte
│   └── toast-container.svelte
└── toggle/
    ├── index.ts
    ├── toggle.svelte
    ├── switch.svelte
    └── tri-state-switch.svelte
```

---

## 2. Component Directory Inventory

The table below summarizes all found components, their export details, and their primary purposes.

| Component / Directory | Single-file / Directory-based | Exported Aliases (Barrel `index.ts`) | Exported Custom Types / Helpers | Purpose |
|---|---|---|---|---|
| **`LaTeX.svelte`** | Single-file | N/A (Imported directly) | N/A | Renders display and inline LaTeX math equations dynamically via KaTeX. |
| **`asy-image`** | Directory-based | `Root`, `AsyImage` | N/A | Displays Asymptote diagrams with image/code views, light/dark inversion, and lightboxes. |
| **`button`** | Directory-based | `Root`, `Button`, `buttonVariants` | `ButtonProps`, `ButtonSize`, `ButtonVariant` | Renders a styled button or anchor element with Tailwind variants and states. |
| **`combobox`** | Directory-based | `Root`, `Combobox`, `comboboxVariants` | `Option`, `NormalizedOption`, `ComboboxMatcher`, `ComboboxProps` | Multi-select input for pills with search filtering, freestyle typing, and scroll tracks. |
| **`date-picker`** | Directory-based | `Root`, `DatePicker` | `DatePickerProps` | Input control displaying an interactive monthly calendar for picking date strings. |
| **`dropdown-menu`** | Directory-based | `Root`, `DropdownMenu` | `DropdownOption` | Nested recursive multi-level dropdown menu with auto-positioning and collision checking. |
| **`icon`** | Directory-based | `Root`, `Icon` | `IconProps` | Wraps Google Material Symbols Rounded font icons with custom styling properties. |
| **`input`** | Directory-based | `Root`, `Input` | `Props` | Standard text, number, and file input element. |
| **`link-menu`** | Directory-based | `Root`, `LinkMenu` | `LinkMenuProps`, `LinkItem` | A hover/focus popup containing external hyperlink menus. |
| **`math-statement`** | Directory-based | `Root`, `MathStatement` | N/A | Composites math texts by splitting them into LaTeX markup and interactive Asy diagram runs. |
| **`problem`** | Directory-based | `Root` (as `Problem`), `Answer` (as `ProblemAnswer`) | `ProblemMode`, `Props` | Renders math problems (metadata badges, AoPS links, details tooltips, statements, and response cards). |
| **`profile`** | Directory-based | Empty | N/A | Empty directory placeholder. |
| **`range-slider`** | Directory-based | `Root`, `RangeSlider`, `rangeSliderVariants` | `RangeSliderProps`, `RangeValue` | Dual-handle slider supporting drag, sliding windows, and overlaps. |
| **`segment-bar`** | Directory-based | `Root`, `SegmentBar` | `Segment` | A horizontal bar divided into colored segments representing proportion values. |
| **`select`** | Directory-based | `Root`, `Select` | `SelectOption`, `NormalizedSelectOption`, `SelectProps` | Styled dropdown option selector with list filtering and key bounds navigation. |
| **`sidebar`** | Directory-based | `Root` (`Sidebar`), `Header` (`SidebarHeader`), `Group` (`SidebarGroup`), `Item` (`SidebarItem`), `Footer` (`SidebarFooter`), `Trigger` (`SidebarTrigger`) | `SidebarProps`, `SidebarItemProps`, `SidebarContext`, `SIDEBAR_CONTEXT_KEY`, `useSidebar`, `sidebarItemVariants` | Sidebar components sharing layout states via context. |
| **`status-tag`** | Directory-based | `Root`, `StatusTag` | `STATUS_META`, `statusTagVariants`, `StatusKind`, `StatusTagSize`, `StatusTagTone`, `StatusTagAction` | Renders statuses with matching icons/colors, and morphs on hover/focus to action buttons. |
| **`toast`** | Directory-based | `Root` (`Toast`), `Container` (`ToastContainer`) | `toastVariants`, `ToastProps`, `ToastContainerProps` | Renders toast notifications stacked in the viewport corners. |
| **`toggle`** | Directory-based | `Toggle`, `Switch`, `TriStateSwitch` | `ToggleProps`, `SwitchProps`, `TriStateSwitchProps`, `TriState`, `toggleVariants`, `switchVariants`, `thumbVariants`, `triStateSwitchVariants`, `triStateThumbVariants` | Standard toggle buttons, sliding switches, and cycling tri-state checkboxes. |

---

## 3. Detailed Component Deep Dive

---

### 3.1. LaTeX (`LaTeX.svelte`)
- **File Path**: `src/lib/components/LaTeX.svelte`
- **Props**:
  - `class` (`string`): Class names applied to the container. Defaults to `""`.
  - `children` (`Snippet`): Svelte snippet content containing raw LaTeX strings.
- **State & Derived Variables**:
  - `sourceEl` (`HTMLDivElement | null`, default `null`): Bindable hidden source container holding Svelte-rendered children.
  - `renderEl` (`HTMLDivElement | null`, default `null`): Bindable visible container where KaTeX outputs are rendered.
  - `observer` (`MutationObserver | null`, default `null`): Mutation observer to detect reactivity updates in `sourceEl`.
- **Behavior & Interactivity**:
  - Svelte processes `children` in the hidden `sourceEl` without KaTeX interference.
  - A `MutationObserver` watches `sourceEl`. Whenever its children modify reactively, it triggers `syncAndRender()`, cloning the pristine HTML to `renderEl` and calling `window.renderMathInElement()`.
  - Configures delimiters (`$`, `$$`, `\(`, `\[`, `\begin{equation}`, `\begin{align}`) and macros (`\sun` to `\odot`, `\mbox` to `\text`, `\bigskip` to `\space`).
  - Ignores classes named `"katex-ignore"`.
- **Visual Design details**:
  - Outer visible elements use the classes: `"font-serif leading-relaxed select-text {className}"`.

---

### 3.2. Asy Image (`asy-image/asy-image.svelte`)
- **File Path**: `src/lib/components/asy-image/asy-image.svelte`
- **Props**:
  - `imageSrc` (`string`, required): Source URL of the Asymptote diagram.
  - `code` (`string`, default `""`): Asymptote markup text. Displays a toolbar toggle if provided.
  - `class` (`string`, optional): Extends style of container.
- **State & Derived Variables**:
  - `view` (`"image" | "code"`, default `"image"`): Active view mode.
  - `expanded` (`boolean`, default `false`): Lightbox open state.
  - `userInverted` (`boolean | null`, default `null`): Tracks manual override of diagram light/dark inversion.
  - `inverted` (`boolean`, derived): Result of `userInverted ?? Theme.isDark`.
- **Behavior & Interactivity**:
  - Clicking the image toggles `expanded = true`, opening a fullscreen lightbox.
  - Uses an `$effect` while `expanded` is true to add a keydown event listener on the document that traps `Escape` to close the lightbox, and sets the body scroll `overflow` style to `"hidden"`.
  - In code view, displays raw code in a pre-formatted box.
  - Supports image inversion using a luminance filter `filter: invert(1) hue-rotate(180deg)` so black-and-white elements swap correctly when switching to dark mode.
- **Visual Design details**:
  - Uses Svelte transition `fade` on the backdrop and `scale` (start at `0.95`, ease `cubicOut`) on the image.
  - Toolbar elements use a transparent backdrop-blur container `bg-surface-container-lowest/90 backdrop-blur-(--backdrop-blur) border border-border/60`.

---

### 3.3. Button (`button/button.svelte`)
- **File Path**: `src/lib/components/button/button.svelte`
- **Props**:
  - `class` (`string`, optional): External classes.
  - `variant` (`ButtonVariant`, default `"default"`): Variants: `"default"`, `"outline"`, `"secondary"`, `"ghost"`, `"destructive"`, `"link"`.
  - `size` (`ButtonSize`, default `"default"`): Sizes: `"default"`, `"xs"`, `"sm"`, `"lg"`, `"icon"`, `"icon-xs"`, `"icon-sm"`, `"icon-lg"`.
  - `ref` (`HTMLButtonElement | HTMLAnchorElement | null`, bindable, default `null`): Binds element reference.
  - `href` (`string | undefined`, default `undefined`): Renders anchor `<a>` tag instead of `<button>` if defined.
  - `type` (`"button" | "submit" | "reset"`, default `"button"`): HTML button type.
  - `disabled` (`boolean`, optional): Disable attribute flag.
  - `children` (`Snippet`, optional): Render slot.
  - `...restProps`: Forwarded element attributes.
- **Behavior & Interactivity**:
  - Automatically switches wrapper to an anchor element if `href` is defined. If `disabled` is also true, removes `href` and adds `aria-disabled`, `role="link"`, and `tabindex={-1}`.
- **Visual Design details**:
  - Powered by `tailwind-variants` (`tv`). Uses active animations (`active:not-aria-[haspopup]:translate-y-px`) and size mappings (e.g. icon sizes map directly to `size-9`, `size-6`, etc.).

---

### 3.4. Combobox (`combobox/combobox.svelte`)
- **File Path**: `src/lib/components/combobox/combobox.svelte`
- **Props**:
  - `ref` (`HTMLDivElement | null`, bindable, default `null`): Container element ref.
  - `class` (`string`, optional): Container styling classes.
  - `value` (`string[]`, bindable, default `[]`): The source of truth array containing selected values.
  - `query` (`string`, bindable, default `""`): Active search query.
  - `open` (`boolean`, bindable, default `false`): Triggers dropdown visibility.
  - `options` (`Option[]`, default `[]`): Autocomplete options list.
  - `strict` (`boolean`, default `false`): Disables freestyle creation of custom pills.
  - `matcher` (`ComboboxMatcher`, default substring match): Predicate to filter options.
  - `dupKey` (`(raw: string) => string`, default trim + lowercase): Computes index key to prevent duplicates.
  - `separators` (`string[]`, default `[","]`): Delimiter symbols committing query to pills.
  - `placeholder` (`string`, optional): Placeholder for input when list is empty.
  - `inputPlaceholder` (`string`, optional): Placeholder for input when pills exist.
  - `disabled` (`boolean`, default `false`): Disables component inputs.
  - `max` (`number`, optional): Limit on selected elements.
  - `aria-invalid` (`boolean | "true" | "false" | null`, default `null`): Accessibility status.
  - `onchange` (`(values: string[]) => void`, optional): Fired on addition/removal.
  - `oncreate` (`(value: string) => void`, optional): Fired when a bespoke off-list pill is created.
  - `pill` (`Snippet<[NormalizedOption, () => void]>`, optional): Custom pill renderer.
  - `optionItem` (`Snippet<[NormalizedOption, boolean]>`, optional): Custom dropdown row renderer.
  - `empty` (`Snippet<[]>`, optional): Custom "Nothing found" list item.
  - `exhausted` (`Snippet<[]>`, optional): Custom "Nothing left" list item.
- **State & Derived Variables**:
  - `activeIndex` (`number`, default `-1`): Row selected index.
  - `highlightedPillIndex` (`number`, default `-1`): Pill index staged for removal.
  - `flashKey` (`string | null`, default `null`): Highlight key trigger for duplicate notifications.
  - `inputEl` (`HTMLInputElement | null`, default `null`): Input field ref.
  - `rowEls` (`HTMLLIElement[]`): Array of list item references.
  - `hasList`, `mode2` (hybrid), `atMax`, `allOptions`, `selectedOptions`, `selectedSet`, `filteredOptions`, `poolExhausted`, `showCreateRow`, `rows`, `liveMessage`: Derived values backing interaction and screen-readers.
- **Behavior & Interactivity**:
  - Supports horizontal scroll track for pills (`overflow-x-auto scrollbar-none`).
  - Input field maps keyboard binds: `ArrowDown`/`ArrowUp` navigates rows, `Home`/`End` bounds list, `Enter` selects active row, `Escape` closes, `Backspace` selects/removes the trailing pill when input is empty, and `ArrowLeft`/`ArrowRight` selects specific pills.
  - Firing a duplicate entry invokes a flashing red background warning (`animate-cmb-flash`) on the matching pill.
- **Visual Design details**:
  - Dropdown options: `cursor-pointer data-active:bg-primary text-foreground data-active:text-primary-foreground`.
  - Container uses Tailwind v4: `border-input focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-3 px-2.5 py-1 text-sm`.

---

### 3.5. Date Picker (`date-picker/date-picker.svelte`)
- **File Path**: `src/lib/components/date-picker/date-picker.svelte`
- **Props**:
  - `value` (`string`, bindable, default `""`): Selected date string in `"YYYY-MM-DD"` format.
  - `placeholder` (`string`, default `"Select date..."`): Placeholder text.
  - `disabled` (`boolean`, default `false`): Disables interaction.
  - `min` (`string`, optional): Lower bound date.
  - `max` (`string`, optional): Upper bound date.
  - `onchange` (`(value: string) => void`, optional): Change callback.
- **State & Derived Variables**:
  - `open` (`boolean`, default `false`): Dropdown view open state.
  - `currentMonth` (`number`, default current month): Active visible month index.
  - `currentYear` (`number`, default current year): Active visible year.
  - `containerEl` (`HTMLDivElement | null`): Main wrapper ref.
  - `displayValue`, `years`, `monthDays`, `currentMonthStr`, `currentYearStr`, `yearSelectOptions`: Derived layout arrays.
- **Behavior & Interactivity**:
  - Toggles dropdown open on trigger click. Opens the month and year of the currently selected date.
  - Global `svelte:window` click handler closes the panel if clicks land outside `containerEl`.
  - Highlights today's date with a subtle border. Dates outside `min` and `max` limits are disabled.
  - "Today" footer button directly selects today's date. "Clear" button resets values.
  - Includes Month and Year `<Select>` filters inside the panel to jump quickly.
- **Visual Design details**:
  - Uses grid container for days (`grid-cols-7`). Selected day matches `bg-primary text-primary-foreground`. Today's date has an inline border outline.

---

### 3.6. Dropdown Menu (`dropdown-menu/dropdown-menu.svelte`)
- **File Path**: `src/lib/components/dropdown-menu/dropdown-menu.svelte`
- **Props (`dropdown-menu.svelte`)**:
  - `options` (`DropdownOption[]`, required): Struct arrays describing menu rows.
  - `class` (`string`, default `""`): CSS styling class for container.
  - `triggerClass` (`string`, default `""`): Styling class for trigger child wrapper.
  - `children` (`Snippet`, optional): Trigger button element.
- **Props (`DropdownMenuList.svelte`)**:
  - `options`, `parentEl`, `isRoot`, `activePath`, `depth`, `pathPrefix`, `onSelect`, `onHover`, `onClose`.
- **State & Derived Variables**:
  - `open` (`boolean`, default `false`): Dropdown state.
  - `activePath` (`number[]`, default `[]`): Depth path indicating the hovered sub-item coordinates (e.g. `[rootIndex, subIndex, subSubIndex]`).
  - `coords` (`{ top: number, left: number, visibility: "hidden" | "visible" }`, in list): Position coordinates.
- **Behavior & Interactivity**:
  - Renders sub-elements recursively using `DropdownMenuList.svelte`.
  - Position calculations prevent viewport boundary overflows. A root menu opens below the trigger and shifts above it if it overflows the bottom. Submenus open to the right of parent items and flip left if they overflow the right margin.
  - Hovering over items with submenus opens them with an 80ms debounce.
  - Supports full keyboard controls: `ArrowDown`/`ArrowUp` navigates active level list, `ArrowRight` expands submenu, `ArrowLeft` collapses/returns to parent level, `Enter`/`Space` commits active row, `Escape` closes all, `Tab` closes. Automatically shifts focus back to the triggering element.
- **Visual Design details**:
  - Options list: `bg-surface-container-lowest border border-border rounded-lg shadow-lg p-1`.
  - Active hover background: `hover:bg-muted dark:hover:bg-muted/50 data-[active=true]:bg-muted`.

---

### 3.7. Icon (`icon/material.svelte`)
- **File Path**: `src/lib/components/icon/material.svelte`
- **Props**:
  - `name` (`string`, optional): Google Material Symbol code.
  - `fill` (`boolean`, default `false`): Toggles filled/outlined appearance axis settings.
  - `fontsize` (`string | number`, optional): Custom font-size style. Numbers are translated to pixels.
  - `color` (`string`, optional): Text color.
  - `weight` (`number`, optional): Font weight axis.
  - `grade` (`number`, optional): Font grade axis.
  - `opticalSize` (`number`, optional): Optical size axis.
  - `style` (`string`, optional): Additional inline style strings.
  - `children` (`Snippet`, optional): Content slot alternative to `name`.
- **State & Derived Variables**:
  - `variationSettings` (`string`): Formatted `font-variation-settings` string (e.g. `"'FILL' 0, 'wght' 400"`).
  - `computedStyle` (`string`): Merged inline CSS styles.
- **Behavior & Interactivity**:
  - Renders a span using the `.material-symbols-rounded` font class, configuring Material Symbols properties by passing `font-variation-settings` styles.
- **Visual Design details**:
  - Base classes: `inline-flex items-center justify-center align-middle leading-none size-[1em] select-none`.

---

### 3.8. Input (`input/input.svelte`)
- **File Path**: `src/lib/components/input/input.svelte`
- **Props**:
  - `value` (`any`, bindable): Value string/number.
  - `type` (`HTMLInputTypeAttribute`, optional): Standard input type.
  - `files` (`FileList`, bindable, optional): Bound if `type === "file"`.
  - `class` (`string`, optional): Extra styling.
  - `"data-slot"` (`string`, default `"input"`): Selector tags.
- **Behavior & Interactivity**:
  - Separates rendering into two branches based on whether `type === "file"` to support binding both Svelte's `bind:files` and standard `bind:value` when needed.
- **Visual Design details**:
  - Standard styling classes: `dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 h-9 rounded-md border bg-transparent px-2.5 py-1 transition-[color,box-shadow] disabled:opacity-50`.

---

### 3.9. Link Menu (`link-menu/link-menu.svelte`)
- **File Path**: `src/lib/components/link-menu/link-menu.svelte`
- **Props**:
  - `links` (`LinkItem[]`, required): Hyperlink lists containing `{ label, href, icon }`.
  - `icon` (`string`, default `"link"`): Material Symbol icon for the trigger button.
  - `label` (`string`, default `"Links"`): Accessibility trigger button label.
  - `class` (`string`, optional): Custom classes.
- **Behavior & Interactivity**:
  - Displays a small trigger button. Hovering over it or focusing items inside (`group-focus-within`) displays a floating dropdown menu.
  - Dropdown options open in a new tab (`target="_blank"` with `rel="noopener noreferrer"`).
- **Visual Design details**:
  - Uses simple transition effects (`transition-[opacity,transform] duration-150 ease-out`).
  - Container uses `bg-surface-container-highest border border-border shadow-lg rounded-lg p-1`.

---

### 3.10. Math Statement (`math-statement/math-statement.svelte`)
- **File Path**: `src/lib/components/math-statement/math-statement.svelte`
- **Props**:
  - `text` (`string`, default `""`): Full math statement string.
  - `class` (`string`, default `""`): Container classes.
- **State & Derived Variables**:
  - `segments` (`array`, derived): Array of statement runs from `segmentStatement(parseMathStatement(text))`.
- **Behavior & Interactivity**:
  - Splits text statements into runs of LaTeX text or inline Asymptote diagram blocks (`"asy"`).
  - Iterates segments using index keys `(i)`. Rendering `"asy"` segments inserts an `AsyImage` component, while text segments render using a `<LaTeX>` component.
- **Visual Design details**:
  - Standard container layout matching inherited classes.

---

### 3.11. Problem & Answer (`problem/`)
- **File Path**: `src/lib/components/problem`

#### 3.11.1. `problem-answer.svelte`
- **Props**:
  - `choices` (`string[] | null`, default `null`): MCQ options array.
  - `answerIndex` (`number | null`, default `null`): 0-based index of correct option.
  - `answer` (`string`, bindable, default `""`): Free response text field binding.
  - `selectedChoice` (`number | null`, bindable, default `null`): MCQ selected index.
  - `showAnswerState` (`boolean`, default `false`): Triggers correction borders (green/red).
  - `disabled` (`boolean`, default `false`): Disables interactive buttons.
  - `isInstantFeedback` (`boolean`, default `false`): Immediately validates response correctness.
- **State & Derived Variables**:
  - `feedback` (`{ result: boolean | null, target: number | "input" | null } | null`, default `null`): Feedback status indicator.
  - `feedbackTimer` (`ReturnType<typeof setTimeout> | null`): Timer to clear temporary feedback.
  - `normalizedChoices`, `isMcq`, `canShowAnswerState`: Derived helpers.
- **Behavior & Interactivity**:
  - Renders clickable MCQ cards labeled A, B, C... or an `<Input>` textbox for free response.
  - Exported function `trigger(useAnimation: boolean): boolean | null` evaluates whether the chosen answer is correct. If `useAnimation` is true, displays correct/incorrect background colors and incorrect shake animations, or throws warning toast alerts if inputs are empty.
- **Visual Design details**:
  - MCQ option border feedback classes: `correct && "border-correct bg-correct/10"`, `incorrect && "border-destructive bg-destructive/10"`.
  - Shakes incorrect inputs via `animate-answer-shake` keyframes.

#### 3.11.2. `problem.svelte`
- **Props**:
  - `problem` (`ProblemRow`, required): The problem database record model.
  - `answer` (`string`, bindable, default `""`): Forwarded to `ProblemAnswer`.
  - `selectedChoice` (`number | null`, bindable, default `null`): Forwarded to `ProblemAnswer`.
  - `mode` (`ProblemMode`, default `"practice"`): Modes: `"preview"`, `"practice"`, `"review"`.
  - `showAnswerState` (`boolean`, default `false`): Shows correct/incorrect border indicators.
  - `disabled` (`boolean`, default `false`): Disable inputs.
  - `isInstantFeedback` (`boolean`, default `false`): Enables instant validation.
  - `debug` (`boolean`, default `false`): Enables raw statement markup code viewing.
  - `class` (`string`, optional): Custom classes.
- **State & Derived Variables**:
  - `showRaw` (`boolean`, default `false`): In debug mode, toggles rendering raw markup in a `<pre>` block or the formatted statement.
  - `problemAnswer` (`ProblemAnswer | null`): Child `ProblemAnswer` component ref.
  - `topicName`, `status`, `officialSolutionCount`, `aopsLinks`: Derived values.
- **Behavior & Interactivity**:
  - Displays badges for topic categories, test names, serial numbers, difficulty, and quality.
  - Incorporates details hover tooltip revealing developer stats (`id`, `tags`, `computational`, etc.).
  - Includes AoPS discussion links.
- **Visual Design details**:
  - Card layout: `border border-border bg-surface-container-low p-3 rounded-lg flex flex-col gap-3`.
  - Debug tooltip: `absolute top-7 right-0 z-20 w-80 bg-surface-container-highest border border-border shadow-lg p-3 text-xs opacity-0 transition-[opacity,transform] duration-150 ease-out group-hover/details:opacity-100`.

---

### 3.12. Range Slider (`range-slider/range-slider.svelte`)
- **File Path**: `src/lib/components/range-slider/range-slider.svelte`
- **Props**:
  - `min` (`number`, default `0`): Minimum scale value.
  - `max` (`number`, default `100`): Maximum scale value.
  - `step` (`number`, default `1`): Snapping intervals. Values `<= 0` disable snapping.
  - `minGap` (`number`, default `0`): Minimum physical space allowed between thumbs.
  - `value` (`RangeValue`, bindable, default `[min, max]`): Low/high values array.
  - `disabled` (`boolean`, default `false`): Disables slider.
  - `showTooltip` (`boolean`, default `true`): Tooltips display above active thumbs.
  - `formatValue` (`(v: number) => string`, default `(v) => String(v)`): Label formatter.
  - `label` (`string`, default `"Range"`): Accessibility label.
  - `class` (`string`, optional): External classes.
- **State & Derived Variables**:
  - `trackEl` (`HTMLDivElement | null`, default `null`): Track pointer reference.
  - `dragMode` (`"thumb" | "bar" | null`, default `null`): Hover dragging indicator mode.
  - `activeThumb` (`0 | 1 | null`, default `null`): Index of thumb being dragged.
  - `focusedThumb` (`0 | 1 | null`, default `null`): Index of thumb carrying focus.
  - `lowPct`, `highPct`: Derived percentage offsets.
- **Behavior & Interactivity**:
  - Supports dragging handles, tapping track to center nearest handle, or dragging the inner bar to shift the entire selected range.
  - Handles pushing bounds via `applyPush()` (moving one handle closer than `minGap` pushes the other along). Thumbs never cross and clamp inside `[min, max]`.
  - Fully supports `PointerCapture` API on the track to keep tracking drag operations even when pointer leaves bounds.
  - Keyboard binds: `ArrowRight`/`ArrowUp` increments by step, `ArrowLeft`/`ArrowDown` decrements, `PageUp`/`PageDown` shifts 10x steps, `Home`/`End` anchors handles to limits.
- **Visual Design details**:
  - Active track: `bg-primary`, resting track: `bg-surface-container-high`.
  - Thumbs: `bg-surface-container-lowest border border-input rounded-full size-5 shadow-sm focus-visible:ring-3 focus-visible:ring-ring/50`.

---

### 3.13. Segment Bar (`segment-bar/segment-bar.svelte`)
- **File Path**: `src/lib/components/segment-bar/segment-bar.svelte`
- **Props**:
  - `segments` (`Segment[]`, required): Configurations list representing sections `{ value, color, label }`.
  - `class` (`string`, optional): Extra styling.
  - `...restProps`: Forwarded container attributes.
- **State & Derived Variables**:
  - `total` (`number`, derived): Sum total value of all segment sizes.
- **Behavior & Interactivity**:
  - Normalizes segments to percentages against `total`. Divs are styled using inline CSS properties: `width: ${(value / total) * 100}%; background-color: {color}`.
  - Assigns segment descriptions to element `title` tooltips. Segments with value `<= 0` are not rendered.
- **Visual Design details**:
  - Base container: `flex h-2 w-full overflow-hidden rounded-full bg-surface-container`.

---

### 3.14. Select (`select/select.svelte`)
- **File Path**: `src/lib/components/select/select.svelte`
- **Props**:
  - `value` (`string`, bindable): Selected value binding.
  - `options` (`SelectOption[]`, default `[]`): Shorthand string array or label/value objects list.
  - `placeholder` (`string`, default `"Select an option..."`): Empty trigger text label.
  - `disabled` (`boolean`, default `false`): Disables trigger interactions.
  - `aria-invalid` (`boolean | "true" | "false" | null`, default `null`): Standard accessibility status.
  - `onchange` (`(value: string) => void`, optional): Change callback.
  - `triggerContent` (`Snippet<[NormalizedSelectOption]>`, optional): Custom trigger text renderer.
  - `optionItem` (`Snippet<[NormalizedSelectOption, { active: boolean; selected: boolean }]>`, optional): Custom list item renderer.
- **State & Derived Variables**:
  - `open` (`boolean`, default `false`): Dropdown view toggle.
  - `activeIndex` (`number`, default `-1`): Index of highlighted row option.
  - `optionEls` (`HTMLLIElement[]`): Array of list items element references.
  - `containerEl` (`HTMLDivElement | null`): Main wrapper reference.
  - `allOptions`, `selectedOption`, `selectedIndex`: Derived values.
- **Behavior & Interactivity**:
  - Toggles dropdown open on button click. Highlights selected index (or first selectable) when opened.
  - Closes panel on focusout or when clicking outside.
  - Automatically scrolls highlighted items into view using `.scrollIntoView({ block: "nearest" })`.
  - Keyboard binds: `ArrowDown`/`ArrowUp` navigates highlight, `Enter`/`Space` commits option / opens menu, `Escape`/`Tab` closes dropdown.
- **Visual Design details**:
  - Trigger button matches text inputs: `dark:bg-input/30 border-input h-9 rounded-md border flex items-center justify-between px-2.5 shadow-xs focus:ring-3`.
  - Chevron icon rotates 180 degrees when open: `transition-transform duration-200 open && "rotate-180"`.
  - Dropdown options: `bg-surface-container-low border border-border shadow-md data-active:bg-primary data-selected:bg-primary/20`.

---

### 3.15. Sidebar (`sidebar/`)
- **File Path**: `src/lib/components/sidebar`

#### 3.15.1. `sidebar.svelte` (Root)
- **Props**:
  - `ref` (`HTMLDivElement | null`, bindable, default `null`): Container element ref.
  - `expanded` (`boolean`, bindable, default `true`): Open/closed state.
  - `collapsible` (`"icon" | "none"`, default `"icon"`): Determines collapse visual: `"icon"` collapses sidebar to 16px, `"none"` collapses sidebar to 0px (hidden).
- **Behavior & Interactivity**:
  - Establishes `SIDEBAR_CONTEXT_KEY` using Svelte 5 `setContext` with reactive getters/setters mapping back to `expanded` and `collapsible` properties.
  - Transitions width on open/collapse: `transition-all duration-300 ease-in-out`.
- **Visual Design details**:
  - Width: expanded `w-64`, icon-collapsed `w-16`, hidden-collapsed `w-0 overflow-hidden border-r-0`.
  - Styling: `flex flex-col h-full border-r border-border bg-surface-container-low`.

#### 3.15.2. `sidebar-header.svelte`
- **Props**: standard div props.
- **Behavior & Interactivity**:
  - Reads `sidebar.expanded` context. Centers items and adjusts padding `px-2` if collapsed.

#### 3.15.3. `sidebar-group.svelte`
- **Props**: `heading` (`string`, optional).
- **Behavior & Interactivity**:
  - Groups items vertically. Only displays uppercase `heading` text if `sidebar.expanded` is true. Aligns child items to center if collapsed.

#### 3.15.4. `sidebar-item.svelte`
- **Props**:
  - `href` (`string`, optional): Render target URL. Renders anchor `<a>` if present.
  - `active` (`boolean`, default `false`): Style highlights active item.
  - `activeClass` (`string`, default preset primary highlight styles).
  - `hoverClass` (`string`, default `"hover:bg-surface-container hover:text-foreground"`).
  - `icon` (`string`, optional): Material Symbol icon name.
  - `label` (`string`, optional): Display name.
  - `tooltip` (`string`, optional): Tooltip text. Defaults to `label` when collapsed.
  - `child` (`Snippet`, optional): Custom rendering snippet.
- **Behavior & Interactivity**:
  - Renders as custom snippet if `child` is passed, as anchor `<a>` if `href` is present, or as a button otherwise.
  - In collapsed mode, centers icons, hides labels, and displays tooltips on hover.
- **Visual Design details**:
  - Styled via `sidebarItemVariants`. Active state displays primary colored border line indicator: `before:absolute before:left-0 before:top-1/4 before:h-1/2 before:w-[3px] before:rounded-r-full before:bg-primary`.

#### 3.15.5. `sidebar-footer.svelte`
- **Props**: standard div props.
- **Behavior & Interactivity**:
  - Placed at the bottom (`mt-auto`). Centers children if collapsed.

#### 3.15.6. `sidebar-trigger.svelte`
- **Props**: standard button props.
- **Behavior & Interactivity**:
  - Ghost icon button that toggles `sidebar.expanded` on click.
  - Chevron icon rotates 180 degrees when collapsed.

---

### 3.16. Status Tag (`status-tag/status-tag.svelte`)
- **File Path**: `src/lib/components/status-tag/status-tag.svelte`
- **Props**:
  - `status` (`StatusKind`, required): Status outcomes: `"correct"`, `"incorrect"`, `"skipped"`, `"solved"`, `"attempted"`, `"active"`, `"ended"`, `"review"`, `"new"`, `"ungrouped"`.
  - `label` (`string`, optional): Override text label.
  - `size` (`StatusTagSize`, default `"md"`): Sizes: `"sm"` or `"md"`.
  - `action` (`StatusTagAction`, optional): Configuration to morph the tag into a button on hover/focus `{ label, icon, onclick }`.
  - `tone` (`StatusTagTone`, optional): Color tone override.
  - `icon` (`boolean`, default `true`): Toggles leading icon.
  - `disabled` (`boolean`, default `false`): Disables interactive buttons.
- **State & Derived Variables**:
  - `meta`, `resolvedTone`, `iconSize`, `gapClass`: Derived details.
- **Behavior & Interactivity**:
  - Maps status kinds to icons, tones, and labels inside `STATUS_META`.
  - If `action` is provided, morphs on hover/focus into a button. Swaps visibility of nested child spans using display styles (`group-hover:hidden`, `group-hover:inline-flex` etc.).
- **Visual Design details**:
  - Variants created using `tailwind-variants` (`tv`). Tone values:
    - `correct`: `bg-correct/10 text-correct border-correct/20`
    - `destructive`: `bg-destructive/15 text-destructive border-destructive/20`
    - `unsure`: `bg-surface-container text-unsure border-border/50`
    - `neutral`: `bg-surface-container text-muted-foreground border-border/50`
    - `primary`: `bg-primary text-primary-foreground border-primary shadow-xs`
    - `accent`: `bg-primary text-primary-foreground border-primary`

---

### 3.17. Toast (`toast/`)
- **File Path**: `src/lib/components/toast`

#### 3.17.1. `toast.svelte`
- **Props**:
  - `severity` (`ToastSeverity`, default `"info"`): Severity alert type: `"info"`, `"success"`, `"warning"`, `"error"`.
  - `title` (`string`, optional): Title heading bold string.
  - `message` (`string`, required): Main description text.
  - `onDismiss` (`() => void`, optional): Close button callback.
  - `ref` (`HTMLDivElement | null`, bindable, default `null`): Div container ref.
- **Behavior & Interactivity**:
  - Displays alert card containing severity icons (`SEVERITY_ICON` maps `"info"`, `"check_circle"`, `"warning"`, `"error"`) and description text. Click to close triggers `onDismiss`.
- **Visual Design details**:
  - Hover animation scales card: `transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:scale-[1.02] hover:shadow-xl`.
  - Borders match severity levels: `info` (l-primary), `success` (l-tertiary), `warning` (l-secondary), `error` (l-error).

#### 3.17.2. `toast-container.svelte`
- **Props**:
  - `onDismiss` (`(toast: ToastData) => void`, optional): Close callback.
- **Behavior & Interactivity**:
  - Anchored at bottom-right viewport limits (`fixed bottom-4 right-4 z-50`).
  - Loops reactive global array `toasts.toasts`. Smoothly slides toasts using Svelte transitions `in:fly` / `out:fly` (fly along horizontal x: 24, duration: 250ms, ease `cubicOut`) and rearranges remaining cards via Svelte `animate:flip`.

---

### 3.18. Toggle & Switch (`toggle/`)
- **File Path**: `src/lib/components/toggle`

#### 3.18.1. `toggle.svelte`
- **Props**:
  - `ref` (`HTMLButtonElement | null`, bindable, default `null`): Button element ref.
  - `variant` (`ToggleVariant`, default `"default"`): Variants: `"default"`, `"outline"`, `"ghost"`.
  - `size` (`ToggleSize`, default `"default"`): Sizes: `"default"`, `"sm"`, `"lg"`.
  - `pressed` (`boolean`, bindable, default `false`): Pressed checked state.
- **Behavior & Interactivity**:
  - Clicking toggles `pressed` state. Sets `aria-pressed={pressed}` and `data-state={pressed ? "on" : "off"}`.
- **Visual Design details**:
  - Controlled by `toggleVariants`. E.g. `data-[state=on]:bg-primary data-[state=on]:text-primary-foreground`.

#### 3.18.2. `switch.svelte`
- **Props**:
  - `ref` (`HTMLButtonElement | null`, bindable, default `null`): Button element ref.
  - `size` (`SwitchSize`, default `"default"`): Sizes: `"default"`, `"sm"`, `"lg"`.
  - `checked` (`boolean`, bindable, default `false`): Switch checked state.
- **Behavior & Interactivity**:
  - Renders checkbox switch element (`role="switch"`, `aria-checked={checked}`). Clicking toggles `checked`.
  - Swiping transition on toggle thumb: `transition-transform duration-200 ease-out`.
- **Visual Design details**:
  - Switch sizes: default `h-6 w-11` (thumb size-5), sm `h-5 w-9` (thumb size-4), lg `h-7 w-14` (thumb size-6).
  - Background styles: unchecked (`bg-input/40 dark:bg-input/20`), checked (`data-[state=checked]:bg-primary-foreground/90`).

#### 3.18.3. `tri-state-switch.svelte`
- **Props**:
  - `ref` (`HTMLButtonElement | null`, bindable, default `null`): Button element ref.
  - `size` (`TriStateSwitchSize`, default `"default"`): Sizes: `"default"`, `"sm"`, `"lg"`.
  - `value` (`TriState`, bindable, default `"neutral"`): Active state selection: `"off"`, `"neutral"`, or `"on"`.
- **Behavior & Interactivity**:
  - Cycles sequentially between three states: `off -> neutral -> on -> off` on click.
  - Renders visual icons inside sliding thumb (circle for `off`, dash line for `neutral`, tick mark for `on`).
  - Sets `role="checkbox"` and `aria-checked={value === "neutral" ? "mixed" : value === "on" ? "true" : "false"}`.
- **Visual Design details**:
  - Multi-position translation styling via tailwind-variants compound combinations:
    - Default size translations: `off` (`translate-x-0`), `neutral` (`translate-x-4`), `on` (`translate-x-8`).
  - Switch colors: `off` (`bg-input/40 dark:bg-input/20`), `neutral` (`bg-secondary/60 dark:bg-secondary/40`), `on` (`bg-primary-foreground/90`).
