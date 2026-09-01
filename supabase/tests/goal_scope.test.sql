-- Scope resolution + eligibility semantics (`docs/goals.md` §3–§5, §12).
--
-- Fixture: two series with different vocabularies, one duplicated problem whose
-- alias lives under the OTHER series, and a spread of ungradeable rows. The
-- shape is chosen so that the wrong implementation of each rule produces a
-- visibly different count rather than an off-by-one.
--
-- Ids are negative throughout so the fixture can never collide with synced
-- catalog content.

begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(20);

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------

insert into public.series (id, name) values
  (-920001, 'test:goal-scope:alpha'),
  (-920002, 'test:goal-scope:beta');

-- Alpha is classified by division AND format; beta is unclassified. A division
-- name is deliberately REUSED across the two series ('State'), because the rule
-- under test is that a narrowing chosen for one series never filters another.
insert into public.tests (id, series_id, name, year, division, format, sync_key) values
  (-920011, -920001, 'alpha state sprint 2020', 2020, 'State',    'Sprint', 'test:goal-scope:t1'),
  (-920012, -920001, 'alpha state team 2021',   2021, 'State',    'Team',   'test:goal-scope:t2'),
  (-920013, -920001, 'alpha national sprint 22',2022, 'National', 'Sprint', 'test:goal-scope:t3'),
  (-920014, -920002, 'beta state 2020',         2020, 'State',    'Team',   'test:goal-scope:t4'),
  (-920015, -920002, 'beta unclassified 2021',  2021, null,       null,     'test:goal-scope:t5');

-- Gradeable problems: known answer whose index is inside `choices`. Both
-- spellings of the overloaded column appear — a 5-option MCQ and a
-- 1-element free-response key — because eligibility must accept both.
insert into public.problems
  (id, test_id, n, topic, statement, choices, answer_index, answer_status, sync_key) values
  -- alpha / State / Sprint
  (-920101, -920011, 0, 'geometry', 'p1', '{a,b,c,d,e}', 2, 'known', 'test:goal-scope:p1'),
  (-920102, -920011, 1, 'algebra',  'p2', '{"42"}',      0, 'known', 'test:goal-scope:p2'),
  -- alpha / State / Team
  (-920103, -920012, 0, 'geometry', 'p3', '{a,b,c,d,e}', 1, 'known', 'test:goal-scope:p3'),
  -- alpha / National / Sprint
  (-920104, -920013, 0, 'geometry', 'p4', '{a,b,c,d,e}', 0, 'known', 'test:goal-scope:p4'),
  -- beta / State / Team
  (-920105, -920014, 0, 'algebra',  'p5', '{a,b,c,d,e}', 3, 'known', 'test:goal-scope:p5'),
  -- beta / unclassified
  (-920106, -920015, 0, null,       'p6', '{a,b,c,d,e}', 4, 'known', 'test:goal-scope:p6');

-- Ungradeable problems, one per failure mode, all inside alpha/State/Sprint so
-- they land in the same slice as -920101 and can only be separated by the
-- eligibility rule itself.
insert into public.problems
  (id, test_id, n, topic, statement, choices, answer_index, answer_status, sync_key) values
  -- answerless stub: no key at all
  (-920201, -920011, 2, 'geometry', 'u1', null,          -1, 'source_missing', 'test:goal-scope:u1'),
  -- blank statement
  (-920202, -920011, 3, 'geometry', '',   '{a,b,c,d,e}',  1, 'known',          'test:goal-scope:u2'),
  -- claims a known answer but the index is outside `choices`
  (-920203, -920011, 4, 'geometry', 'u3', '{a,b}',        7, 'known',          'test:goal-scope:u3'),
  -- proof: not applicable
  (-920204, -920011, 5, 'geometry', 'u4', null,          -1, 'not_applicable', 'test:goal-scope:u4');

-- The duplicated problem. The CANONICAL lives under alpha/National/Sprint; its
-- ALIAS is placed under beta/State/Team. This is the row that separates a
-- correct semi-join from every plausible wrong one.
insert into public.problems
  (id, test_id, n, topic, statement, choices, answer_index, answer_status, canonical_id, sync_key) values
  (-920301, -920013, 1, 'number theory', 'dup', '{a,b,c,d,e}', 2, 'known', null,     'test:goal-scope:d1'),
  -- Alias n differs from the canonical's n so a filter on placement number
  -- can be told apart from a filter on the canonical row's n.
  (-920302, -920014, 5, 'number theory', 'dup', '{a,b,c,d,e}', 2, 'known', -920301,  'test:goal-scope:d2');

-- An alias whose canonical is NOT gradeable, while the alias row itself looks
-- perfectly fine. Eligibility is judged on the canonical (§4), because practice
-- serves the canonical — so this must be excluded despite appearances.
insert into public.problems
  (id, test_id, n, topic, statement, choices, answer_index, answer_status, canonical_id, sync_key) values
  (-920303, -920013, 2, 'combinatorics', 'u5', null,          -1, 'source_missing', null,    'test:goal-scope:d3'),
  (-920304, -920014, 2, 'combinatorics', 'looks fine', '{a,b,c,d,e}', 1, 'known',   -920303, 'test:goal-scope:d4');

-- Scopes under test. Kept in one place so each assertion below reads as a
-- question about semantics rather than a wall of json.
create temporary table scope_fixtures (name text primary key, scope jsonb) on commit drop;
insert into scope_fixtures values
  ('alpha_all',      '{"seriesIds":["-920001"]}'),
  ('beta_all',       '{"seriesIds":["-920002"]}'),
  ('both',           '{"seriesIds":["-920001","-920002"]}'),
  ('alpha_state',    '{"seriesIds":["-920001"],"seriesScopes":{"-920001":{"divisions":["State"]}}}'),
  ('alpha_sprint',   '{"seriesIds":["-920001"],"seriesScopes":{"-920001":{"formats":["Sprint"]}}}'),
  ('alpha_state_sprint',
     '{"seriesIds":["-920001"],"seriesScopes":{"-920001":{"divisions":["State"],"formats":["Sprint"]}}}'),
  -- Multi-value division list intersected with a format: State+National ∩ Team
  -- reaches only the State/Team test, so a narrowing implemented as a union
  -- rather than an intersection would over-count here.
  ('alpha_multidiv_team',
     '{"seriesIds":["-920001"],"seriesScopes":{"-920001":{"divisions":["State","National"],"formats":["Team"]}}}'),
  -- The cross-vocabulary case: alpha narrowed to National, beta not narrowed at
  -- all. A leaked narrowing would drop beta's rows.
  ('alpha_national_plus_beta',
     '{"seriesIds":["-920001","-920002"],"seriesScopes":{"-920001":{"divisions":["National"]}}}'),
  ('alpha_geometry', '{"seriesIds":["-920001"],"topic":["geometry"]}'),
  ('alpha_2020',     '{"seriesIds":["-920001"],"yearRange":[2020,2020]}'),
  -- 1-based problemNumbers. Canonical dup is alpha n=1 (#2); its alias is
  -- beta n=5 (#6). Matching the alias number through beta, and not matching
  -- the canonical number through beta, is the placement-n rule.
  ('alpha_n2',
     '{"seriesIds":["-920001"],"seriesScopes":{"-920001":{"problemNumbers":[2,2]}}}'),
  ('beta_n6',
     '{"seriesIds":["-920002"],"seriesScopes":{"-920002":{"problemNumbers":[6,6]}}}'),
  ('beta_n2',
     '{"seriesIds":["-920002"],"seriesScopes":{"-920002":{"problemNumbers":[2,2]}}}');

-- Every assertion counts only the fixture's own canonicals, so a live catalog
-- underneath cannot move any number here.
create or replace function pg_temp.in_scope(p_name text)
returns bigint language sql stable as $$
  select count(*)
  from scope_fixtures sf,
       lateral public.goal_scope_canonicals(sf.scope) g
  where sf.name = p_name and g.canonical_id <= -920000;
$$;

create or replace function pg_temp.eligible_in_scope(p_name text)
returns bigint language sql stable as $$
  select count(*)
  from scope_fixtures sf,
       lateral public.goal_scope_canonicals(sf.scope) g
  where sf.name = p_name and g.canonical_id <= -920000 and g.gradeable;
$$;

-- ---------------------------------------------------------------------------
-- Eligibility (§4)
-- ---------------------------------------------------------------------------

select extensions.is(
  public.is_gradeable('p', 'known', 0, '{"42"}'),
  true,
  'a 1-element choices array is a free-response key, and is gradeable'
);

select extensions.is(
  public.is_gradeable('p', 'known', 7, '{a,b}'),
  false,
  'a known answer whose index is outside choices is not gradeable'
);

select extensions.is(
  public.is_gradeable('', 'known', 0, '{a,b}'),
  false,
  'a blank statement is not gradeable'
);

select extensions.is(
  public.is_gradeable('p', 'source_missing', -1, null),
  false,
  'an answerless stub is not gradeable'
);

-- alpha/State/Sprint holds 2 gradeable problems and 4 ungradeable ones.
select extensions.is(
  pg_temp.in_scope('alpha_state_sprint'),
  6::bigint,
  'scope membership ignores eligibility'
);

select extensions.is(
  pg_temp.eligible_in_scope('alpha_state_sprint'),
  2::bigint,
  'ineligible problems do not inflate the denominator'
);

-- ---------------------------------------------------------------------------
-- Per-series vocabulary isolation (§3)
-- ---------------------------------------------------------------------------

-- alpha: State/Sprint 6, State/Team 1, National/Sprint 1 + dup canonical 1 +
-- ungradeable-canonical 1 = 10 placements, all distinct canonicals.
select extensions.is(
  pg_temp.in_scope('alpha_all'),
  10::bigint,
  'an unnarrowed series selects every placement under it'
);

select extensions.is(
  pg_temp.in_scope('alpha_state'),
  7::bigint,
  'a division narrowing selects only that division'
);

select extensions.is(
  pg_temp.in_scope('alpha_sprint'),
  9::bigint,
  'a format narrowing selects only that format'
);

-- State+National ∩ Team is the State/Team test alone: 1 canonical.
select extensions.is(
  pg_temp.in_scope('alpha_multidiv_team'),
  1::bigint,
  'division and format narrowings intersect within a series'
);

-- alpha narrowed to National reaches 3 canonicals (-920104, -920301, -920303);
-- beta, unnarrowed, reaches 4 (-920105, -920106, and the two alias-resolved
-- canonicals it shares with alpha). The union is 5. Were alpha's 'National'
-- narrowing to leak onto beta — whose tests are 'State' and unclassified —
-- beta would contribute nothing and this would read 3.
select extensions.is(
  pg_temp.in_scope('alpha_national_plus_beta'),
  5::bigint,
  'a division chosen for one series never filters another series'
);

-- ---------------------------------------------------------------------------
-- Canonical identity (§5)
-- ---------------------------------------------------------------------------

-- alpha reaches 10 canonicals and beta 4, but they SHARE two (the dup and the
-- ungradeable-canonical pair), so the union is 12 rather than 14.
select extensions.is(
  pg_temp.in_scope('both'),
  12::bigint,
  'a duplicated problem counts once across the two series it appears under'
);

select extensions.is(
  pg_temp.in_scope('beta_all'),
  4::bigint,
  'alias placements bring their canonicals into the alias series scope'
);

-- The dup's canonical lives under alpha; its alias is beta's. A scope of "beta
-- only" must still reach it, or event metrics silently under-report work on
-- exactly the duplicated problems (§5).
select extensions.is(
  (select count(*)
     from scope_fixtures sf, lateral public.goal_scope_canonicals(sf.scope) g
     where sf.name = 'beta_all' and g.canonical_id = -920301),
  1::bigint,
  'a canonical is in scope through an alias placement under another series'
);

select extensions.is(
  (select bool_and(g.gradeable)
     from scope_fixtures sf, lateral public.goal_scope_canonicals(sf.scope) g
     where sf.name = 'beta_all' and g.canonical_id = -920303),
  false,
  'eligibility is judged on the canonical, not on the alias placement'
);

-- ---------------------------------------------------------------------------
-- Topic and year (§3)
-- ---------------------------------------------------------------------------

-- Of alpha's 10 canonicals, 7 are tagged 'geometry' — the dup ('number theory')
-- and the ungradeable-canonical pair ('combinatorics') drop out.
select extensions.is(
  pg_temp.in_scope('alpha_geometry'),
  7::bigint,
  'topic narrows across every series clause'
);

select extensions.is(
  pg_temp.in_scope('alpha_2020'),
  6::bigint,
  'a year range narrows to tests from that year'
);

-- Canonical dup is alpha #2 (n=1): p2 (-920102) and the dup (-920301).
select extensions.is(
  pg_temp.in_scope('alpha_n2'),
  2::bigint,
  'a problem-number range matches the placement n, 1-based'
);

-- Alias is beta #6 (n=5). The canonical is in scope through that placement
-- even though the canonical row itself is #2.
select extensions.is(
  (select count(*)
     from scope_fixtures sf, lateral public.goal_scope_canonicals(sf.scope) g
     where sf.name = 'beta_n6' and g.canonical_id = -920301),
  1::bigint,
  'a canonical is in scope through an alias placement whose n is in range'
);

-- Beta #2 would match the canonical's own n, which is the wrong question:
-- the alias is #6, so this must not include the dup.
select extensions.is(
  (select count(*)
     from scope_fixtures sf, lateral public.goal_scope_canonicals(sf.scope) g
     where sf.name = 'beta_n2' and g.canonical_id = -920301),
  0::bigint,
  'problem-number matching uses the placement n, not the canonical n'
);

select * from extensions.finish();

rollback;
