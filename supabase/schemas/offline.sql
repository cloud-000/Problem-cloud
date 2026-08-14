-- Offline v1 server spine: immutable scope packages, checkout provenance, and
-- one closed transactional sync surface. The browser contract is documented in
-- docs/offline-contracts.md; this file is the declarative source of truth.

create table public.offline_checkouts (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null,
  request_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid not null,
  session_id bigint not null references public.practice_sessions(id) on delete restrict,
  scope jsonb not null,
  content_revision text not null,
  package_revision text not null,
  base_state jsonb not null,
  -- Frozen per-canonical organization/activity facts used for exact overlap
  -- reporting after transient package pages have been released.
  personal_baseline jsonb not null default '{}'::jsonb,
  problem_count integer not null check (problem_count >= 0),
  placement_count integer not null check (placement_count >= 0),
  asset_count integer not null default 0 check (asset_count >= 0),
  estimated_json_bytes bigint not null default 0 check (estimated_json_bytes >= 0),
  page_size integer not null default 250 check (page_size between 1 and 250),
  downloaded_at timestamp with time zone not null,
  personal_state_at timestamp with time zone not null,
  issued_at timestamp with time zone,
  ready_at timestamp with time zone,
  last_synced_at timestamp with time zone,
  completed_at timestamp with time zone,
  closed_at timestamp with time zone,
  abandoned_at timestamp with time zone,
  expires_at timestamp with time zone,
  status text not null check (status in
    ('materializing', 'issued', 'ready', 'closed', 'abandoned', 'expired')),
  created_at timestamp with time zone not null default now(),
  unique (user_id, request_id)
);

create index offline_checkouts_user_status_idx
  on public.offline_checkouts(user_id, status, created_at desc);
create index offline_checkouts_package_idx
  on public.offline_checkouts(user_id, package_id, created_at desc);
create index offline_checkouts_expiry_idx
  on public.offline_checkouts(expires_at) where expires_at is not null;

create table public.offline_package_pages (
  checkout_id uuid not null references public.offline_checkouts(id) on delete cascade,
  page_index integer not null check (page_index >= 0),
  records jsonb not null,
  checksum text,
  decoded_bytes integer not null default 0 check (decoded_bytes >= 0),
  created_at timestamp with time zone not null default now(),
  primary key (checkout_id, page_index)
);

-- Idempotency covers every operation kind. Submission client_key alone would
-- not protect retried mastery, engagement, or session-finish operations.
create table public.offline_applied_operations (
  checkout_id uuid not null references public.offline_checkouts(id) on delete cascade,
  operation_id uuid not null,
  operation_type text not null check (operation_type in
    ('submission', 'mastery', 'engagement', 'session-finish')),
  result jsonb not null default '{}'::jsonb,
  applied_at timestamp with time zone not null default now(),
  primary key (checkout_id, operation_id)
);

alter table public.offline_checkouts enable row level security;
alter table public.offline_package_pages enable row level security;
alter table public.offline_applied_operations enable row level security;

create policy "Users can view their own offline checkouts."
  on public.offline_checkouts for select to authenticated
  using (auth.uid() = user_id);
create policy "Users can view pages for their own offline checkouts."
  on public.offline_package_pages for select to authenticated
  using (exists (
    select 1 from public.offline_checkouts c
    where c.id = checkout_id and c.user_id = auth.uid()
  ));

grant select on public.offline_checkouts, public.offline_package_pages to authenticated;
grant all on public.offline_checkouts, public.offline_package_pages,
  public.offline_applied_operations to service_role;

-- Stable wire representation of the creation response. This is kept in SQL so
-- an idempotent request returns the snapshot originally captured, never a live
-- session/rating reread.
create or replace function public.offline_checkout_created(p_checkout_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  c public.offline_checkouts;
begin
  select * into c from public.offline_checkouts where id = p_checkout_id;
  if not found or c.user_id <> auth.uid() then
    raise exception 'OFFLINE_CHECKOUT_INVALID';
  end if;
  return jsonb_build_object(
    'version', 1,
    'packageId', c.package_id,
    'requestId', c.request_id,
    'checkoutId', c.id,
    'sessionId', c.session_id,
    'normalizedScope', c.scope,
    'contentRevision', c.content_revision,
    'packageRevision', c.package_revision,
    'personalStateAt', c.personal_state_at,
    'downloadedAt', c.downloaded_at,
    'problemCount', c.problem_count,
    'placementCount', c.placement_count,
    'assetCount', c.asset_count,
    'estimatedBytes', jsonb_build_object(
      'json', c.estimated_json_bytes, 'media', null, 'total', null),
    'pageSize', c.page_size,
    'firstCursor', case when c.problem_count = 0 then null else '0' end,
    'baseState', c.base_state
  );
end;
$$;

-- Phase one: capture membership, catalog facts, personal state, and a dedicated
-- New/practice session in one transaction. Asset discovery and RFC 8785 page
-- checksums are deliberately left to the shared TypeScript implementation.
create or replace function public.offline_begin_package(
  p_package_id uuid,
  p_request_id uuid,
  p_device_id uuid,
  p_scope jsonb,
  p_session_id bigint,
  p_session_name text,
  p_session_settings jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_existing public.offline_checkouts;
  v_checkout uuid := gen_random_uuid();
  v_package_revision uuid := gen_random_uuid();
  v_content_revision uuid;
  v_session public.practice_sessions;
  v_now timestamp with time zone := clock_timestamp();
  v_problem_count integer;
  v_placement_count integer;
  v_page_count integer;
  v_page integer;
  v_problem_limit integer;
  v_records jsonb;
  v_baseline jsonb;
  v_player jsonb;
begin
  if v_user is null then raise exception 'OFFLINE_AUTH_REQUIRED'; end if;
  if p_package_id is null or p_request_id is null or p_device_id is null then
    raise exception 'OFFLINE_OPERATION_INVALID:missing identifier';
  end if;
  if jsonb_typeof(p_scope) <> 'object'
     or jsonb_typeof(coalesce(p_scope->'topic', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_scope->'seriesIds', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_scope->'seriesScopes', '{}'::jsonb)) <> 'object'
     or jsonb_array_length(coalesce(p_scope->'topic', '[]'::jsonb)) > 32
     or jsonb_array_length(coalesce(p_scope->'seriesIds', '[]'::jsonb)) > 256 then
    raise exception 'OFFLINE_OPERATION_INVALID:invalid scope';
  end if;
  begin
    v_problem_limit := (p_scope->>'problemLimit')::integer;
  exception when others then
    raise exception 'OFFLINE_OPERATION_INVALID:problem limit';
  end;
  if v_problem_limit is null or v_problem_limit < 1 or v_problem_limit > 10000 then
    raise exception 'OFFLINE_OPERATION_INVALID:problem limit';
  end if;
  if p_session_settings->>'format' <> 'practice'
     or p_session_settings->>'mode' <> 'new' then
    raise exception 'OFFLINE_OPERATION_INVALID:session must be New/practice';
  end if;

  select * into v_existing
  from public.offline_checkouts
  where user_id = v_user and request_id = p_request_id
  for update;
  if found then
    if v_existing.package_id <> p_package_id or v_existing.device_id <> p_device_id
       or v_existing.scope <> p_scope then
      raise exception 'OFFLINE_CONFLICT:request id reused with different input';
    end if;
    return public.offline_checkout_created(v_existing.id);
  end if;

  if (select count(*) from public.offline_checkouts
      where user_id = v_user and status = 'materializing'
        and expires_at > v_now) >= 2 then
    raise exception 'OFFLINE_CONFLICT:too many materializations';
  end if;

  if p_session_id is null then
    insert into public.practice_sessions (user_id, name, settings)
    values (v_user, nullif(left(p_session_name, 200), ''), p_session_settings)
    returning * into v_session;
  else
    select * into v_session from public.practice_sessions
    where id = p_session_id and user_id = v_user and not is_root
    for update;
    if not found then raise exception 'OFFLINE_CHECKOUT_INVALID:session'; end if;
    if v_session.settings->>'format' <> 'practice'
       or v_session.settings->>'mode' <> 'new' then
      raise exception 'OFFLINE_OPERATION_INVALID:refresh session is not New/practice';
    end if;
  end if;

  select revision into v_content_revision
  from public.catalog_revision where singleton;

  create temporary table if not exists offline_scope_ids (
    canonical_id bigint primary key,
    page_index integer not null
  ) on commit drop;
  truncate offline_scope_ids;
  -- The amount is explicit in the request and deterministically selects one
  -- reusable subset. The package is complete for that selected membership; no
  -- hidden truncation or page sampling occurs.
  insert into offline_scope_ids(canonical_id, page_index)
  with selected as (
    select canonical_id
    from public.goal_scope_canonicals(p_scope - 'problemLimit')
    order by md5(p_package_id::text || ':' || canonical_id::text)
    limit v_problem_limit
  )
  select canonical_id,
         ((row_number() over (order by canonical_id) - 1) / 250)::integer
  from selected;

  select count(*) into v_problem_count from offline_scope_ids;
  if v_problem_count > 10000 then
    raise exception 'OFFLINE_BATCH_TOO_LARGE:package has % canonicals', v_problem_count;
  end if;

  select count(*) into v_placement_count
  from public.problems p join offline_scope_ids i
    on i.canonical_id = coalesce(p.canonical_id, p.id);

  select coalesce(jsonb_object_agg(i.canonical_id::text,
    jsonb_build_object(
      'timesSeen', coalesce(pp.times_seen, 0),
      'lastSubmissionAt', pp.last_submission_at,
      'mastery', pp.mastery,
      'engagement', pp.engagement
    )), '{}'::jsonb)
  into v_baseline
  from offline_scope_ids i
  left join public.problem_progress pp
    on pp.user_id = v_user and pp.problem_id = i.canonical_id;

  select case when pr.user_id is null then null else jsonb_build_object(
    'rating', pr.rating, 'rd', pr.rd, 'matches', pr.matches,
    'last_match_at', pr.last_match_at) end
  into v_player
  from (select 1) seed
  left join public.player_ratings pr
    on pr.user_id = v_user and pr.scope = 'overall';

  insert into public.offline_checkouts (
    id, package_id, request_id, user_id, device_id, session_id, scope,
    content_revision, package_revision, base_state, personal_baseline,
    problem_count, placement_count, downloaded_at, personal_state_at,
    expires_at, status
  ) values (
    v_checkout, p_package_id, p_request_id, v_user, p_device_id, v_session.id,
    p_scope, v_content_revision::text, v_package_revision::text,
    jsonb_build_object('playerRating', v_player, 'session', to_jsonb(v_session)),
    v_baseline, v_problem_count, v_placement_count, v_now, v_now,
    v_now + interval '7 days', 'materializing'
  );
  raise log 'offline package materialized checkout=% problems=% placements=%',
    v_checkout, v_problem_count, v_placement_count;

  v_page_count := case when v_problem_count = 0 then 0
                       else ((v_problem_count - 1) / 250) + 1 end;
  for v_page in 0..v_page_count - 1 loop
    select jsonb_build_object(
      'memberships', coalesce((select jsonb_agg(jsonb_build_object(
        'packageId', p_package_id, 'packageRevision', v_package_revision::text,
        'canonicalId', i.canonical_id) order by i.canonical_id)
        from offline_scope_ids i where i.page_index = v_page), '[]'::jsonb),
      'problems', coalesce((select jsonb_agg(jsonb_build_object(
        'canonicalId', p.id, 'contentRevision', v_content_revision::text,
        'statement', p.statement, 'topic', p.topic, 'choices', p.choices,
        'answerIndex', case when p.answer_index < 0 then null else p.answer_index end,
        'answerStatus', p.answer_status, 'officialSolutions', p.official_solutions,
        'verified', p.verified, 'isComputational', p.is_computational,
        'responseKind', p.response_kind, 'aopsId', p.aops_id, 'tags', p.tags,
        'difficulty', p.difficulty, 'quality', p.quality, 'notes', p.notes,
        'builtAt', p.built_at, 'assetKeys', '[]'::jsonb) order by p.id)
        from public.problems p join offline_scope_ids i on i.canonical_id = p.id
        where i.page_index = v_page), '[]'::jsonb),
      'placements', coalesce((select jsonb_agg(jsonb_build_object(
        'packageRevision', v_package_revision::text, 'placementId', p.id,
        'canonicalId', coalesce(p.canonical_id, p.id), 'testId', p.test_id,
        'problemNumber', p.n, 'topic', p.topic,
        'test', case when t.id is null then null else jsonb_build_object(
          'name', t.name, 'seriesId', t.series_id, 'division', t.division,
          'format', t.format, 'year', t.year, 'aopsCategoryId', t.aops_category_id) end,
        'series', case when s.id is null then null else jsonb_build_object(
          'id', s.id, 'name', s.name) end) order by p.id)
        from public.problems p
        join offline_scope_ids i on i.canonical_id = coalesce(p.canonical_id, p.id)
        left join public.tests t on t.id = p.test_id
        left join public.series s on s.id = t.series_id
        where i.page_index = v_page), '[]'::jsonb),
      'assets', '[]'::jsonb,
      'personalStates', coalesce((select jsonb_agg(jsonb_build_object(
        'userId', v_user, 'canonicalId', i.canonical_id,
        'progress', case when pp.user_id is null then null else jsonb_build_object(
          'times_seen', pp.times_seen, 'times_correct', pp.times_correct,
          'times_reviewed', pp.times_reviewed, 'times_skipped', pp.times_skipped,
          'last_correct', pp.last_correct, 'last_reviewed_at', pp.last_reviewed_at,
          'last_submission_at', pp.last_submission_at,
          'next_review_at', pp.next_review_at, 'solved', pp.solved,
          'mastery', pp.mastery, 'engagement', pp.engagement) end)
          order by i.canonical_id)
        from offline_scope_ids i left join public.problem_progress pp
          on pp.user_id = v_user and pp.problem_id = i.canonical_id
        where i.page_index = v_page), '[]'::jsonb),
      'ratings', coalesce((select jsonb_agg(jsonb_build_object(
        'canonicalId', pr.problem_id, 'rating', pr.rating, 'rd', pr.rd,
        'attempts', pr.attempts) order by pr.problem_id)
        from public.problem_ratings pr join offline_scope_ids i
          on i.canonical_id = pr.problem_id
        where i.page_index = v_page and pr.scope = 'overall'), '[]'::jsonb)
    ) into v_records;

    insert into public.offline_package_pages(checkout_id, page_index, records)
    values (v_checkout, v_page, v_records);
  end loop;

  return public.offline_checkout_created(v_checkout);
end;
$$;

-- Phase two: accept only the deterministic asset-enriched pages and RFC 8785
-- checksums computed by the shared TypeScript code, then issue the revision.
create or replace function public.offline_finalize_package(
  p_checkout_id uuid,
  p_pages jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  c public.offline_checkouts;
  item jsonb;
  expected_pages integer;
  v_json_bytes bigint;
  v_asset_count integer;
begin
  select * into c from public.offline_checkouts where id = p_checkout_id for update;
  if not found or c.user_id <> auth.uid() then raise exception 'OFFLINE_CHECKOUT_INVALID'; end if;
  if c.status in ('issued', 'ready') then return public.offline_checkout_created(c.id); end if;
  if c.status <> 'materializing' then raise exception 'OFFLINE_PACKAGE_REVISION_INVALID'; end if;
  if jsonb_typeof(p_pages) <> 'array' then raise exception 'OFFLINE_OPERATION_INVALID:pages'; end if;
  expected_pages := case when c.problem_count = 0 then 0 else ((c.problem_count - 1) / c.page_size) + 1 end;
  if jsonb_array_length(p_pages) <> expected_pages then
    raise exception 'OFFLINE_OPERATION_INVALID:incomplete pages';
  end if;

  for item in select value from jsonb_array_elements(p_pages) loop
    if nullif(item->>'checksum', '') is null
       or (item->>'decodedBytes')::integer > 2097152 then
      raise exception 'OFFLINE_BATCH_TOO_LARGE:page';
    end if;
    update public.offline_package_pages
       set records = item->'records', checksum = item->>'checksum',
           decoded_bytes = (item->>'decodedBytes')::integer
     where checkout_id = c.id and page_index = (item->>'pageIndex')::integer;
    if not found then raise exception 'OFFLINE_OPERATION_INVALID:unknown page'; end if;
  end loop;

  if exists (select 1 from public.offline_package_pages
             where checkout_id = c.id and checksum is null) then
    raise exception 'OFFLINE_OPERATION_INVALID:missing checksum';
  end if;
  select coalesce(sum(decoded_bytes), 0) into v_json_bytes
  from public.offline_package_pages where checkout_id = c.id;
  if v_json_bytes > 52428800 then raise exception 'OFFLINE_BATCH_TOO_LARGE:json'; end if;
  select count(distinct asset->>'key') into v_asset_count
  from public.offline_package_pages p,
       lateral jsonb_array_elements(p.records->'assets') asset
  where p.checkout_id = c.id;

  update public.offline_checkouts
     set status = 'issued', issued_at = clock_timestamp(), completed_at = clock_timestamp(),
         expires_at = null, asset_count = v_asset_count,
         estimated_json_bytes = v_json_bytes
   where id = c.id;
  raise log 'offline package issued checkout=% pages=% json_bytes=% assets=%',
    c.id, expected_pages, v_json_bytes, v_asset_count;
  return public.offline_checkout_created(c.id);
end;
$$;

create or replace function public.offline_mark_checkout_ready(p_checkout_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.offline_checkouts set status = 'ready', ready_at = coalesce(ready_at, clock_timestamp())
  where id = p_checkout_id and user_id = auth.uid() and status in ('issued', 'ready');
  if not found then raise exception 'OFFLINE_CHECKOUT_INVALID'; end if;
  delete from public.offline_package_pages where checkout_id = p_checkout_id;
end; $$;

create or replace function public.offline_close_checkout(p_checkout_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.offline_checkouts
     set status = 'closed', closed_at = clock_timestamp(), expires_at = clock_timestamp() + interval '30 days'
   where id = p_checkout_id and user_id = auth.uid() and status in ('issued', 'ready', 'closed');
  if not found then raise exception 'OFFLINE_CHECKOUT_INVALID'; end if;
  delete from public.offline_package_pages where checkout_id = p_checkout_id;
end; $$;

create or replace function public.offline_abandon_checkout(p_checkout_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.offline_checkouts
     set status = 'abandoned', abandoned_at = clock_timestamp(), expires_at = clock_timestamp() + interval '90 days'
   where id = p_checkout_id and user_id = auth.uid()
     and status in ('materializing', 'issued', 'ready', 'abandoned');
  if not found then raise exception 'OFFLINE_CHECKOUT_INVALID'; end if;
  delete from public.offline_package_pages where checkout_id = p_checkout_id;
end; $$;

create or replace function public.offline_cleanup_checkouts()
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.offline_checkouts set status = 'expired', completed_at = clock_timestamp()
  where status = 'materializing' and expires_at <= clock_timestamp();
  delete from public.offline_package_pages p using public.offline_checkouts c
  where p.checkout_id = c.id and c.status = 'expired';
  delete from public.offline_checkouts
  where status in ('closed', 'abandoned', 'expired') and expires_at <= clock_timestamp();
  get diagnostics n = row_count;
  return n;
end; $$;

-- Closed v1 transactional sync. Each operation is validated and applied in
-- durable sequence order; any exception rolls the entire batch back.
create or replace function public.offline_sync_v1(
  p_device_id uuid,
  p_checkout_id uuid,
  p_package_id uuid,
  p_package_revision text,
  p_operations jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  c public.offline_checkouts;
  v_now timestamp with time zone := clock_timestamp();
  op jsonb;
  prev_sequence bigint := -1;
  op_id uuid;
  op_type text;
  canonical bigint;
  baseline jsonb;
  current_progress public.problem_progress;
  desired text;
  occurred timestamp with time zone;
  sub public.submissions;
  prior_result jsonb;
  op_result jsonb;
  op_overlaps jsonb;
  all_overlaps jsonb := '[]'::jsonb;
  submission_results jsonb := '[]'::jsonb;
  touched bigint[] := '{}'::bigint[];
  acknowledged jsonb := '[]'::jsonb;
  dep text;
  session_json jsonb;
  player_json jsonb;
  personal_json jsonb;
  ratings_json jsonb;
begin
  if v_user is null then raise exception 'OFFLINE_AUTH_REQUIRED'; end if;
  select * into c from public.offline_checkouts where id = p_checkout_id for update;
  if not found then raise exception 'OFFLINE_CHECKOUT_INVALID'; end if;
  if c.user_id <> v_user or c.device_id <> p_device_id then raise exception 'OFFLINE_OWNER_MISMATCH'; end if;
  if c.package_id <> p_package_id or c.package_revision <> p_package_revision then
    raise exception 'OFFLINE_PACKAGE_REVISION_INVALID';
  end if;
  if c.status not in ('issued', 'ready') then raise exception 'OFFLINE_CHECKOUT_INVALID'; end if;
  if jsonb_typeof(p_operations) <> 'array' or jsonb_array_length(p_operations) = 0 then
    raise exception 'OFFLINE_OPERATION_INVALID:empty batch';
  end if;
  if jsonb_array_length(p_operations) > 100 then raise exception 'OFFLINE_BATCH_TOO_LARGE'; end if;
  if (select count(distinct value->>'id') from jsonb_array_elements(p_operations))
       <> jsonb_array_length(p_operations) then
    raise exception 'OFFLINE_OPERATION_INVALID:duplicate operation id';
  end if;

  for op in select value from jsonb_array_elements(p_operations) loop
    begin op_id := (op->>'id')::uuid;
    exception when others then raise exception 'OFFLINE_OPERATION_INVALID:operation id'; end;
    op_type := op->>'type';
    if (op->>'userId')::uuid <> v_user then
      raise exception 'OFFLINE_OWNER_MISMATCH';
    end if;
    if op_type not in ('submission', 'mastery', 'engagement', 'session-finish')
       or (op->>'version')::integer <> 1
       or (op->>'checkoutId')::uuid <> c.id
       or (op->>'packageId')::uuid <> c.package_id
       or (op->>'sessionId')::bigint <> c.session_id then
      raise exception 'OFFLINE_OPERATION_INVALID:%:identity', op_id;
    end if;
    if (op->>'sequence')::bigint <= prev_sequence then
      raise exception 'OFFLINE_OPERATION_INVALID:%:sequence', op_id;
    end if;
    prev_sequence := (op->>'sequence')::bigint;
    if jsonb_array_length(coalesce(op->'dependsOn', '[]'::jsonb)) > 16 then
      raise exception 'OFFLINE_OPERATION_INVALID:%:dependencies', op_id;
    end if;
    for dep in select jsonb_array_elements_text(coalesce(op->'dependsOn', '[]'::jsonb)) loop
      if not exists (select 1 from public.offline_applied_operations a
                     where a.checkout_id = c.id and a.operation_id = dep::uuid)
         and not exists (select 1 from jsonb_array_elements(p_operations) prior
                         where prior->>'id' = dep
                           and (prior->>'sequence')::bigint < (op->>'sequence')::bigint) then
        raise exception 'OFFLINE_OPERATION_INVALID:%:dependency', op_id;
      end if;
    end loop;
    if op_type = 'session-finish' and op <> (p_operations->(jsonb_array_length(p_operations)-1)) then
      raise exception 'OFFLINE_OPERATION_INVALID:%:session finish must be last', op_id;
    end if;

    select result into prior_result from public.offline_applied_operations
    where checkout_id = c.id and operation_id = op_id;
    if found then
      acknowledged := acknowledged || jsonb_build_array(op_id);
      all_overlaps := all_overlaps || coalesce(prior_result->'overlaps', '[]'::jsonb);
      if prior_result ? 'submission' then
        submission_results := submission_results || jsonb_build_array(prior_result->'submission');
      end if;
      if op_type <> 'session-finish' then
        canonical := (op->'payload'->>'canonicalId')::bigint;
        if not canonical = any(touched) then touched := array_append(touched, canonical); end if;
      end if;
      continue;
    end if;

    op_overlaps := '[]'::jsonb;
    op_result := '{}'::jsonb;
    if op_type <> 'session-finish' then
      canonical := (op->'payload'->>'canonicalId')::bigint;
      if not c.personal_baseline ? canonical::text then
        raise exception 'OFFLINE_OPERATION_INVALID:%:problem outside package', op_id;
      end if;
      if not canonical = any(touched) then touched := array_append(touched, canonical); end if;
      baseline := c.personal_baseline->canonical::text;
      select * into current_progress from public.problem_progress
      where user_id = v_user and problem_id = canonical;

      if op_type = 'submission' and exists (
        select 1 from public.submissions s
        where s.user_id = v_user and s.problem_id = canonical
          and s.created_at > c.downloaded_at and s.client_key is distinct from (op->'payload'->>'clientKey')::uuid
      ) then
        op_overlaps := op_overlaps || jsonb_build_array(jsonb_build_object(
          'canonicalId', canonical, 'kind', 'activity_since_download'));
      elsif op_type = 'mastery' then
        desired := op->'payload'->>'mastery';
        if current_progress.mastery is distinct from (baseline->>'mastery')
           and current_progress.mastery is distinct from desired then
          op_overlaps := op_overlaps || jsonb_build_array(jsonb_build_object(
            'canonicalId', canonical, 'kind', 'mastery_replaced'));
        end if;
      elsif op_type = 'engagement' then
        desired := op->'payload'->>'engagement';
        if current_progress.engagement is distinct from (baseline->>'engagement')
           and current_progress.engagement is distinct from desired then
          op_overlaps := op_overlaps || jsonb_build_array(jsonb_build_object(
            'canonicalId', canonical, 'kind', 'engagement_replaced'));
        end if;
      end if;
    end if;

    if op_type = 'submission' then
      if octet_length(coalesce(op->'payload'->>'answer', '')) > 65536 then
        raise exception 'OFFLINE_OPERATION_INVALID:%:answer too large', op_id;
      end if;
      occurred := greatest(c.downloaded_at,
        least((op->>'occurredAt')::timestamp with time zone, v_now));
      insert into public.submissions (
        user_id, problem_id, selected_choice, answer, is_correct, skipped,
        flagged, elapsed_ms, source, session_id, tries_used, client_key,
        occurred_at, created_at
      ) values (
        v_user, canonical, (op->'payload'->>'selectedChoice')::integer,
        op->'payload'->>'answer', (op->'payload'->>'isCorrect')::boolean,
        (op->'payload'->>'skipped')::boolean, (op->'payload'->>'flagged')::boolean,
        (op->'payload'->>'elapsedMs')::integer, 'practice', c.session_id,
        (op->'payload'->>'triesUsed')::integer,
        (op->'payload'->>'clientKey')::uuid, occurred, clock_timestamp()
      ) on conflict (user_id, client_key) where client_key is not null do nothing
      returning * into sub;
      if not found then
        select * into sub from public.submissions
        where user_id = v_user and client_key = (op->'payload'->>'clientKey')::uuid;
        if sub.problem_id <> canonical or sub.session_id <> c.session_id
           or sub.selected_choice is distinct from (op->'payload'->>'selectedChoice')::integer
           or sub.answer is distinct from (op->'payload'->>'answer')
           or sub.is_correct is distinct from (op->'payload'->>'isCorrect')::boolean
           or sub.skipped <> (op->'payload'->>'skipped')::boolean then
          raise exception 'OFFLINE_CONFLICT:%:client key payload mismatch', op_id;
        end if;
      end if;
      op_result := jsonb_build_object('submission', jsonb_build_object(
        'clientKey', sub.client_key, 'submissionId', sub.id,
        'createdAt', sub.created_at, 'occurredAt', sub.occurred_at));
      submission_results := submission_results || jsonb_build_array(op_result->'submission');
    elsif op_type = 'mastery' then
      desired := op->'payload'->>'mastery';
      if desired is not null and desired not in ('needs_work', 'learning', 'confident') then
        raise exception 'OFFLINE_OPERATION_INVALID:%:mastery', op_id;
      end if;
      insert into public.problem_progress(user_id, problem_id, mastery)
      values (v_user, canonical, desired)
      on conflict on constraint problem_progress_pkey do update set mastery = excluded.mastery;
      delete from public.problem_progress where user_id = v_user and problem_id = canonical
        and times_seen = 0 and mastery is null and engagement is null;
    elsif op_type = 'engagement' then
      desired := op->'payload'->>'engagement';
      if desired is not null and desired not in ('working', 'revisit', 'later', 'ignored') then
        raise exception 'OFFLINE_OPERATION_INVALID:%:engagement', op_id;
      end if;
      insert into public.problem_progress(user_id, problem_id, engagement)
      values (v_user, canonical, desired)
      on conflict on constraint problem_progress_pkey do update set engagement = excluded.engagement;
      delete from public.problem_progress where user_id = v_user and problem_id = canonical
        and times_seen = 0 and mastery is null and engagement is null;
    else
      occurred := greatest(c.downloaded_at,
        least((op->'payload'->>'endedAt')::timestamp with time zone, v_now));
      update public.practice_sessions set status = 'ended', ended_at = occurred, updated_at = clock_timestamp()
      where id = c.session_id and user_id = v_user and not is_root;
      if not found then raise exception 'OFFLINE_OPERATION_INVALID:%:session', op_id; end if;
    end if;

    op_result := op_result || jsonb_build_object('overlaps', op_overlaps);
    insert into public.offline_applied_operations(
      checkout_id, operation_id, operation_type, result)
    values (c.id, op_id, op_type, op_result);
    acknowledged := acknowledged || jsonb_build_array(op_id);
    all_overlaps := all_overlaps || op_overlaps;
  end loop;

  update public.offline_checkouts set last_synced_at = v_now where id = c.id;
  raise log 'offline sync applied checkout=% operations=% touched=%',
    c.id, jsonb_array_length(p_operations), cardinality(touched);
  select to_jsonb(s) into session_json from public.practice_sessions s where s.id = c.session_id;
  select case when r.user_id is null then null else jsonb_build_object(
    'rating', r.rating, 'rd', r.rd, 'matches', r.matches,
    'last_match_at', r.last_match_at) end into player_json
  from (select 1) seed left join public.player_ratings r
    on r.user_id = v_user and r.scope = 'overall';
  select coalesce(jsonb_agg(jsonb_build_object(
    'userId', v_user, 'canonicalId', x.canonical_id,
    'progress', case when pp.user_id is null then null else jsonb_build_object(
      'times_seen', pp.times_seen, 'times_correct', pp.times_correct,
      'times_reviewed', pp.times_reviewed, 'times_skipped', pp.times_skipped,
      'last_correct', pp.last_correct, 'last_reviewed_at', pp.last_reviewed_at,
      'last_submission_at', pp.last_submission_at, 'next_review_at', pp.next_review_at,
      'solved', pp.solved, 'mastery', pp.mastery, 'engagement', pp.engagement) end)
    order by x.canonical_id), '[]'::jsonb) into personal_json
  from unnest(touched) x(canonical_id)
  left join public.problem_progress pp on pp.user_id = v_user and pp.problem_id = x.canonical_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'canonicalId', r.problem_id, 'rating', r.rating, 'rd', r.rd,
    'attempts', r.attempts) order by r.problem_id), '[]'::jsonb) into ratings_json
  from public.problem_ratings r where r.scope = 'overall' and r.problem_id = any(touched);

  return jsonb_build_object(
    'version', 1, 'status', 'applied', 'checkoutId', c.id,
    'acknowledgedOperationIds', acknowledged,
    'submissions', submission_results,
    'overlaps', (select coalesce(jsonb_agg(value), '[]'::jsonb)
      from (select distinct value from jsonb_array_elements(all_overlaps)) d),
    'authoritative', jsonb_build_object(
      'session', session_json, 'playerRating', player_json,
      'personalStates', personal_json, 'problemRatings', ratings_json),
    'syncedAt', v_now
  );
end;
$$;

revoke all on function public.offline_checkout_created(uuid) from public;
revoke all on function public.offline_begin_package(uuid, uuid, uuid, jsonb, bigint, text, jsonb) from public;
revoke all on function public.offline_finalize_package(uuid, jsonb) from public;
revoke all on function public.offline_mark_checkout_ready(uuid) from public;
revoke all on function public.offline_close_checkout(uuid) from public;
revoke all on function public.offline_abandon_checkout(uuid) from public;
revoke all on function public.offline_sync_v1(uuid, uuid, uuid, text, jsonb) from public;
revoke all on function public.offline_cleanup_checkouts() from public;

grant execute on function public.offline_checkout_created(uuid) to authenticated;
grant execute on function public.offline_begin_package(uuid, uuid, uuid, jsonb, bigint, text, jsonb) to authenticated;
grant execute on function public.offline_finalize_package(uuid, jsonb) to authenticated;
grant execute on function public.offline_mark_checkout_ready(uuid) to authenticated;
grant execute on function public.offline_close_checkout(uuid) to authenticated;
grant execute on function public.offline_abandon_checkout(uuid) to authenticated;
grant execute on function public.offline_sync_v1(uuid, uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.offline_cleanup_checkouts() to service_role;
