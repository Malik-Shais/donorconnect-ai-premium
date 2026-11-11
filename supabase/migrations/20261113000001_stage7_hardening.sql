-- Stage 7: security hardening found by the pre-deployment audit.
--  F1  anon_rate_limit() was callable by anyone holding the PUBLIC anon key: an attacker could burn the global login/register/AI counters
--      and lock every user out. It now requires a server-only secret (header x-limiter-secret) and fails CLOSED in production.
--  F2  demo/fictional classification was only an email-domain heuristic. It is now explicit, protected and audited.
--  F3  admin request exports leaked row-level quasi-identifiers (id + exact date + city + group). They are now k-anonymous aggregates.

-- ---------- settings (no API access at all) ----------
create table public.app_settings (key text primary key, value text not null);
alter table public.app_settings enable row level security;          -- no policies: unreachable through the API
revoke all on public.app_settings from public, anon, authenticated;
insert into public.app_settings values
  ('environment', 'development'),          -- set to 'production' when deploying (see docs/DEPLOYMENT.md)
  ('limiter_secret_sha256', '');           -- sha256 hex of the server-only RATE_LIMIT_SECRET; empty = not enforced (development only)

-- ---------- F1: limiter gate ----------
create or replace function public.anon_rate_limit(p_action text, p_subject text, p_count boolean default true)
returns integer language plpgsql security definer set search_path = '' as $$
declare rule public.rate_limit_rules; h int; w timestamptz; want text; hdr jsonb; given text;
begin
  select value into want from public.app_settings where key = 'limiter_secret_sha256';
  if coalesce(want, '') <> '' then
    begin hdr := current_setting('request.headers', true)::jsonb; exception when others then hdr := null; end;
    given := hdr ->> 'x-limiter-secret';
    if given is null or encode(sha256(convert_to(given, 'utf8')), 'hex') <> want then raise exception 'Limiter credential required' using errcode = '42501'; end if;
  elsif (select value from public.app_settings where key = 'environment') = 'production' then
    raise exception 'Limiter is not configured' using errcode = '42501';  -- production without a secret must fail closed
  end if;
  if p_subject is null or char_length(p_subject) not between 1 and 128 then raise exception 'Invalid subject'; end if;
  select * into rule from public.rate_limit_rules where action = p_action and scope = 'anon';
  if not found then raise exception 'Unknown rate-limited action'; end if;
  if p_count then return public.rate_limit_hit('a:' || p_action || ':' || p_subject, rule.max_hits, rule.window_seconds); end if;
  w := to_timestamp(floor(extract(epoch from now()) / rule.window_seconds) * rule.window_seconds);
  select hits into h from public.rate_limits where key = 'a:' || p_action || ':' || p_subject and window_start = w;
  if coalesce(h, 0) >= rule.max_hits then return greatest(1, ceil(extract(epoch from (w + rule.window_seconds * interval '1 second' - now())))::int); end if;
  return 0;
end $$;

-- ---------- F2: explicit, protected demo classification ----------
-- Signals: (a) reserved ".example" sign-up address (can never receive mail), (b) an administrator's audited decision (set_account_demo),
-- (c) the seed script marking its own accounts through the service role. Users cannot write the column (no grant) and the trigger below blocks
-- every other writer. In production, demo-domain sign-ups are refused outright so fictional accounts cannot pollute real metrics.
create or replace function public.t_profile_demo() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.is_demo := exists (select 1 from auth.users u where u.id = new.id and lower(u.email) like '%.example');
  if new.is_demo and (select value from public.app_settings where key = 'environment') = 'production' then
    raise exception 'Demo-domain accounts are not allowed in production';
  end if;
  return new;
end $$;

create function public.t_profile_demo_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.is_demo is distinct from old.is_demo and current_user not in ('postgres', 'supabase_admin', 'service_role') then
    raise exception 'The demo flag is managed by administrators only' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger t_profile_demo_guard before update of is_demo on public.profiles for each row execute function public.t_profile_demo_guard();

create function public.set_account_demo(p_user uuid, p_demo boolean, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 then raise exception 'A reason (at least 5 characters) is required'; end if;
  if p_demo and (select value from public.app_settings where key = 'environment') = 'production' then
    raise exception 'Accounts cannot be marked as demo in production';
  end if;
  update public.profiles set is_demo = p_demo where id = p_user;
  if not found then raise exception 'User not found'; end if;
  insert into public.audit_logs (actor_id, action, entity, entity_id, detail)
  values (uid, 'account.demo_flag', 'profiles', p_user::text, jsonb_build_object('demo', p_demo, 'reason', left(btrim(p_reason), 200)));
end $$;

-- ---------- F3: k-anonymous administrator request export ----------
-- Cells = ISO week x city x blood group x urgency x status. A cell below p_min is first generalised (city -> "Other (small groups)"),
-- then, if still below p_min, folded into ONE attribute-free "(suppressed)" row. No request id and no exact date leave the system.
create function public.report_requests_aggregate(p_from date, p_to date, p_city text default null, p_group public.blood_group default null, p_data_scope text default 'all', p_min int default 5)
returns table (week_start text, city text, blood_group text, urgency text, status text, requests bigint, units bigint)
language plpgsql stable security definer set search_path = '' as $$
declare t0 timestamptz := p_from::timestamp at time zone 'UTC'; t1 timestamptz := (p_to + 1)::timestamp at time zone 'UTC'; c text := nullif(lower(btrim(coalesce(p_city, ''))), ''); total bigint;
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  perform public.analytics_check(p_from, p_to, c, p_data_scope, p_min);
  select count(*) into total from public.analytics_request_facts x
   where x.created_at >= t0 and x.created_at < t1 and (c is null or lower(x.city) = c) and (p_group is null or x.blood_group = p_group) and (p_data_scope = 'all' or (p_data_scope = 'demo') = x.is_demo);
  if (c is not null or p_group is not null) and total < p_min then raise exception 'This selection is too small to export (fewer than % requests)', p_min; end if;
  return query
  with f as (select to_char(date_trunc('week', x.created_at at time zone 'UTC'), 'YYYY-MM-DD') as wk, x.city as cty, x.blood_group::text as bg, x.urgency::text as ug, x.status::text as st, x.units as unt
             from public.analytics_request_facts x
             where x.created_at >= t0 and x.created_at < t1 and (c is null or lower(x.city) = c) and (p_group is null or x.blood_group = p_group) and (p_data_scope = 'all' or (p_data_scope = 'demo') = x.is_demo)),
  l1 as (select wk, cty, bg, ug, st, count(*) n, sum(unt) u from f group by 1, 2, 3, 4, 5),
  g1 as (select wk, case when n >= p_min then cty else 'Other (small groups)' end as cty, bg, ug, st, sum(n) n, sum(u) u from l1 group by 1, 2, 3, 4, 5),
  ok as (select * from g1 where n >= p_min),
  bad as (select coalesce(sum(n), 0) n, coalesce(sum(u), 0) u from g1 where n < p_min)
  select o.wk, o.cty, o.bg, o.ug, o.st, o.n::bigint, o.u::bigint from ok o
  union all select '(suppressed)', '(suppressed)', '(suppressed)', '(suppressed)', '(suppressed)', b.n::bigint, b.u::bigint from bad b where b.n > 0
  order by 1, 2, 3, 4, 5;
end $$;

revoke all on function public.set_account_demo(uuid, boolean, text), public.report_requests_aggregate(date, date, text, public.blood_group, text, int),
  public.t_profile_demo_guard() from public, anon, authenticated;
grant execute on function public.set_account_demo(uuid, boolean, text), public.report_requests_aggregate(date, date, text, public.blood_group, text, int) to authenticated;

-- ---------- F4: report functions must not fall back to generic plans ----------
-- Load test (1 200 users, 6 000 requests): after 5 calls plpgsql switched analytics_admin to a generic plan that was 4-5x slower
-- (~830 ms vs ~170 ms for a 365-day range). Reports are parameter-sensitive (date ranges, optional filters), so custom plans are always right.
alter function public.analytics_admin(date, date, text, public.blood_group, text, int) set plan_cache_mode = force_custom_plan;
alter function public.analytics_donor(date, date, text, public.blood_group) set plan_cache_mode = force_custom_plan;
alter function public.analytics_requester(date, date, text, public.blood_group) set plan_cache_mode = force_custom_plan;
alter function public.report_requests(text, date, date, text, public.blood_group, text, int, int) set plan_cache_mode = force_custom_plan;
alter function public.report_offers_mine(date, date, text, public.blood_group, int, int) set plan_cache_mode = force_custom_plan;
alter function public.report_requests_aggregate(date, date, text, public.blood_group, text, int) set plan_cache_mode = force_custom_plan;
