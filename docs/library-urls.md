# Library views and URLs

The Library's URL describes its active view. Refreshing, sharing a link, and browser
Back/Forward restore the same tab, scope, and filters. Results can differ by account
(personal progress) and by this device's downloaded catalog.

## Ownership

- `src/lib/library/filters.ts`: tab/filter types and slider bounds. Existing data
  callers still import the superset from `library.ts`, which re-exports these types.
- `src/lib/library/view.ts`: pure snapshot normalization, dependent resets, actions,
  history policy, and stable query identity. No browser, Svelte, or database imports.
- `src/lib/library/url.ts`: the parameter vocabulary and bidirectional codec.
  Normalization owns applicability; the codec only translates representations.
- `src/lib/library/navigation.ts`: serializes actions against the last committed
  location. The host supplies URL reads and navigation; no browser APIs live here.
- `library/+page.svelte`: the SvelteKit host. Read `page.shallow?.url ?? page.url`
  because SvelteKit 3 keeps the loaded route URL separate from shallow updates.
  Write with `goto(url, { shallow: true, replace, state: page.state })`.
- `Filters.svelte` and `ResultList.svelte`: receive `view` and `onaction`. Controls
  reflect props and emit gestures, never write initial values back on mount.
- `state/library.svelte.ts`: an in-memory host using the same transitions for the
  tour. Embedded surfaces do not modify their host page's URL.
- `library.ts` and `problem-filter-spec.ts`: execute effective filters remotely or
  locally, independently of URL encoding.

Loaded labels, errors, results, pagination, scroll, and panel visibility are not
part of the view. Metadata resolves separately with ID fallbacks and never changes
query semantics. Dynamic slider bounds do not rewrite URL filters when they load.
The result effect watches a canonical view key, so equivalent list ordering and
label lookups cannot refetch results.

## Parameters

`/library` defaults to Problems. `tab=tests` and `tab=series` select other tabs.
`tab=problems` is accepted but omitted when writing.

- `search`: exact problem IDs on Problems; names or IDs on Tests and Series.
- `series`, `test`: positive integer scope IDs. A test can be linked without a series.
- `topic`, `tag`, `mastery`, `plan`, `division`, `format`, `type`: repeated list
  parameters. Topics use stored codes (`A`, `C`, `G`, `N`, `K`, `O`). Freeform values
  are encoded individually, so commas and ampersands survive round trips.
- `rating`, `quality`, `year`, `problemNumbers`: inclusive `min..max` ranges.
  Problem numbers are 1-based.
- `official`, `computational`, `verified`: `true` or `false`; absence means Any.

Only fields relevant to the active tab survive normalization. Divisions/formats
require a series and disappear under a test; problem-number ranges require a series
or test. Problem year ranges require a series and disappear under a test. Tests can
have a global year range. Full default slider ranges are omitted to include null
values. Malformed scalars/ranges and unknown enum members are ignored. Lists are
trimmed, deduplicated, and sorted. Rewriting preserves unrelated parameters and hashes.

Examples:

```text
/library?tab=tests&series=7&year=2020..2025
/library?topic=A&topic=G&rating=1200..1800
/library?test=91&problemNumbers=15..25
/library?tab=series&official=false
```

## Actions and history

Tabs and drill-downs push browser entries; filter edits, chip removals, and Clear
replace the current entry. There is no independent Library history stack. Switching
tabs starts fresh; selecting the active tab leaves the current view alone.

Selecting a series and drilling into it produce the same scope behavior. Changing
a series clears its dependent fields atomically. Removing a series also removes
the test. Removing a test retains an explicitly selected series and drops its number
range. Clear removes optional filters while retaining search and scope.

Snapshot parsing validates the entire requested view; it does not replay actions.
For example, restoring a URL with a series and its divisions must keep both, while
changing that series through a control must discard its old divisions.

## Validation

Pure tests cover codec round trips, normalization, transitions, queued navigation,
reload/Back/Forward snapshots, and local/remote test-only number filtering.
`e2e/library-urls.e2e.ts` covers actual SvelteKit shallow URLs and controlled filters
against an explicitly provided server, using a guest cookie and mocked catalog rows.
Run with `PC_E2E_BASE_URL=<server> bun run test:e2e e2e/library-urls.e2e.ts`.
Do not start a dev/build/preview server without the user's explicit instruction.
