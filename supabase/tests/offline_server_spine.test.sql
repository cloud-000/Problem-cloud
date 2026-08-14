begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(32);

select extensions.ok(not has_table_privilege('anon', 'public.offline_checkouts', 'TRUNCATE'),
  'anonymous callers cannot mutate checkout provenance');
select extensions.ok(not has_table_privilege('authenticated', 'public.offline_checkouts', 'TRUNCATE'),
  'authenticated callers can only read owner-scoped checkout rows');
select extensions.ok(not has_function_privilege('anon', 'public.offline_cleanup_checkouts()', 'EXECUTE'),
  'retention cleanup is not public');
select extensions.ok(has_function_privilege('authenticated',
  'public.offline_begin_package(uuid,uuid,uuid,jsonb,bigint,text,jsonb)', 'EXECUTE'),
  'authenticated callers can use the narrow package materializer');

insert into public.series(id, name) values
  (-940001, 'test:offline:alpha'),
  (-940002, 'test:offline:beta');
insert into public.tests(id, series_id, name, year, sync_key) values
  (-940011, -940001, 'offline alpha', 2025, 'test:offline:t1'),
  (-940012, -940002, 'offline beta', 2025, 'test:offline:t2');
insert into public.problems
  (id, test_id, n, statement, choices, answer_index, answer_status, topic, sync_key) values
  (-940101, -940011, 0, 'offline canonical', '{a,b}', 0, 'known', 'algebra', 'test:offline:p1'),
  (-940102, -940011, 1, 'offline second', '{a,b}', 1, 'known', 'geometry', 'test:offline:p2');
insert into public.problems
  (id, test_id, n, statement, choices, answer_index, answer_status, topic, canonical_id, sync_key) values
  (-940103, -940012, 0, 'offline alias', '{a,b}', 0, 'known', 'algebra', -940101, 'test:offline:p3');

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000094001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'offline-one@example.test', '{}'::jsonb,
   '{"username":"offline_one"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000094002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'offline-two@example.test', '{}'::jsonb,
   '{"username":"offline_two"}'::jsonb, now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000094001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

create temporary table package_result(value jsonb) on commit drop;
insert into package_result
select public.offline_begin_package(
  '10000000-0000-0000-0000-000000094001',
  '20000000-0000-0000-0000-000000094001',
  '30000000-0000-0000-0000-000000094001',
  '{"topic":[],"seriesIds":["-940002"],"seriesScopes":{},"problemLimit":20}'::jsonb,
  null, 'Offline test', '{"format":"practice","mode":"new"}'::jsonb
);

select extensions.is((select value->>'problemCount' from package_result), '1',
  'materialization resolves a duplicated problem through its alias placement');
select extensions.is((select value->>'placementCount' from package_result), '2',
  'the package preserves every placement for its resolved canonical');
select extensions.is((select value->'baseState'->'session'->'settings'->>'mode' from package_result), 'new',
  'creation captures the dedicated New/practice session snapshot');
select extensions.is((select count(*) from public.offline_package_pages), 1::bigint,
  'phase one stores immutable logical page records');

create temporary table retry_result(value jsonb) on commit drop;
insert into retry_result
select public.offline_begin_package(
  '10000000-0000-0000-0000-000000094001',
  '20000000-0000-0000-0000-000000094001',
  '30000000-0000-0000-0000-000000094001',
  '{"topic":[],"seriesIds":["-940002"],"seriesScopes":{},"problemLimit":20}'::jsonb,
  null, 'Offline test', '{"format":"practice","mode":"new"}'::jsonb
);
select extensions.is((select value->>'checkoutId' from retry_result),
  (select value->>'checkoutId' from package_result),
  'retrying a request id returns the same checkout');
select extensions.is((select value->>'sessionId' from retry_result),
  (select value->>'sessionId' from package_result),
  'retrying creation does not create a second dedicated session');

select public.offline_finalize_package(
  (select (value->>'checkoutId')::uuid from package_result),
  (select jsonb_agg(jsonb_build_object(
      'pageIndex', page_index, 'records', records, 'checksum', 'test-checksum',
      'decodedBytes', octet_length(records::text)))
   from public.offline_package_pages)
);
select extensions.is((select status from public.offline_checkouts), 'issued',
  'checksum finalization issues the immutable checkout');
select extensions.is((select checksum from public.offline_package_pages), 'test-checksum',
  'phase two stores the TypeScript-computed checksum');

select extensions.throws_ok(
  $$select public.offline_begin_package(
    '10000000-0000-0000-0000-000000094098',
    '20000000-0000-0000-0000-000000094098',
    '30000000-0000-0000-0000-000000094098',
    '{"topic":[],"seriesIds":["-940002"],"seriesScopes":{}}'::jsonb,
    null, null, '{"format":"practice","mode":"new"}'::jsonb)$$,
  'P0001', 'OFFLINE_OPERATION_INVALID:problem limit',
  'materialization requires an explicit download amount');

select extensions.throws_ok(
  $$select public.offline_begin_package(
    '10000000-0000-0000-0000-000000094099',
    '20000000-0000-0000-0000-000000094099',
    '30000000-0000-0000-0000-000000094099',
    '{"topic":[],"seriesIds":["-940002"],"seriesScopes":{},"problemLimit":20}'::jsonb,
    null, null, '{"format":"test","mode":"new"}'::jsonb)$$,
  'P0001', 'OFFLINE_OPERATION_INVALID:session must be New/practice',
  'materialization rejects a session outside the v1 boundary');

-- Activity after the frozen snapshot is advisory overlap, never rejection.
insert into public.submissions(user_id, problem_id, selected_choice, is_correct, skipped, source, created_at)
values ('00000000-0000-0000-0000-000000094001', -940101, 0, true, false, 'library',
  clock_timestamp() + interval '1 millisecond');
select * from public.set_problem_mastery(-940101, 'confident');

create temporary table sync_request(value jsonb) on commit drop;
insert into sync_request select jsonb_build_array(
    jsonb_build_object(
      'version',1,'id','40000000-0000-0000-0000-000000094001',
      'userId','00000000-0000-0000-0000-000000094001',
      'checkoutId',(select value->>'checkoutId' from package_result),
      'packageId','10000000-0000-0000-0000-000000094001',
      'sessionId',(select (value->>'sessionId')::bigint from package_result),
      'sequence',1,'runtimeId','50000000-0000-0000-0000-000000094001',
      'monotonicOffsetMs',1,'occurredAt','2000-01-01T00:00:00Z',
      'dependsOn','[]'::jsonb,'state','pending','type','submission',
      'payload',jsonb_build_object(
        'clientKey','60000000-0000-0000-0000-000000094001',
        'canonicalId',-940101,'selectedChoice',1,'answer',null,
        'isCorrect',false,'skipped',false,'flagged',false,'elapsedMs',1000,
        'source','practice','triesUsed',1)),
    jsonb_build_object(
      'version',1,'id','40000000-0000-0000-0000-000000094002',
      'userId','00000000-0000-0000-0000-000000094001',
      'checkoutId',(select value->>'checkoutId' from package_result),
      'packageId','10000000-0000-0000-0000-000000094001',
      'sessionId',(select (value->>'sessionId')::bigint from package_result),
      'sequence',2,'runtimeId','50000000-0000-0000-0000-000000094001',
      'monotonicOffsetMs',2,'occurredAt','2100-01-01T00:00:00Z',
      'dependsOn',jsonb_build_array('40000000-0000-0000-0000-000000094001'),
      'state','pending','type','mastery',
      'payload',jsonb_build_object('canonicalId',-940101,'mastery','needs_work')));

create temporary table sync_result(value jsonb) on commit drop;
insert into sync_result
select public.offline_sync_v1(
  '30000000-0000-0000-0000-000000094001',
  (select (value->>'checkoutId')::uuid from package_result),
  '10000000-0000-0000-0000-000000094001',
  (select value->>'packageRevision' from package_result),
  (select value from sync_request)
);

select extensions.is((select jsonb_array_length(value->'acknowledgedOperationIds') from sync_result), 2,
  'one transaction acknowledges every ordered operation');
select extensions.is((select count(*) from public.submissions
  where client_key = '60000000-0000-0000-0000-000000094001'), 1::bigint,
  'sync inserts one idempotency-keyed submission');
select extensions.ok((select occurred_at >= c.downloaded_at and occurred_at <= c.last_synced_at
  from public.submissions s join public.offline_checkouts c on true
  where s.client_key = '60000000-0000-0000-0000-000000094001'),
  'occurred_at is clamped to the checkout-to-receipt interval');
select extensions.is((select mastery from public.problem_progress
  where user_id = '00000000-0000-0000-0000-000000094001' and problem_id = -940101),
  'needs_work', 'mastery applies after its submission dependency');
select extensions.ok((select value->'overlaps' @> '[{"canonicalId":-940101,"kind":"activity_since_download"}]'::jsonb
  and value->'overlaps' @> '[{"canonicalId":-940101,"kind":"mastery_replaced"}]'::jsonb from sync_result),
  'sync reports server activity and replaced organization since download');

create temporary table retry_sync(value jsonb) on commit drop;
insert into retry_sync select public.offline_sync_v1(
  '30000000-0000-0000-0000-000000094001',
  (select (value->>'checkoutId')::uuid from package_result),
  '10000000-0000-0000-0000-000000094001',
  (select value->>'packageRevision' from package_result),
  (select value from sync_request)
);
select extensions.is((select count(*) from public.submissions
  where client_key = '60000000-0000-0000-0000-000000094001'), 1::bigint,
  'retrying the whole batch never duplicates a submission');
select extensions.is((select jsonb_array_length(value->'acknowledgedOperationIds') from retry_sync), 2,
  'retrying non-submission operations is idempotent through the operation ledger');

create temporary table local_session_sync(value jsonb) on commit drop;
insert into local_session_sync select public.offline_sync_v1(
  '30000000-0000-0000-0000-000000094001',
  (select (value->>'checkoutId')::uuid from package_result),
  '10000000-0000-0000-0000-000000094001',
  (select value->>'packageRevision' from package_result),
  jsonb_build_array((select value->0 || jsonb_build_object(
    'id','40000000-0000-0000-0000-000000094020',
    'sessionId',-1,
    'clientSessionId','70000000-0000-0000-0000-000000094001',
    'sequence',20,
    'dependsOn','[]'::jsonb,
    'payload',(value->0->'payload') || jsonb_build_object(
      'clientKey','60000000-0000-0000-0000-000000094020')) from sync_request)),
  jsonb_build_object(
    'clientSessionId','70000000-0000-0000-0000-000000094001',
    'name','Local mixed practice',
    'settings',jsonb_build_object('format','practice','mode','new'),
    'startedAt','2026-08-14T00:00:00Z')
);
select extensions.is((select value->>'clientSessionId' from local_session_sync),
  '70000000-0000-0000-0000-000000094001',
  'sync returns the browser-owned session identity');
select extensions.ok((select m.session_id <> c.session_id
  from public.offline_client_sessions m cross join public.offline_checkouts c
  where m.client_session_id = '70000000-0000-0000-0000-000000094001'),
  'a local session maps to one server session independent of the package session');
select extensions.is((select s.session_id from public.submissions s
  where s.client_key = '60000000-0000-0000-0000-000000094020'),
  (select session_id from public.offline_client_sessions
    where client_session_id = '70000000-0000-0000-0000-000000094001'),
  'the local submission is filed into the mapped server session');

select extensions.throws_ok(
  $$select public.offline_sync_v1(
    '30000000-0000-0000-0000-000000094001',
    (select (value->>'checkoutId')::uuid from package_result),
    '10000000-0000-0000-0000-000000094001',
    (select value->>'packageRevision' from package_result),
    '[{"version":1,"id":"40000000-0000-0000-0000-000000094099","userId":"00000000-0000-0000-0000-000000094002","checkoutId":"00000000-0000-0000-0000-000000000000","packageId":"10000000-0000-0000-0000-000000094001","sessionId":1,"sequence":9,"runtimeId":"50000000-0000-0000-0000-000000094001","monotonicOffsetMs":1,"occurredAt":"2026-01-01T00:00:00Z","dependsOn":[],"state":"pending","type":"mastery","payload":{"canonicalId":-940101,"mastery":"confident"}}]'::jsonb)$$,
  'P0001', null, 'sync rejects mixed ownership before applying work');

select extensions.throws_ok(
  $$select public.offline_sync_v1(
    '30000000-0000-0000-0000-000000094001',
    (select (value->>'checkoutId')::uuid from package_result),
    '10000000-0000-0000-0000-000000094001',
    (select value->>'packageRevision' from package_result),
    jsonb_build_array(
      (select value->0 || jsonb_build_object(
        'id','40000000-0000-0000-0000-000000094010','sequence',10,
        'dependsOn','[]'::jsonb,
        'payload',(value->0->'payload') || jsonb_build_object(
          'clientKey','60000000-0000-0000-0000-000000094010')) from sync_request),
      (select value->1 || jsonb_build_object(
        'id','40000000-0000-0000-0000-000000094011','sequence',11,
        'dependsOn','[]'::jsonb,
        'payload',jsonb_build_object('canonicalId',-940101,'mastery','invalid'))
       from sync_request)))$$,
  'P0001', null, 'a permanent invalid operation rejects the complete batch');
select extensions.is((select count(*) from public.submissions
  where client_key = '60000000-0000-0000-0000-000000094010'), 0::bigint,
  'a later invalid operation rolls back earlier writes in the transaction');

select extensions.throws_ok(
  $$select public.offline_sync_v1(
    '30000000-0000-0000-0000-000000094001',
    (select (value->>'checkoutId')::uuid from package_result),
    '10000000-0000-0000-0000-000000094001',
    (select value->>'packageRevision' from package_result),
    jsonb_build_array((select value->1 || jsonb_build_object(
      'id','40000000-0000-0000-0000-000000094012','sequence',12,
      'dependsOn',jsonb_build_array('40000000-0000-0000-0000-000000099999'))
      from sync_request)))$$,
  'P0001', null, 'an unsatisfied dependency rejects the transaction');

select public.offline_mark_checkout_ready(
  (select (value->>'checkoutId')::uuid from package_result));
select extensions.ok((select status = 'ready' from public.offline_checkouts)
  and not exists (select 1 from public.offline_package_pages),
  'ready finalization retains provenance and releases transient page rows');
select public.offline_close_checkout(
  (select (value->>'checkoutId')::uuid from package_result));
select extensions.ok((select status = 'closed'
  and expires_at between clock_timestamp() + interval '29 days'
                     and clock_timestamp() + interval '31 days'
  from public.offline_checkouts),
  'client close starts the 30-day checkout retention lifecycle');

create temporary table bounded_result(value jsonb) on commit drop;
insert into bounded_result
select public.offline_begin_package(
  '10000000-0000-0000-0000-000000094020',
  '20000000-0000-0000-0000-000000094020',
  '30000000-0000-0000-0000-000000094001',
  '{"topic":[],"seriesIds":["-940001"],"seriesScopes":{},"problemLimit":1}'::jsonb,
  null, 'Bounded offline test', '{"format":"practice","mode":"new"}'::jsonb
);
select extensions.is((select value->>'problemCount' from bounded_result), '1',
  'the explicit download amount bounds a scope with more matching canonicals');

create temporary table live_rating as
select rating, rd, matches from public.player_ratings
where user_id = '00000000-0000-0000-0000-000000094001' and scope = 'overall';
reset role;
select public.recompute_ratings();
select extensions.ok((select l.rating = r.rating and l.rd = r.rd and l.matches = r.matches
  from live_rating l join public.player_ratings r
    on r.user_id = '00000000-0000-0000-0000-000000094001' and r.scope = 'overall'),
  'live receipt-order ratings equal a full deterministic replay');

select extensions.finish();
rollback;
