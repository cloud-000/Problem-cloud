begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(10);

insert into public.problems (id, n, sync_key)
values (-910001, 0, 'test:canonical-duplicates:canonical');

insert into public.problems (id, n, canonical_id, sync_key)
values (-910002, 1, -910001, 'test:canonical-duplicates:alias');

insert into auth.users (
  id,
  aud,
  role,
  email,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) values (
  '00000000-0000-0000-0000-000000091001',
  'authenticated',
  'authenticated',
  'canonical-duplicates@example.test',
  '{}'::jsonb,
  '{"username":"canonical_test"}'::jsonb,
  now(),
  now()
);

-- Defense-in-depth trigger: even a direct internal insert resolves the alias.
insert into public.problem_progress (user_id, problem_id, mastery)
values ('00000000-0000-0000-0000-000000091001', -910002, 'learning');

select extensions.is(
  (select count(*) from public.problem_progress where problem_id = -910001),
  1::bigint,
  'direct progress inserts are stored on the canonical problem'
);

select extensions.is(
  (select count(*) from public.problem_progress where problem_id = -910002),
  0::bigint,
  'direct progress inserts do not leave alias rows'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000091001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select extensions.is(
  (select problem_id from public.set_problem_mastery(-910002, 'confident')),
  (-910001)::bigint,
  'mastery RPC returns the canonical problem id'
);

select extensions.is(
  (select mastery from public.problem_progress
    where user_id = '00000000-0000-0000-0000-000000091001'
      and problem_id = -910001),
  'confident'::text,
  'mastery RPC writes the canonical progress row'
);

select extensions.is(
  (select problem_id from public.set_problem_engagement(-910002, 'revisit')),
  (-910001)::bigint,
  'engagement RPC returns the canonical problem id'
);

select extensions.is(
  (select engagement from public.problem_progress
    where user_id = '00000000-0000-0000-0000-000000091001'
      and problem_id = -910001),
  'revisit'::text,
  'engagement RPC writes the canonical progress row'
);

reset role;

-- Simulate legacy conflicting rows created before canonical write enforcement.
update public.problem_progress
set mastery = 'learning', updated_at = now() - interval '1 minute'
where user_id = '00000000-0000-0000-0000-000000091001'
  and problem_id = -910001;

alter table public.problem_progress disable trigger a_canonicalize_problem_progress;
insert into public.problem_progress (
  user_id,
  problem_id,
  mastery,
  updated_at
) values (
  '00000000-0000-0000-0000-000000091001',
  -910002,
  'confident',
  now()
);
alter table public.problem_progress enable trigger a_canonicalize_problem_progress;

insert into public.problem_ratings (problem_id, scope, rating, rd)
values (-910002, 'overall', 1500, 350);

select * from public.canonicalize_existing_user_data();

select extensions.is(
  (select count(*) from public.problem_progress where problem_id = -910002),
  0::bigint,
  'repair removes legacy alias progress rows'
);

select extensions.is(
  (select mastery from public.problem_progress
    where user_id = '00000000-0000-0000-0000-000000091001'
      and problem_id = -910001),
  'confident'::text,
  'repair preserves the most recently updated non-null intent'
);

select extensions.is(
  (select count(*) from public.problem_ratings where problem_id = -910002),
  0::bigint,
  'rating rebuild removes alias rating rows'
);

select extensions.is(
  (select count(*) from public.problem_ratings where problem_id = -910001),
  1::bigint,
  'rating rebuild seeds the canonical problem'
);

select * from extensions.finish();

rollback;
