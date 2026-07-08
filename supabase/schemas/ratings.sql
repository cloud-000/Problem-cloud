-- Glicko-style skill ratings for players and problems — live, per-submission (v3).
--
-- Every player and every problem is a "competitor" with a rating (R) and a
-- rating deviation (RD, the uncertainty of that rating). Every graded
-- submission is a match: correct = the player beat the problem, incorrect =
-- the problem beat the player. This is Glicko-1 run with one-match periods
-- (the way live chess servers run it): both sides update immediately off each
-- other's current state, and RD staleness is continuous — it inflates with
-- real idle time instead of per-period buckets.
--
-- Ratings update LIVE from an AFTER INSERT trigger on `submissions`
-- (`handle_submission_rating`). The batch `recompute_ratings()` remains as the
-- idempotent repair/retune path: it replays the exact same fold over the
-- submission log, so live state ≡ full rebuild by construction. Nothing is
-- stored that the replay cannot reconstruct.
--
-- Model contract:
--   * Seeds        — new competitor starts at rating 1500, rd 350 (max
--                    uncertainty). There is no authored-difficulty prior; a
--                    problem's rating emerges entirely from play.
--   * `scope`      — 'overall' for the single global rating. Per-topic ratings
--                    ('algebra', 'geometry', …) are added later purely as extra
--                    rows under a different scope; no schema change needed.
--   * Encounters   — consecutive graded attempts on a (user, problem) pair
--                    within `encounter_gap` seconds form one encounter. A
--                    BEFORE INSERT trigger annotates each submission with its
--                    encounter index k, attempt index a, and cumulative
--                    encounter time, so every match is fully graded at insert
--                    time (nothing stays "open").
--   * Effort       — time-to-solve (normalized by the problem's running
--                    geometric-mean solve time) pulls the match score toward a
--                    draw. Attempts shape the match WEIGHT, not the score: a
--                    wrong answer weighs retry_weight · attempt_decay^(a-1). The
--                    trainer records only the FINAL outcome per problem (its
--                    intermediate retries never hit the log), so a recorded miss
--                    is a decisive loss at a=1 — hence retry_weight >= 1 so it
--                    counts at least as much as a win. attempt_decay only softens
--                    the rare case of multiple recorded misses in one encounter.
--                    Attempts after an encounter is solved are not rated.
--   * Repeats      — the k-th encounter's weight decays by repeat_decay^(k-1),
--                    so re-solving a memorized problem yields diminishing
--                    movement.
--   * Guess guard  — implausibly fast MCQ answers (< guess_floor_ms) are
--                    low-information: their weight is scaled down, wins and
--                    losses alike.
--   * Staleness    — RD ← min(seed_rd, sqrt(RD² + c²·Δt)) with Δt = idle
--                    seconds / period_seconds, applied lazily before a match.
--
-- Access model mirrors `problems`/`profiles`: ratings are world-readable (they
-- back leaderboards, the library difficulty column, and matchmaking). Clients
-- never write — only `service_role` and the `security definer` triggers /
-- recompute do.

-- Tuning knobs, one row (id is always true). Change a knob with an UPDATE,
-- then run recompute_ratings() to rebuild history under the new constants.
-- The rating_params() accessor below falls back to these same defaults if the
-- row is somehow missing.
create table public.rating_params (
  id             boolean not null primary key default true check (id),
  period_seconds integer not null default 604800, -- time unit for RD growth (1 week)
  repeat_decay   real    not null default 0.5,    -- weight of the k-th encounter = decay^(k-1)
  c              real    not null default 34.6,   -- RD growth per idle period_seconds
  rd_floor       real    not null default 30,     -- minimum RD so ratings stay responsive
  seed_rating    real    not null default 1500,
  seed_rd        real    not null default 350,    -- starting/max RD
  encounter_gap  integer not null default 1800,   -- idle gap (s) that splits encounters
  attempt_decay  real    not null default 0.5,    -- extra weight decay per wrong retry
  retry_weight   real    not null default 1.1,    -- base weight of a wrong answer (>1 = a decisive miss outweighs a win)
  score_swing    real    not null default 0.5,    -- max score deviation from a decisive 0/1
  effort_cap     real    not null default 0.8,    -- cap on time effort (keeps wins/losses ordered)
  min_solves     integer not null default 5,      -- solves before the time signal is trusted
  time_alpha     real    not null default 0.15,   -- EWMA rate for the solve-time normalizer
  guess_floor_ms integer not null default 2000,   -- MCQ answers faster than this are down-weighted
  updated_at     timestamp with time zone not null default now()
);

-- Per-problem running solve-time statistics: the causal normalizer for the
-- time-effort signal. ln_time_ewma is an EWMA of ln(encounter solve time), so
-- exp(ln_time_ewma) tracks the geometric-mean solve time. Maintained live by
-- the rating trigger; rebuilt by recompute_ratings().
create table public.problem_rating_stats (
  problem_id   bigint primary key references public.problems(id) on delete cascade,
  solve_count  integer not null default 0,
  ln_time_ewma double precision,
  updated_at   timestamp with time zone not null default now()
);

-- Current player rating, one row per (user, scope).
create table public.player_ratings (
  user_id       uuid    references public.profiles(id) on delete cascade not null,
  scope         text    not null default 'overall',   -- 'overall' now; topic name later
  rating        real    not null default 1500,
  rd            real    not null default 350,          -- rating deviation (uncertainty)
  matches       integer not null default 0,            -- rated matches counted into this rating
  last_match_at timestamp with time zone,              -- drives continuous RD inflation
  created_at    timestamp with time zone not null default now(),
  updated_at    timestamp with time zone not null default now(),
  primary key (user_id, scope),
  constraint player_ratings_scope_not_empty check (char_length(scope) > 0)
);

-- Leaderboard: top ratings within a scope.
create index player_ratings_scope_rating_idx on public.player_ratings(scope, rating desc);

-- Current problem rating, one row per (problem, scope). For problems the
-- non-'overall' scope equals the problem's own topic.
create table public.problem_ratings (
  problem_id    bigint  references public.problems(id) on delete cascade not null,
  scope         text    not null default 'overall',
  rating        real    not null default 1500,
  rd            real    not null default 350,
  attempts      integer not null default 0,            -- rated attempts counted into this rating
  last_match_at timestamp with time zone,
  created_at    timestamp with time zone not null default now(),
  updated_at    timestamp with time zone not null default now(),
  primary key (problem_id, scope),
  constraint problem_ratings_scope_not_empty check (char_length(scope) > 0)
);

-- Matchmaking: "unseen problems within +/- X of my rating" scans by (scope, rating).
create index problem_ratings_scope_rating_idx on public.problem_ratings(scope, rating);

-- Per-match rating snapshots, for climb/convergence charts. Appended live by
-- the rating trigger; the recompute rewrites the whole series on a rebuild.
create table public.player_rating_history (
  id            bigint generated always as identity primary key,
  user_id       uuid    references public.profiles(id) on delete cascade not null,
  scope         text    not null default 'overall',
  at            timestamp with time zone not null,     -- the match's submission time
  rating        real    not null,
  rd            real    not null,
  submission_id bigint,                                -- the match; not a FK (replay rewrites)
  created_at    timestamp with time zone not null default now()
);

create index player_rating_history_lookup_idx
  on public.player_rating_history(user_id, scope, at);

create table public.problem_rating_history (
  id            bigint generated always as identity primary key,
  problem_id    bigint  references public.problems(id) on delete cascade not null,
  scope         text    not null default 'overall',
  at            timestamp with time zone not null,
  rating        real    not null,
  rd            real    not null,
  submission_id bigint,
  created_at    timestamp with time zone not null default now()
);

create index problem_rating_history_lookup_idx
  on public.problem_rating_history(problem_id, scope, at);

-- Enable Row Level Security (RLS)
alter table public.rating_params          enable row level security;
alter table public.problem_rating_stats   enable row level security;
alter table public.player_ratings         enable row level security;
alter table public.problem_ratings        enable row level security;
alter table public.player_rating_history  enable row level security;
alter table public.problem_rating_history enable row level security;

-- Policies: world-readable, writes go through service_role / the security
-- definer triggers (same model as problems — no client write policies).
create policy "Rating params are viewable by everyone."
  on public.rating_params for select
  using ( true );

create policy "Problem rating stats are viewable by everyone."
  on public.problem_rating_stats for select
  using ( true );

create policy "Player ratings are viewable by everyone."
  on public.player_ratings for select
  using ( true );

create policy "Problem ratings are viewable by everyone."
  on public.problem_ratings for select
  using ( true );

create policy "Player rating history is viewable by everyone."
  on public.player_rating_history for select
  using ( true );

create policy "Problem rating history is viewable by everyone."
  on public.problem_rating_history for select
  using ( true );

-- Grant permissions for roles
grant select on public.rating_params          to anon, authenticated;
grant select on public.problem_rating_stats   to anon, authenticated;
grant select on public.player_ratings         to anon, authenticated;
grant select on public.problem_ratings        to anon, authenticated;
grant select on public.player_rating_history  to anon, authenticated;
grant select on public.problem_rating_history to anon, authenticated;

grant all on public.rating_params          to service_role;
grant all on public.problem_rating_stats   to service_role;
grant all on public.player_ratings         to service_role;
grant all on public.problem_ratings        to service_role;
grant all on public.player_rating_history  to service_role;
grant all on public.problem_rating_history to service_role;

-- ---------------------------------------------------------------------------
-- Pure rating math (shared by the live trigger and the batch replay)
-- ---------------------------------------------------------------------------

-- The tuning row, or the compiled-in defaults if it is missing. Keep the
-- fallback literal in sync with the column defaults on rating_params.
create or replace function public.rating_params()
returns public.rating_params
language plpgsql stable
set search_path = ''
as $$
declare
  p public.rating_params;
begin
  select * into p from public.rating_params where id;
  if not found then
    p := row(true, 604800, 0.5, 34.6, 30, 1500, 350, 1800,
             0.5, 1.1, 0.5, 0.8, 5, 0.15, 2000, now())::public.rating_params;
  end if;
  return p;
end;
$$;

-- g(RD): shrinks a match's impact when the opponent's rating is uncertain.
create or replace function public.glicko_g(rd double precision)
returns double precision
language sql immutable
set search_path = ''
as $$
  select 1.0 / sqrt(1.0 + 3.0 * (ln(10.0) / 400.0)^2 * rd * rd / (pi() * pi()));
$$;

-- E: expected score (win probability) of a rating `r` competitor against an
-- opponent at `r_j` with deviation `rd_j`.
create or replace function public.glicko_e(r double precision, r_j double precision, rd_j double precision)
returns double precision
language sql immutable
set search_path = ''
as $$
  select 1.0 / (1.0 + power(10.0, -public.glicko_g(rd_j) * (r - r_j) / 400.0));
$$;

-- Continuous staleness: inflate RD for idle wall-clock time, in units of
-- period_seconds, capped at the seed RD.
create or replace function public.glicko_inflate(
  rd double precision, idle_seconds double precision, par public.rating_params)
returns double precision
language sql immutable
set search_path = ''
as $$
  select least(par.seed_rd::double precision,
               sqrt(rd * rd + par.c * par.c * greatest(0.0, idle_seconds) / par.period_seconds));
$$;

-- Grade one submission into a weighted match (score s in [0,1], weight w).
-- Time effort (cumulative encounter time vs the problem's running
-- geometric-mean solve time) pulls s toward a draw; attempts and plausibility
-- shape w. Cold start (few solves) or missing timing turns the time term off,
-- degrading to binary Glicko.
create or replace function public.rating_grade(
  correct     boolean,
  enc_ms      bigint,            -- cumulative graded time in this encounter
  k           integer,           -- encounter index (1-based)
  a           integer,           -- attempt index within the encounter (1-based)
  is_mcq      boolean,
  elapsed_ms  integer,           -- this attempt's own time (guess guard)
  solve_count integer,
  ln_ewma     double precision,
  par         public.rating_params,
  out s       real,
  out w       real
)
language plpgsql immutable
set search_path = ''
as $$
declare
  et double precision := 0;  -- time effort in [0, effort_cap]
  wd double precision;
begin
  if solve_count >= par.min_solves and ln_ewma is not null and coalesce(enc_ms, 0) > 0 then
    et := least(par.effort_cap::double precision,
                1.0 - power(2.0, - enc_ms::double precision / exp(ln_ewma)));
  end if;

  s := (case when correct then 1.0 - par.score_swing * et
             else               par.score_swing * et end)::real;

  wd := power(par.repeat_decay::double precision, k - 1);
  if not correct then
    -- The trainer logs only a problem's final outcome, so a recorded miss is a
    -- decisive loss (a=1): retry_weight (>= 1) makes it count at least as much as
    -- a win. attempt_decay only softens extra recorded misses in one encounter.
    wd := wd * par.retry_weight * power(par.attempt_decay::double precision, a - 1);
  end if;
  if is_mcq and coalesce(elapsed_ms, 0) > 0 and elapsed_ms < par.guess_floor_ms then
    -- Implausibly fast MCQ answer: low information either way (guess guard).
    wd := wd * greatest(0.1, elapsed_ms::double precision / par.guess_floor_ms);
  end if;
  w := wd::real;
end;
$$;

-- One side of a single weighted Glicko-1 match: new (rating, rd) for a
-- competitor at (r, rd) against an opponent at (opp_r, opp_rd), given score s
-- and weight w. RD is clamped to [rd_floor, seed_rd]. Callers apply idle
-- inflation (glicko_inflate) to both RDs first.
create or replace function public.glicko_rate(
  r double precision, rd double precision,
  opp_r double precision, opp_rd double precision,
  s double precision, w double precision,
  par public.rating_params,
  out new_rating real,
  out new_rd     real
)
language plpgsql immutable
set search_path = ''
as $$
declare
  q     double precision := ln(10.0) / 400.0;
  g     double precision := public.glicko_g(opp_rd);
  e     double precision := public.glicko_e(r, opp_r, opp_rd);
  denom double precision;
begin
  denom      := 1.0 / (rd * rd) + q * q * w * g * g * e * (1.0 - e);
  new_rating := (r + (q / denom) * w * g * (s - e))::real;
  new_rd     := greatest(par.rd_floor::double precision,
                         least(par.seed_rd::double precision, sqrt(1.0 / denom)))::real;
end;
$$;

-- ---------------------------------------------------------------------------
-- Live path: submission triggers
-- ---------------------------------------------------------------------------

-- BEFORE INSERT: annotate the submission with its encounter index k, attempt
-- index a, and cumulative encounter time, derived from the previous graded
-- submission on the same (user, problem) pair. Always overwrites whatever the
-- client sent, so the annotations cannot be forged. Security definer so the
-- lookup bypasses RLS.
create or replace function public.set_submission_encounter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  par  public.rating_params;
  prev record;
begin
  if new.skipped then
    new.encounter    := null;
    new.attempt      := null;
    new.encounter_ms := null;
    return new;
  end if;

  par := public.rating_params();

  select s.encounter, s.attempt, s.encounter_ms, s.created_at
    into prev
    from public.submissions s
   where s.user_id = new.user_id and s.problem_id = new.problem_id
     and s.skipped = false
   order by s.created_at desc, s.id desc
   limit 1;

  if not found or prev.encounter is null
     or new.created_at - prev.created_at > make_interval(secs => par.encounter_gap) then
    new.encounter    := coalesce(prev.encounter, 0) + 1;
    new.attempt      := 1;
    new.encounter_ms := coalesce(new.elapsed_ms, 0);
  else
    new.encounter    := prev.encounter;
    new.attempt      := prev.attempt + 1;
    new.encounter_ms := prev.encounter_ms + coalesce(new.elapsed_ms, 0);
  end if;

  return new;
end;
$$;

create or replace trigger on_submission_annotate
  before insert on public.submissions
  for each row
  execute function public.set_submission_encounter();

-- AFTER INSERT: rate the match live. Locks the two rating rows (player first,
-- then problem — consistent order, no deadlocks), inflates both RDs for idle
-- time, grades the submission, applies the Glicko update to both sides,
-- appends history, and advances the problem's solve-time stats on a solve.
-- Any error is downgraded to a warning: a rating bug must never block the
-- submission log (recompute_ratings() can always repair).
create or replace function public.handle_submission_rating()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  par     public.rating_params;
  pr      public.player_ratings;
  qr      public.problem_ratings;
  st      public.problem_rating_stats;
  mcq     boolean;
  gr      record;  -- (s, w)
  pn      record;  -- new player (rating, rd)
  qn      record;  -- new problem (rating, rd)
  p_rd    double precision;
  q_rd    double precision;
begin
  -- Skips and ungraded attempts (is_correct null — e.g. answerless problems)
  -- are not matches: there is no outcome to rate.
  if new.skipped or new.is_correct is null then
    return new;
  end if;

  -- Attempts after the encounter is already solved are not rated (re-solving
  -- within the same sitting is practice, not evidence).
  if exists (
    select 1 from public.submissions s
     where s.user_id = new.user_id and s.problem_id = new.problem_id
       and s.encounter = new.encounter and s.id < new.id
       and s.skipped = false and coalesce(s.is_correct, false)
  ) then
    return new;
  end if;

  par := public.rating_params();

  insert into public.player_ratings (user_id, scope, rating, rd)
    values (new.user_id, 'overall', par.seed_rating, par.seed_rd)
    on conflict (user_id, scope) do nothing;
  select * into strict pr from public.player_ratings
   where user_id = new.user_id and scope = 'overall'
   for update;

  insert into public.problem_ratings (problem_id, scope, rating, rd)
    values (new.problem_id, 'overall', par.seed_rating, par.seed_rd)
    on conflict (problem_id, scope) do nothing;
  select * into strict qr from public.problem_ratings
   where problem_id = new.problem_id and scope = 'overall'
   for update;

  insert into public.problem_rating_stats (problem_id)
    values (new.problem_id)
    on conflict (problem_id) do nothing;
  select * into strict st from public.problem_rating_stats
   where problem_id = new.problem_id
   for update;

  select (choices is not null) into mcq from public.problems where id = new.problem_id;

  p_rd := public.glicko_inflate(pr.rd,
            extract(epoch from new.created_at - coalesce(pr.last_match_at, new.created_at))::double precision, par);
  q_rd := public.glicko_inflate(qr.rd,
            extract(epoch from new.created_at - coalesce(qr.last_match_at, new.created_at))::double precision, par);

  select * into gr from public.rating_grade(
    coalesce(new.is_correct, false), new.encounter_ms, new.encounter, new.attempt,
    coalesce(mcq, false), new.elapsed_ms, st.solve_count, st.ln_time_ewma, par);

  select * into pn from public.glicko_rate(pr.rating, p_rd, qr.rating, q_rd, gr.s, gr.w, par);
  select * into qn from public.glicko_rate(qr.rating, q_rd, pr.rating, p_rd, 1.0 - gr.s, gr.w, par);

  update public.player_ratings
     set rating = pn.new_rating, rd = pn.new_rd, matches = matches + 1,
         last_match_at = new.created_at, updated_at = now()
   where user_id = new.user_id and scope = 'overall';
  update public.problem_ratings
     set rating = qn.new_rating, rd = qn.new_rd, attempts = attempts + 1,
         last_match_at = new.created_at, updated_at = now()
   where problem_id = new.problem_id and scope = 'overall';

  insert into public.player_rating_history (user_id, scope, at, rating, rd, submission_id)
    values (new.user_id, 'overall', new.created_at, pn.new_rating, pn.new_rd, new.id);
  insert into public.problem_rating_history (problem_id, scope, at, rating, rd, submission_id)
    values (new.problem_id, 'overall', new.created_at, qn.new_rating, qn.new_rd, new.id);

  if coalesce(new.is_correct, false) and coalesce(new.encounter_ms, 0) > 0 then
    update public.problem_rating_stats
       set solve_count  = solve_count + 1,
           ln_time_ewma = case
             when ln_time_ewma is null then ln(new.encounter_ms::double precision)
             else par.time_alpha * ln(new.encounter_ms::double precision)
                  + (1.0 - par.time_alpha) * ln_time_ewma
           end,
           updated_at = now()
     where problem_id = new.problem_id;
  elsif coalesce(new.is_correct, false) then
    update public.problem_rating_stats
       set solve_count = solve_count + 1, updated_at = now()
     where problem_id = new.problem_id;
  end if;

  return new;
exception when others then
  raise warning 'rating update failed for submission %: %', new.id, sqlerrm;
  return new;
end;
$$;

create or replace trigger on_submission_rate
  after insert on public.submissions
  for each row
  execute function public.handle_submission_rating();

-- ---------------------------------------------------------------------------
-- Batch replay: full deterministic rebuild
-- ---------------------------------------------------------------------------

-- Old batch-period signature; the declarative diff should replace, not add.
drop function if exists public.recompute_ratings(integer, real, real, real, real, real, integer, real, real, real, integer, real);

-- Full deterministic rebuild of every rating from the submissions log: the
-- exact same fold the live trigger applies incrementally, replayed in
-- (created_at, id) order. Idempotent — resets to seeds first — so it can be
-- re-run any time (after tuning rating_params, or to repair live drift). Also
-- re-derives the encounter annotations on `submissions`, keeping them
-- consistent with the current encounter_gap. Returns a summary.
create or replace function public.recompute_ratings()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  par       public.rating_params;
  rec       record;
  psr       record;
  qsr       record;
  str       record;
  gr        record;
  pn        record;
  qn        record;
  p_rd      double precision;
  q_rd      double precision;
  n_matches bigint := 0;
begin
  par := public.rating_params();

  -- 1. Re-derive the encounter annotations from the log (window-function
  --    equivalent of the incremental BEFORE INSERT rule).
  with graded as (
    select id, user_id as uid, problem_id as pid, created_at,
           coalesce(elapsed_ms, 0) as ems,
           case when lag(created_at) over w is null
                  or created_at - lag(created_at) over w
                     > make_interval(secs => par.encounter_gap)
                then 1 else 0 end as new_enc
      from public.submissions
     where skipped = false
    window w as (partition by user_id, problem_id order by created_at, id)
  ),
  enc as (
    select g.*,
           sum(new_enc) over (partition by uid, pid order by created_at, id) as k
      from graded g
  ),
  derived as (
    select id, k::int as k,
           row_number() over wk as a,
           sum(ems) over (wk rows between unbounded preceding and current row) as enc_ms
      from enc
    window wk as (partition by uid, pid, k order by created_at, id)
  )
  update public.submissions s
     set encounter = d.k, attempt = d.a::int, encounter_ms = d.enc_ms
    from derived d
   where s.id = d.id
     and (s.encounter is distinct from d.k
       or s.attempt is distinct from d.a::int
       or s.encounter_ms is distinct from d.enc_ms);

  update public.submissions
     set encounter = null, attempt = null, encounter_ms = null
   where skipped = true
     and (encounter is not null or attempt is not null or encounter_ms is not null);

  -- 2. Reset persistent state to seeds and wipe the derived series. TRUNCATE,
  --    not an unqualified DELETE: Supabase preloads `safeupdate` for the API
  --    roles, which rejects UPDATE/DELETE without WHERE even inside a security
  --    definer function.
  update public.player_ratings
     set rating = par.seed_rating, rd = par.seed_rd, matches = 0,
         last_match_at = null, updated_at = now()
   where scope = 'overall';
  insert into public.player_ratings (user_id, scope, rating, rd)
    select distinct user_id, 'overall', par.seed_rating, par.seed_rd
      from public.submissions where skipped = false and is_correct is not null
    on conflict (user_id, scope) do nothing;

  update public.problem_ratings
     set rating = par.seed_rating, rd = par.seed_rd, attempts = 0,
         last_match_at = null, updated_at = now()
   where scope = 'overall';
  insert into public.problem_ratings (problem_id, scope, rating, rd)
    select id, 'overall', par.seed_rating, par.seed_rd from public.problems
    on conflict (problem_id, scope) do nothing;

  truncate public.player_rating_history;
  truncate public.problem_rating_history;
  truncate public.problem_rating_stats;

  -- 3. Working state, in the same numeric types as the persistent tables so
  --    the replay quantizes identically to the live path.
  drop table if exists ps, qs, st;

  create temp table ps on commit drop as
    select distinct user_id as uid,
           par.seed_rating::real as rating, par.seed_rd::real as rd,
           0 as matches, null::timestamptz as last_at
      from public.submissions where skipped = false and is_correct is not null;
  create unique index on ps(uid);

  create temp table qs on commit drop as
    select distinct s.problem_id as pid,
           par.seed_rating::real as rating, par.seed_rd::real as rd,
           0 as attempts, null::timestamptz as last_at,
           (p.choices is not null) as is_mcq
      from public.submissions s
      join public.problems p on p.id = s.problem_id
     where s.skipped = false and s.is_correct is not null;
  create unique index on qs(pid);

  create temp table st (
    pid         bigint primary key,
    solve_count integer not null default 0,
    ln_ewma     double precision
  ) on commit drop;
  insert into st (pid) select pid from qs;

  -- 4. The fold: replay every rated match in time order — identical math and
  --    quantization to handle_submission_rating. Ungraded attempts
  --    (is_correct null) are annotated but, like skips, never rated.
  for rec in
    select s.id, s.user_id as uid, s.problem_id as pid, s.created_at,
           s.is_correct as correct,
           s.elapsed_ms, s.encounter as k, s.attempt as a, s.encounter_ms,
           coalesce(bool_or(s.is_correct) over (
             partition by s.user_id, s.problem_id, s.encounter
             order by s.created_at, s.id
             rows between unbounded preceding and 1 preceding
           ), false) as already_solved
      from public.submissions s
     where s.skipped = false and s.is_correct is not null
     order by s.created_at, s.id
  loop
    continue when rec.already_solved;

    select * into strict psr from ps where uid = rec.uid;
    select * into strict qsr from qs where pid = rec.pid;
    select * into strict str from st where pid = rec.pid;

    p_rd := public.glicko_inflate(psr.rd,
              extract(epoch from rec.created_at - coalesce(psr.last_at, rec.created_at))::double precision, par);
    q_rd := public.glicko_inflate(qsr.rd,
              extract(epoch from rec.created_at - coalesce(qsr.last_at, rec.created_at))::double precision, par);

    select * into gr from public.rating_grade(
      rec.correct, rec.encounter_ms, rec.k, rec.a,
      qsr.is_mcq, rec.elapsed_ms, str.solve_count, str.ln_ewma, par);

    select * into pn from public.glicko_rate(psr.rating, p_rd, qsr.rating, q_rd, gr.s, gr.w, par);
    select * into qn from public.glicko_rate(qsr.rating, q_rd, psr.rating, p_rd, 1.0 - gr.s, gr.w, par);

    update ps set rating = pn.new_rating, rd = pn.new_rd,
                  matches = matches + 1, last_at = rec.created_at
     where uid = rec.uid;
    update qs set rating = qn.new_rating, rd = qn.new_rd,
                  attempts = attempts + 1, last_at = rec.created_at
     where pid = rec.pid;

    insert into public.player_rating_history (user_id, scope, at, rating, rd, submission_id)
      values (rec.uid, 'overall', rec.created_at, pn.new_rating, pn.new_rd, rec.id);
    insert into public.problem_rating_history (problem_id, scope, at, rating, rd, submission_id)
      values (rec.pid, 'overall', rec.created_at, qn.new_rating, qn.new_rd, rec.id);

    if rec.correct then
      update st
         set solve_count = solve_count + 1,
             ln_ewma = case
               when coalesce(rec.encounter_ms, 0) <= 0 then ln_ewma
               when ln_ewma is null then ln(rec.encounter_ms::double precision)
               else par.time_alpha * ln(rec.encounter_ms::double precision)
                    + (1.0 - par.time_alpha) * ln_ewma
             end
       where pid = rec.pid;
    end if;

    n_matches := n_matches + 1;
  end loop;

  -- 5. Persist final states.
  update public.player_ratings pr
     set rating = ps.rating, rd = ps.rd, matches = ps.matches,
         last_match_at = ps.last_at, updated_at = now()
    from ps where pr.user_id = ps.uid and pr.scope = 'overall';
  update public.problem_ratings qr
     set rating = qs.rating, rd = qs.rd, attempts = qs.attempts,
         last_match_at = qs.last_at, updated_at = now()
    from qs where qr.problem_id = qs.pid and qr.scope = 'overall';

  insert into public.problem_rating_stats (problem_id, solve_count, ln_time_ewma)
    select pid, solve_count, ln_ewma from st;

  return jsonb_build_object(
    'players',  (select count(*) from ps),
    'problems', (select count(*) from qs),
    'matches',  n_matches
  );
end;
$$;

-- Batch/admin operation only — not exposed to app clients.
revoke all on function public.recompute_ratings() from public;
grant execute on function public.recompute_ratings() to service_role;

-- Admin entry point for the app. `recompute_ratings` is service_role-only (a full
-- rebuild), but the app's Supabase client runs as `authenticated`; this thin
-- security-definer wrapper re-checks admin_rank (defense in depth, same pattern as
-- review_answer_suggestion) and then runs the rebuild. Returns the same jsonb
-- summary { players, problems, matches }.
create or replace function public.admin_recompute_ratings()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rank integer;
begin
  select admin_rank into v_rank from public.profiles where id = auth.uid();
  if coalesce(v_rank, 0) <= 0 then
    raise exception 'not authorized';
  end if;
  return public.recompute_ratings();
end;
$$;

revoke all on function public.admin_recompute_ratings() from public;
grant execute on function public.admin_recompute_ratings() to authenticated;
