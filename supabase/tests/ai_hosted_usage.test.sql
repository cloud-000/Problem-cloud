begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(15);

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000096001',
    'authenticated', 'authenticated', 'hosted-one@example.test',
    '{}'::jsonb, '{"username":"hosted_usage_one"}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000096002',
    'authenticated', 'authenticated', 'hosted-two@example.test',
    '{}'::jsonb, '{"username":"hosted_usage_two"}'::jsonb, now(), now()
  );

select extensions.results_eq(
  $$select credits, turns from public.reserve_ai_hosted_turn(
    '00000000-0000-0000-0000-000000096001', '2026-09-01', 100, 3)$$,
  $$values (0, 1)$$,
  'the first hosted turn reserves against a fresh period'
);

select extensions.is(
  (select credits from public.add_ai_hosted_credits(
    '00000000-0000-0000-0000-000000096001', '2026-09-01', 40)),
  40,
  'credits accumulate on the reserved row'
);

select extensions.results_eq(
  $$select credits, turns from public.reserve_ai_hosted_turn(
    '00000000-0000-0000-0000-000000096001', '2026-09-01', 100, 3)$$,
  $$values (40, 2)$$,
  'a later reserve keeps spent credits and increments turns'
);

select extensions.results_eq(
  $$select credits, turns from public.reserve_ai_hosted_turn(
    '00000000-0000-0000-0000-000000096001', '2026-09-01', 100, 3)$$,
  $$values (40, 3)$$,
  'the last turn under the cap is still allowed'
);

select extensions.is_empty(
  $$select * from public.reserve_ai_hosted_turn(
    '00000000-0000-0000-0000-000000096001', '2026-09-01', 100, 3)$$,
  'a fourth turn is refused once the turn cap is reached'
);

select extensions.is(
  (select turns from public.ai_hosted_usage
    where user_id = '00000000-0000-0000-0000-000000096001'
      and period_start = '2026-09-01'),
  3,
  'a refused reserve does not increment turns'
);

select extensions.is(
  (select credits from public.add_ai_hosted_credits(
    '00000000-0000-0000-0000-000000096001', '2026-09-01', 80)),
  120,
  'an in-flight turn may push credits over the cap'
);

select extensions.is_empty(
  $$select * from public.reserve_ai_hosted_turn(
    '00000000-0000-0000-0000-000000096002', '2026-09-01', 0, 10)$$,
  'a zero credit cap refuses the first turn'
);

select extensions.is(
  (select turns from public.ai_hosted_usage
    where user_id = '00000000-0000-0000-0000-000000096002'
      and period_start = '2026-09-01'),
  0,
  'a refused first turn leaves turns at zero'
);

select extensions.throws_ok(
  $$select public.add_ai_hosted_credits(
    '00000000-0000-0000-0000-000000096001', '2026-09-01', -1)$$,
  'P0001',
  'AI_HOSTED_USAGE:credits must be non-negative',
  'negative credits are rejected'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000096001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select extensions.is(
  (select credits from public.ai_hosted_usage
    where user_id = '00000000-0000-0000-0000-000000096001'
      and period_start = '2026-09-01'),
  120,
  'the owner can read their hosted usage'
);

select extensions.is(
  (select count(*)::integer from public.ai_hosted_usage
    where user_id = '00000000-0000-0000-0000-000000096002'),
  0,
  'a user cannot read another user''s hosted usage'
);

select extensions.throws_ok(
  $$insert into public.ai_hosted_usage (user_id, period_start, credits, turns)
    values ('00000000-0000-0000-0000-000000096001', '2026-10-01', 0, 0)$$,
  '42501',
  'permission denied for table ai_hosted_usage',
  'a client cannot insert hosted usage'
);

select extensions.throws_ok(
  $$select * from public.reserve_ai_hosted_turn(
    '00000000-0000-0000-0000-000000096001', '2026-09-01', 100, 10)$$,
  '42501',
  'permission denied for function reserve_ai_hosted_turn',
  'a client cannot reserve hosted turns'
);

select extensions.throws_ok(
  $$select public.add_ai_hosted_credits(
    '00000000-0000-0000-0000-000000096001', '2026-09-01', 1)$$,
  '42501',
  'permission denied for function add_ai_hosted_credits',
  'a client cannot add hosted credits'
);

select * from extensions.finish();
rollback;
