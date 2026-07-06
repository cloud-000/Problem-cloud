-- Content sync: idempotent, non-destructive merge of scraped contest content
-- (series / tests / problems) from the AoPS-Scrape pipeline into the live tables.
--
-- WHY THIS EXISTS
-- The scraper is the source of truth for problem *content*, but the cloud is the
-- source of truth for *curation* (difficulty, quality, verified, notes) and for
-- all user data (submissions, feedback, practice sessions) that FK into
-- problems.id ON DELETE CASCADE. A naive "reload the tables" would cascade-delete
-- every user's history and renumber the ids everything points at. So instead we:
--
--   1. Never delete. Ids are assigned once on INSERT and are immutable forever;
--      ON CONFLICT DO UPDATE keeps the existing row (and its id) and only
--      rewrites scraper-owned columns. Every FK stays valid across every sync.
--   2. Match on a stable, source-agnostic `sync_key` (below), NOT on the
--      scraper's volatile row ids and NOT on aops ids (7 tests / 178 problems are
--      PDF-only and have none — and NULLs never dedup, so they'd duplicate).
--   3. Seed-then-lock curator columns: set them on first INSERT, never touch them
--      on UPDATE, so a curator's edits are never clobbered by a resync.
--   4. Flag, never remove, live rows a scrape no longer covers (see
--      public.sync_unmatched_problems()).
--
-- SYNC_KEY FORMULA  (delimiter = chr(31), the U+001F unit separator — chosen so
-- it never occurs in a title, letting us use raw values with no slug/case
-- folding, which keeps the scraper's JS and this SQL byte-for-byte identical):
--
--   series   : matched on name (already unique) — no sync_key column needed.
--   test     : aops-sourced  -> 'aops'   ∙ aops_category_id ∙ section
--              PDF/manual     -> 'manual' ∙ series_name ∙ year ∙ name ∙ section
--   problem  : <test.sync_key> ∙ 'n' ∙ n
--
-- (∙ = chr(31)). The scraper MUST emit these exact strings into the staging
-- tables; public.backfill_content_sync_keys() reproduces them for legacy rows.
--
-- RUNBOOK (service_role, against the linked project):
--   psql "$DATABASE_URL" -f staging_load.sql                     -- fill _import_*
--   psql "$DATABASE_URL" -c "select * from sync_scraped_content(true);"   -- dry run
--   psql "$DATABASE_URL" -c "select * from sync_scraped_content(false);"  -- apply
--   psql "$DATABASE_URL" -c "select * from sync_unmatched_problems();"    -- review


-- ---------------------------------------------------------------------------
-- Staging tables. Transient; TRUNCATE + reload each sync. UNLOGGED (no WAL /
-- backup — they hold nothing durable). service_role-only: RLS on with no policy
-- denies anon/authenticated, and service_role bypasses RLS.
-- ---------------------------------------------------------------------------
create unlogged table public._import_series (
  name        text primary key,
  aops_id     integer,
  is_official boolean not null default false
);

create unlogged table public._import_tests (
  sync_key         text primary key,
  series_name      text not null,   -- resolved to series_id at merge time
  name             text not null,
  year             integer,
  aops_category_id text,
  section          integer not null default -1,
  type             text,
  is_computational boolean not null default false,
  difficulty       integer default 0,   -- seed-only
  quality          integer default 0    -- seed-only
);

create unlogged table public._import_problems (
  sync_key           text primary key,
  test_sync_key      text not null,   -- resolved to test_id at merge time
  n                  integer not null,
  aops_id            integer,
  statement          text,
  choices            text[],
  answer_index       integer default -1,
  official_solutions text[],
  topic              text,
  tags               text[],
  is_computational   boolean not null default false,
  difficulty         integer default 0,   -- seed-only
  quality            integer default 0,   -- seed-only
  verified           boolean not null default false,  -- seed-only
  notes              text                              -- seed-only
);

alter table public._import_series   enable row level security;
alter table public._import_tests    enable row level security;
alter table public._import_problems enable row level security;

grant all on public._import_series   to service_role;
grant all on public._import_tests    to service_role;
grant all on public._import_problems to service_role;

-- Supabase's project default privileges auto-grant anon/authenticated on every
-- new public table (including TRUNCATE). Strip those back: staging is
-- service_role-only, no exceptions.
revoke all on public._import_series   from anon, authenticated;
revoke all on public._import_tests    from anon, authenticated;
revoke all on public._import_problems from anon, authenticated;


-- ---------------------------------------------------------------------------
-- Prepare a legacy DB for syncing. Idempotent; called at the top of
-- sync_scraped_content. Two jobs:
--   1. Backfill sync_key on rows loaded before this mechanism existed (using the
--      exact formula above), so the first sync MATCHES existing rows — preserving
--      their ids — instead of inserting duplicates.
--   2. Realign the identity sequences. The prior destructive export inserted
--      explicit ids, which does not advance a `generated by default as identity`
--      sequence, so the next auto id would collide. Fast-forward each sequence
--      past max(id) so the first freshly-inserted problem/test/series is safe.
-- ---------------------------------------------------------------------------
create or replace function public.backfill_content_sync_keys()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tests t
  set sync_key = case
    when t.aops_category_id is not null
      then 'aops'   || chr(31) || t.aops_category_id || chr(31) || t.section::text
      else 'manual' || chr(31) || coalesce(s.name, '')
                    || chr(31) || coalesce(t.year::text, '')
                    || chr(31) || t.name
                    || chr(31) || t.section::text
  end
  from public.series s
  where t.series_id = s.id
    and t.sync_key is null;

  -- Tests with no series_id (should not happen) get the manual form with an
  -- empty series component rather than being skipped.
  update public.tests t
  set sync_key = 'manual' || chr(31) || '' || chr(31) || coalesce(t.year::text, '')
                          || chr(31) || t.name || chr(31) || t.section::text
  where t.sync_key is null
    and t.aops_category_id is null;

  update public.problems p
  set sync_key = t.sync_key || chr(31) || 'n' || chr(31) || p.n::text
  from public.tests t
  where p.test_id = t.id
    and t.sync_key is not null
    and p.sync_key is null;

  -- Realign identity sequences past the max explicit id in each table. is_called
  -- = (a row exists), so an empty table resets to hand out 1 next.
  perform pg_catalog.setval(pg_catalog.pg_get_serial_sequence('public.series', 'id'),
                            coalesce((select pg_catalog.max(id) from public.series), 1),
                            (select pg_catalog.count(*) > 0 from public.series));
  perform pg_catalog.setval(pg_catalog.pg_get_serial_sequence('public.tests', 'id'),
                            coalesce((select pg_catalog.max(id) from public.tests), 1),
                            (select pg_catalog.count(*) > 0 from public.tests));
  perform pg_catalog.setval(pg_catalog.pg_get_serial_sequence('public.problems', 'id'),
                            coalesce((select pg_catalog.max(id) from public.problems), 1),
                            (select pg_catalog.count(*) > 0 from public.problems));
end;
$$;


-- ---------------------------------------------------------------------------
-- The merge. Runs series -> tests -> problems in one transaction. Returns a
-- one-row summary (inserted/updated per table + unmatched count). With
-- dry_run => true it performs the full merge, captures real counts, then unwinds
-- all writes via the block's implicit savepoint (a sentinel RAISE) and returns
-- the counts anyway — so the numbers are exact with zero duplicated "what-if"
-- logic. Referential gaps (a test naming an unknown series, a problem naming an
-- unknown test) abort the whole sync loudly.
-- ---------------------------------------------------------------------------
create or replace function public.sync_scraped_content(dry_run boolean default true)
returns table (
  applied            boolean,
  series_inserted    integer,
  series_updated     integer,
  tests_inserted     integer,
  tests_updated      integer,
  problems_inserted  integer,
  problems_updated   integer,
  problems_unmatched integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_series_ins    integer := 0;
  v_series_upd    integer := 0;
  v_tests_ins     integer := 0;
  v_tests_upd     integer := 0;
  v_problems_ins  integer := 0;
  v_problems_upd  integer := 0;
  v_unmatched     integer := 0;
  v_bad           integer;
begin
  perform public.backfill_content_sync_keys();

  -- series: match on name; aops_id / is_official are scraper-owned.
  with ins as (
    insert into public.series (name, aops_id, is_official)
    select name, aops_id, is_official
    from public._import_series
    on conflict (name) do update
      set aops_id     = excluded.aops_id,
          is_official = excluded.is_official
    returning (xmax = 0) as inserted
  )
  select
    pg_catalog.count(*) filter (where inserted),
    pg_catalog.count(*) filter (where not inserted)
  into v_series_ins, v_series_upd
  from ins;

  -- Fail loudly on tests referencing a series we don't have (atomic: rolls back).
  select pg_catalog.count(*) into v_bad
  from public._import_tests it
  left join public.series s on s.name = it.series_name
  where s.id is null;
  if v_bad > 0 then
    raise exception 'sync: % staging test(s) reference an unknown series', v_bad;
  end if;

  -- tests: match on sync_key. name/year/type/is_computational are scraper-owned;
  -- difficulty/quality (and time_limit_seconds) are seed-then-lock. section and
  -- aops_category_id are identity components (baked into sync_key) so they only
  -- ever change by minting a new key -> a new row; not updated here.
  with src as (
    select it.sync_key, s.id as series_id, it.name, it.year, it.aops_category_id,
           it.section, it.type, it.is_computational, it.difficulty, it.quality
    from public._import_tests it
    join public.series s on s.name = it.series_name
  ),
  ins as (
    insert into public.tests
      (sync_key, series_id, name, year, aops_category_id, section,
       type, is_computational, difficulty, quality)
    select sync_key, series_id, name, year, aops_category_id, section,
           type, is_computational, difficulty, quality
    from src
    on conflict (sync_key) do update
      set series_id        = excluded.series_id,
          name             = excluded.name,
          year             = excluded.year,
          type             = excluded.type,
          is_computational = excluded.is_computational
    returning (xmax = 0) as inserted
  )
  select
    pg_catalog.count(*) filter (where inserted),
    pg_catalog.count(*) filter (where not inserted)
  into v_tests_ins, v_tests_upd
  from ins;

  -- Fail loudly on problems referencing a test we don't have.
  select pg_catalog.count(*) into v_bad
  from public._import_problems ip
  left join public.tests t on t.sync_key = ip.test_sync_key
  where t.id is null;
  if v_bad > 0 then
    raise exception 'sync: % staging problem(s) reference an unknown test', v_bad;
  end if;

  -- problems: match on sync_key. Content columns are scraper-owned;
  -- difficulty/quality/verified/notes are seed-then-lock. test_id and n are
  -- identity components (in sync_key) and so are set on insert only.
  with src as (
    select ip.sync_key, t.id as test_id, ip.n, ip.aops_id, ip.statement,
           ip.choices, ip.answer_index, ip.official_solutions, ip.topic, ip.tags,
           ip.is_computational, ip.difficulty, ip.quality, ip.verified, ip.notes
    from public._import_problems ip
    join public.tests t on t.sync_key = ip.test_sync_key
  ),
  ins as (
    insert into public.problems
      (sync_key, test_id, n, aops_id, statement, choices, answer_index,
       official_solutions, topic, tags, is_computational,
       difficulty, quality, verified, notes)
    select sync_key, test_id, n, aops_id, statement, choices, answer_index,
           official_solutions, topic, tags, is_computational,
           difficulty, quality, verified, notes
    from src
    on conflict (sync_key) do update
      set aops_id            = excluded.aops_id,
          statement          = excluded.statement,
          choices            = excluded.choices,
          answer_index       = excluded.answer_index,
          official_solutions = excluded.official_solutions,
          topic              = excluded.topic,
          tags               = excluded.tags,
          is_computational   = excluded.is_computational
    returning (xmax = 0) as inserted
  )
  select
    pg_catalog.count(*) filter (where inserted),
    pg_catalog.count(*) filter (where not inserted)
  into v_problems_ins, v_problems_upd
  from ins;

  -- Unmatched: live problems whose test is part of THIS import (so a partial
  -- scrape never flags untouched series) but whose sync_key is absent from the
  -- staged problems — i.e. removed or renumbered upstream. Count only; detail
  -- via public.sync_unmatched_problems().
  select pg_catalog.count(*) into v_unmatched
  from public.problems p
  where p.sync_key is not null
    and p.test_id in (
      select t.id from public.tests t
      join public._import_tests it on it.sync_key = t.sync_key
    )
    and not exists (
      select 1 from public._import_problems ip where ip.sync_key = p.sync_key
    );

  if dry_run then
    -- Unwind every write above; the summary vars survive the savepoint rollback.
    raise exception using errcode = 'P0001', message = 'SYNC_DRY_RUN';
  end if;

  return query select true, v_series_ins, v_series_upd, v_tests_ins, v_tests_upd,
                      v_problems_ins, v_problems_upd, v_unmatched;

exception
  when raise_exception then
    if sqlerrm = 'SYNC_DRY_RUN' then
      return query select false, v_series_ins, v_series_upd, v_tests_ins,
                          v_tests_upd, v_problems_ins, v_problems_upd, v_unmatched;
    else
      raise;   -- a real referential-gap abort (or anything else): propagate
    end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- Detail for the unmatched (removed/renumbered) rows the summary counts. Pure
-- read of live tables vs staging, so it is meaningful in both dry-run and
-- applied states. Review these by hand; the never-delete policy means their ids
-- (and any user submissions attached to them) are preserved until you act.
-- ---------------------------------------------------------------------------
create or replace function public.sync_unmatched_problems()
returns table (
  problem_id bigint,
  test_id    bigint,
  test_name  text,
  n          integer,
  sync_key   text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.test_id, t.name, p.n, p.sync_key
  from public.problems p
  join public.tests t on t.id = p.test_id
  where p.sync_key is not null
    and p.test_id in (
      select t2.id from public.tests t2
      join public._import_tests it on it.sync_key = t2.sync_key
    )
    and not exists (
      select 1 from public._import_problems ip where ip.sync_key = p.sync_key
    )
  order by t.name, p.n;
$$;


-- Admin surface only — never exposed to anon/authenticated.
grant execute on function public.backfill_content_sync_keys  to service_role;
grant execute on function public.sync_scraped_content        to service_role;
grant execute on function public.sync_unmatched_problems     to service_role;
