begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(5);

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000095001', 'authenticated', 'authenticated', 'oauth-one@example.test', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000095002', 'authenticated', 'authenticated', 'oauth-two@example.test', '{}'::jsonb, '{}'::jsonb, now(), now());

select extensions.is(
  (select username from public.profiles where id = '00000000-0000-0000-0000-000000095001'),
  null::text,
  'an OAuth-style user begins without a generated username'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000095001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select extensions.is(public.claim_profile_username('oauth_claimed'), 'oauth_claimed', 'the owner can claim an initially unset username');
select extensions.throws_ok(
  $$select public.claim_profile_username('second_name')$$,
  'P0001',
  'USERNAME_ALREADY_SET',
  'a claimed username cannot be replaced'
);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000095002', true);
select extensions.throws_ok(
  $$select public.claim_profile_username('oauth_claimed')$$,
  'P0001',
  'USERNAME_TAKEN',
  'claiming still enforces uniqueness'
);

select extensions.throws_ok(
  $$select public.claim_profile_username('ab')$$,
  'P0001',
  'USERNAME_INVALID',
  'claiming applies the username minimum'
);

select * from extensions.finish();
rollback;
