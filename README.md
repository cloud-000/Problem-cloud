# ProblemCloud

Browse and practice competition math problems (algebra, combinatorics, geometry, number theory), track your progress, and get help from an AI coach.

Built with SvelteKit (Svelte 5 runes), Tailwind CSS v4, Supabase (auth + database), and Bun.

## Features

- **Problem library & practice** — browse problems by test/topic, practice with a live trainer, or take timed fixed tests
- **Skill ratings** — players and problems rated live with Glicko-1 on every graded submission ([docs/ratings.md](docs/ratings.md))
- **Progress analytics** — first-try vs. eventual solve rates, topic breakdowns, and practice history
- **Goals** — commitments on a slice of the catalog ([docs/goals.md](docs/goals.md))
- **AI Coach** — bring-your-own-key chat that runs in your browser, plus an optional hosted offer ([docs/ai-coach-sessions.md](docs/ai-coach-sessions.md))
- **Whiteboard** — full drawing/solving canvas with its own pure-TS core (`src/lib/whiteboard/ARCHITECTURE.md`)
- **Offline mode** — staged packages, local queries, and a service worker for offline practice ([docs/offline.md](docs/offline.md))

## Getting started

Requirements: [Bun](https://bun.sh), and the [Supabase CLI](https://supabase.com/docs/guides/cli) for the local database.

```bash
bun install        # install deps + vendor KaTeX/fonts/icons into static/
supabase start     # local database (runs migrations + seed)
cp .env.example .env   # fill in PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_PUBLISHABLE_KEY
bun run dev        # start the dev server
```

## Common commands

| Command              | What it does                                          |
| -------------------- | ----------------------------------------------------- |
| `bun run dev`        | Vite dev server                                       |
| `bun run check`      | svelte-check type checking (static-analysis gate)     |
| `bun test`           | Unit tests                                            |
| `bun run test:e2e`   | Playwright e2e (needs `bunx playwright install chromium webkit`) |
| `bun run build`      | Production build                                      |
| `bun run vendor:assets` | Re-download KaTeX / fonts / icon subset            |

## Deployment

Production runs on Cloudflare Pages at https://problem-cloud.pages.dev, with
SvelteKit SSR and server routes handled by the Cloudflare adapter. The Pages
configuration lives in `wrangler.jsonc`.

Run `bun run deploy` to build and deploy the current checkout to production.
The build needs the production `PUBLIC_SUPABASE_URL` and
`PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `.env` or the build environment. Server
secrets (`SUPABASE_SECRET_KEY` and `AI_COACH_HOSTED_API_KEY`) belong in the
Pages project's encrypted environment variables, never in the config file.
Supabase Auth must allow `https://problem-cloud.pages.dev/auth/callback`.

Deployments use direct upload; pushing a Git commit alone does not deploy.

## Docs

Feature and design docs live in [`docs/`](docs/). For architecture and conventions aimed at AI agents/contributors, see [CLAUDE.md](CLAUDE.md) and [AGENTS.md](AGENTS.md).
