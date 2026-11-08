-- Stage 6: analytics and reporting. Read-only SQL functions over real tables; nothing here is hardcoded.
-- Metric definitions live in docs/STAGE6-ANALYTICS.md. All timestamps and day buckets are UTC.

-- ---------- 1. data-model additions (audit findings) ----------
-- Offers only had created_at, so response/withdraw times were unknowable except via audit_logs. Keep them on the row.
alter table public.offers add column accepted_at timestamptz, add column responded_at timestamptz, add column withdrawn_at timestamptz;

update public.offers o set
  responded_at = case when o.status = 'invited' then null else coalesce(
    (select min(a.created_at) from public.audit_logs a where a.entity = 'offers' and a.entity_id = o.id::text and a.action in ('offer.accept', 'offer.decline')), o.created_at) end,
  accepted_at = case when o.status in ('accepted', 'withdrawn') then coalesce(
    (select min(a.created_at) from public.audit_logs a where a.entity = 'offers' and a.entity_id = o.id::text and a.action = 'offer.accept'), o.created_at) end,
  withdrawn_at = case when o.status = 'withdrawn' then coalesce(
    (select max(a.created_at) from public.audit_logs a where a.entity = 'offers' and a.entity_id = o.id::text and a.action = 'offer.withdraw'), o.created_at) end;

create function public.t_offer_times() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'invited' then new.responded_at := now(); end if;
    if new.status = 'accepted' then new.accepted_at := now(); end if;
  elsif new.status is distinct from old.status then
    if old.status = 'invited' then new.responded_at := coalesce(old.responded_at, now()); end if;
    if new.status = 'accepted' then new.accepted_at := coalesce(old.accepted_at, now()); new.withdrawn_at := null; end if;
    if new.status = 'withdrawn' then new.withdrawn_at := now(); end if;
  end if;
  return new;
end $$;
create trigger t_offer_times before insert or update of status on public.offers for each row execute function public.t_offer_times();

-- Fictional vs real: any account whose email uses the reserved ".example" TLD (RFC 2606: demo.example, test.example) is fictional.
alter table public.profiles add column is_demo boolean not null default false;
update public.profiles p set is_demo = true from auth.users u where u.id = p.id and lower(u.email) like '%.example';
create function public.t_profile_demo() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.is_demo := exists (select 1 from auth.users u where u.id = new.id and lower(u.email) like '%.example');
  return new;
end $$;
create trigger t_profile_demo before insert on public.profiles for each row execute function public.t_profile_demo();

-- Indexes for the aggregations (all queries are date-ranged and/or per-user).
create index blood_requests_created on public.blood_requests (created_at);
create index blood_requests_city_lower on public.blood_requests (lower(city));
create index request_events_req_status on public.request_events (request_id, status, created_at);
create index offers_request_accepted on public.offers (request_id, accepted_at);
create index offers_donor_created on public.offers (donor_id, created_at);
create index profiles_role on public.profiles (role) where not suspended;
create index notifications_created on public.notifications (created_at);

-- ---------- 2. private fact view (never granted to API roles; used only by the SECURITY DEFINER report functions) ----------
create view public.analytics_request_facts as
select r.id, r.requester_id, r.blood_group, r.city, r.urgency, r.units, r.status, r.created_at, r.reviewed_at,
       e.approved_at, e.matched_at, e.fulfilled_at, e.rejected_at, e.cancelled_at,
       coalesce(o.accepted_offers, 0) as accepted_offers, o.first_accept_at, p.is_demo
from public.blood_requests r
join public.profiles p on p.id = r.requester_id
left join lateral (
  select min(ev.created_at) filter (where ev.status = 'approved')  as approved_at,
         min(ev.created_at) filter (where ev.status = 'matched')   as matched_at,
         min(ev.created_at) filter (where ev.status = 'fulfilled') as fulfilled_at,
         min(ev.created_at) filter (where ev.status = 'rejected')  as rejected_at,
         min(ev.created_at) filter (where ev.status = 'cancelled') as cancelled_at
  from public.request_events ev where ev.request_id = r.id) e on true
left join lateral (
  select count(*) filter (where of.status = 'accepted') as accepted_offers, min(of.accepted_at) as first_accept_at
  from public.offers of where of.request_id = r.id) o on true;
revoke all on public.analytics_request_facts from public, anon, authenticated;

-- ---------- 3. small pure helpers ----------
-- Rate with explicit numerator/denominator; a zero denominator yields rate = null (never 0, never an error).
create function public.analytics_rate(num bigint, den bigint) returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('num', num, 'den', den, 'rate', case when den = 0 then null else round(num::numeric / den, 4) end)
$$;
-- Duration summary in hours; only rows with BOTH timestamps are included, n says how many.
create function public.analytics_stats(vals double precision[]) returns jsonb language sql immutable set search_path = '' as $$
  select case when coalesce(cardinality(vals), 0) = 0 then jsonb_build_object('n', 0, 'median_h', null, 'p90_h', null)
    else (select jsonb_build_object('n', count(*), 'median_h', round((percentile_cont(0.5) within group (order by v))::numeric, 2),
                                    'p90_h', round((percentile_cont(0.9) within group (order by v))::numeric, 2)) from unnest(vals) v) end
$$;
create function public.analytics_bucket(p_from date, p_to date) returns text language sql immutable set search_path = '' as $$
  select case when p_to - p_from <= 31 then 'day' when p_to - p_from <= 180 then 'week' else 'month' end
$$;
-- Validation shared by every report; messages are user-safe (SQLSTATE P0001).
create function public.analytics_check(p_from date, p_to date, p_city text, p_scope text, p_min int default 5) returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_from is null or p_to is null then raise exception 'Choose a start and end date'; end if;
  if p_from > p_to then raise exception 'The start date must not be after the end date'; end if;
  if p_to - p_from > 1830 then raise exception 'The date range can be at most 5 years'; end if;
  if p_city is not null and char_length(p_city) > 60 then raise exception 'Invalid city filter'; end if;
  if p_scope not in ('all', 'real', 'demo') then raise exception 'Invalid data scope'; end if;
  if p_min not between 1 and 50 then raise exception 'Invalid minimum group size'; end if;
end $$;

-- ---------- 4. ADMIN analytics (platform aggregates; small city segments are suppressed) ----------
create function public.analytics_admin(p_from date, p_to date, p_city text default null, p_group public.blood_group default null,
                                       p_scope text default 'all', p_min_group int default 5)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  t0 timestamptz := p_from::timestamp at time zone 'UTC'; t1 timestamptz := (p_to + 1)::timestamp at time zone 'UTC';
  b text := public.analytics_bucket(p_from, p_to); c text := nullif(lower(btrim(coalesce(p_city, ''))), '');
  res jsonb;
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  perform public.analytics_check(p_from, p_to, c, p_scope, p_min_group);

  with
  -- cohort: requests CREATED in range, after filters
  f as (select * from public.analytics_request_facts x
        where x.created_at >= t0 and x.created_at < t1 and (c is null or lower(x.city) = c) and (p_group is null or x.blood_group = p_group)
          and (p_scope = 'all' or (p_scope = 'demo') = x.is_demo)),
  -- same filters but no date bound: used for event-dated trends and the "open demand now" snapshot
  fa as (select * from public.analytics_request_facts x
         where (c is null or lower(x.city) = c) and (p_group is null or x.blood_group = p_group) and (p_scope = 'all' or (p_scope = 'demo') = x.is_demo)),
  d as (select dp.user_id, dp.blood_group, dp.available, dp.eligibility_status, p.suspended, p.created_at, p.city,
               (not p.suspended and dp.available and dp.eligibility_status <> 'deferred') as avail_now
        from public.donor_profiles dp join public.profiles p on p.id = dp.user_id
        where p.role = 'donor' and (c is null or lower(p.city) = c) and (p_group is null or dp.blood_group = p_group) and (p_scope = 'all' or (p_scope = 'demo') = p.is_demo)),
  rq as (select p.id, p.suspended, p.created_at, p.city from public.profiles p
         where p.role = 'requester' and (c is null or lower(p.city) = c) and (p_scope = 'all' or (p_scope = 'demo') = p.is_demo)),
  series as (select generate_series(date_trunc(b, p_from::timestamp), p_to::timestamp, ('1 ' || b)::interval) as s),
  -- city breakdowns: segments smaller than p_min_group (or beyond the top 12) are merged into one "Other" row
  rc as (select min(city) as label, count(*) as n from f group by lower(btrim(city))),
  rcr as (select label, n, row_number() over (order by n desc, label) as rk from rc),
  dc as (select min(city) as label, count(*) as n from d group by lower(btrim(city))),
  dcr as (select label, n, row_number() over (order by n desc, label) as rk from dc),
  invited as (select o.* from public.offers o join f on f.id = o.request_id where o.origin = 'invited'),
  ntf as (select n.* from public.notifications n join public.profiles p on p.id = n.user_id
          where n.created_at >= t0 and n.created_at < t1 and (p_scope = 'all' or (p_scope = 'demo') = p.is_demo)),
  eml as (select e.* from public.email_outbox e join public.profiles p on p.id = e.user_id
          where e.created_at >= t0 and e.created_at < t1 and (p_scope = 'all' or (p_scope = 'demo') = p.is_demo)),
  cons as (select cc.* from public.contact_consents cc join public.offers o on o.id = cc.offer_id join f on f.id = o.request_id where o.accepted_at is not null)
  select jsonb_build_object(
    'meta', jsonb_build_object('from', p_from, 'to', p_to, 'bucket', b, 'city', c, 'blood_group', p_group, 'scope', p_scope, 'min_group', p_min_group,
              'generated_at', now(), 'demo_accounts', (select count(*) from public.profiles where is_demo), 'all_accounts', (select count(*) from public.profiles)),
    'people', jsonb_build_object(
      'donors_total', (select count(*) from d), 'requesters_total', (select count(*) from rq),
      'donors_active', (select count(*) from d where not suspended), 'donors_available', (select count(*) from d where avail_now),
      'donors_new_in_range', (select count(*) from d where created_at >= t0 and created_at < t1), 'requesters_new_in_range', (select count(*) from rq where created_at >= t0 and created_at < t1),
      'donors_engaged_90d', (select count(*) from d where exists (select 1 from public.offers o where o.donor_id = d.user_id and o.responded_at >= now() - interval '90 days')),
      'donors_by_group', (select coalesce(jsonb_agg(jsonb_build_object('group', g, 'total', (select count(*) from d where d.blood_group = g), 'available', (select count(*) from d where d.blood_group = g and avail_now)) order by g), '[]')
                           from unnest(enum_range(null::public.blood_group)) g),
      'donors_by_city', (select coalesce(jsonb_agg(jsonb_build_object('city', l, 'n', n) order by (l = 'Other (small groups)'), n desc, l), '[]') from (
                           select case when n >= p_min_group and rk <= 12 then label else 'Other (small groups)' end as l, sum(n) as n from dcr group by 1) z)),
    'requests', jsonb_build_object(
      'total', (select count(*) from f),
      'by_status',  (select coalesce(jsonb_agg(jsonb_build_object('key', s, 'n', (select count(*) from f where f.status = s)) order by s), '[]') from unnest(enum_range(null::public.request_status)) s),
      'by_urgency', (select coalesce(jsonb_agg(jsonb_build_object('key', u, 'n', (select count(*) from f where f.urgency = u)) order by u), '[]') from unnest(enum_range(null::public.urgency_level)) u),
      'by_group',   (select coalesce(jsonb_agg(jsonb_build_object('key', g, 'n', (select count(*) from f where f.blood_group = g), 'units', (select coalesce(sum(units), 0) from f where f.blood_group = g)) order by g), '[]') from unnest(enum_range(null::public.blood_group)) g),
      'by_city',    (select coalesce(jsonb_agg(jsonb_build_object('city', l, 'n', n) order by (l = 'Other (small groups)'), n desc, l), '[]') from (
                       select case when n >= p_min_group and rk <= 12 then label else 'Other (small groups)' end as l, sum(n) as n from rcr group by 1) z)),
    'rates', jsonb_build_object(
      'approval',     public.analytics_rate((select count(*) from f where approved_at is not null), (select count(*) from f where reviewed_at is not null)),
      'rejection',    public.analytics_rate((select count(*) from f where rejected_at is not null), (select count(*) from f where reviewed_at is not null)),
      'matching',     public.analytics_rate((select count(*) from f where matched_at is not null), (select count(*) from f where approved_at is not null)),
      'fulfillment',  public.analytics_rate((select count(*) from f where fulfilled_at is not null), (select count(*) from f where approved_at is not null)),
      'cancellation', public.analytics_rate((select count(*) from f where status = 'cancelled'), (select count(*) from f))),
    'timing', jsonb_build_object(
      'review',               public.analytics_stats((select array_agg(extract(epoch from reviewed_at - created_at) / 3600) from f where reviewed_at >= created_at)),
      'first_response',       public.analytics_stats((select array_agg(extract(epoch from first_accept_at - approved_at) / 3600) from f where first_accept_at >= approved_at)),
      'approval_to_fulfilled', public.analytics_stats((select array_agg(extract(epoch from fulfilled_at - approved_at) / 3600) from f where fulfilled_at >= approved_at)),
      'approved_without_response', (select count(*) from f where approved_at is not null and first_accept_at is null)),
    'trend', (select coalesce(jsonb_agg(jsonb_build_object('t', to_char(s, 'YYYY-MM-DD'),
                'created',   (select count(*) from fa where date_trunc(b, fa.created_at at time zone 'UTC') = s and fa.created_at >= t0 and fa.created_at < t1),
                'approved',  (select count(*) from fa where date_trunc(b, fa.approved_at at time zone 'UTC') = s and fa.approved_at >= t0 and fa.approved_at < t1),
                'fulfilled', (select count(*) from fa where date_trunc(b, fa.fulfilled_at at time zone 'UTC') = s and fa.fulfilled_at >= t0 and fa.fulfilled_at < t1)) order by s), '[]') from series),
    -- PRELIMINARY: demand = units on approved/matched requests right now; supply = available, non-deferred donors compatible by group (donors, not units)
    'supply_demand', (select coalesce(jsonb_agg(jsonb_build_object('group', g,
                'demand_requests', (select count(*) from fa where fa.blood_group = g and fa.status in ('approved', 'matched')),
                'demand_units', (select coalesce(sum(units), 0) from fa where fa.blood_group = g and fa.status in ('approved', 'matched')),
                'supply_donors', (select count(*) from d join public.blood_compat bc on bc.donor_group = d.blood_group and bc.recipient_group = g where d.avail_now),
                'donors_per_unit', (select case when coalesce(sum(units), 0) = 0 then null else round((select count(*) from d join public.blood_compat bc on bc.donor_group = d.blood_group and bc.recipient_group = g where d.avail_now)::numeric / sum(units), 2) end
                                    from fa where fa.blood_group = g and fa.status in ('approved', 'matched'))) order by g), '[]')
                from unnest(enum_range(null::public.blood_group)) g where p_group is null or g = p_group),
    'workflow', jsonb_build_object(
      'notifications_total', (select count(*) from ntf), 'notifications_read', public.analytics_rate((select count(*) from ntf where is_read), (select count(*) from ntf)),
      'notifications_by_category', (select coalesce(jsonb_agg(jsonb_build_object('key', k, 'n', (select count(*) from ntf where ntf.category = k)) order by k), '[]') from unnest(array['request', 'offer', 'invitation', 'review', 'account']) k),
      'emails_by_status', (select coalesce(jsonb_agg(jsonb_build_object('key', k, 'n', (select count(*) from eml where eml.status = k)) order by k), '[]') from unnest(array['pending', 'sent', 'failed', 'skipped']) k),
      'email_delivery', public.analytics_rate((select count(*) from eml where status = 'sent'), (select count(*) from eml where status in ('sent', 'failed'))),
      'invitations_sent', (select count(*) from invited),
      'invitation_response', public.analytics_rate((select count(*) from invited where responded_at is not null), (select count(*) from invited)),
      'invitation_acceptance', public.analytics_rate((select count(*) from invited where accepted_at is not null), (select count(*) from invited where responded_at is not null)),
      'offers_accepted', (select count(*) from public.offers o join f on f.id = o.request_id where o.accepted_at is not null),
      'offers_withdrawn', (select count(*) from public.offers o join f on f.id = o.request_id where o.status = 'withdrawn'),
      'consent_granted', public.analytics_rate((select count(*) from cons where granted and revoked_at is null), (select count(*) from cons)),
      'consent_revoked', (select count(*) from cons where revoked_at is not null))
  ) into res;
  return res;
end $$;

-- ---------- 5. DONOR analytics: strictly the caller's own offers ----------
create function public.analytics_donor(p_from date, p_to date, p_city text default null, p_group public.blood_group default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid()); t0 timestamptz := p_from::timestamp at time zone 'UTC'; t1 timestamptz := (p_to + 1)::timestamp at time zone 'UTC';
  b text := public.analytics_bucket(p_from, p_to); c text := nullif(lower(btrim(coalesce(p_city, ''))), ''); res jsonb;
begin
  if public.current_app_role() is distinct from 'donor' then raise exception 'Donors only' using errcode = '42501'; end if;
  perform public.analytics_check(p_from, p_to, c, 'all');
  with
  m as (select o.*, r.blood_group, r.city, r.status as request_status from public.offers o join public.blood_requests r on r.id = o.request_id
        where o.donor_id = uid and o.created_at >= t0 and o.created_at < t1 and (c is null or lower(r.city) = c) and (p_group is null or r.blood_group = p_group)),
  series as (select generate_series(date_trunc(b, p_from::timestamp), p_to::timestamp, ('1 ' || b)::interval) as s)
  select jsonb_build_object(
    'meta', jsonb_build_object('from', p_from, 'to', p_to, 'bucket', b, 'city', c, 'blood_group', p_group, 'generated_at', now()),
    'totals', jsonb_build_object('offers', (select count(*) from m),
      'invited', (select count(*) from m where origin = 'invited'), 'volunteered', (select count(*) from m where origin = 'volunteered'),
      'accepted_ever', (select count(*) from m where accepted_at is not null), 'accepted_now', (select count(*) from m where status = 'accepted'),
      'withdrawn', (select count(*) from m where status = 'withdrawn'), 'declined', (select count(*) from m where status = 'declined'), 'awaiting_reply', (select count(*) from m where status = 'invited'),
      -- "completed" = an accepted (not withdrawn) offer on a request that reached fulfilled. The app does not record the donation itself.
      'completed', (select count(*) from m where status = 'accepted' and request_status = 'fulfilled'),
      'contact_shared_now', (select count(*) from m join public.contact_consents cc on cc.offer_id = m.id where cc.granted and cc.revoked_at is null)),
    'by_status', (select coalesce(jsonb_agg(jsonb_build_object('key', s, 'n', (select count(*) from m where m.status = s)) order by s), '[]') from unnest(enum_range(null::public.offer_status)) s),
    'rates', jsonb_build_object(
      'invitation_response', public.analytics_rate((select count(*) from m where origin = 'invited' and responded_at is not null), (select count(*) from m where origin = 'invited')),
      'acceptance', public.analytics_rate((select count(*) from m where accepted_at is not null), (select count(*) from m where responded_at is not null)),
      'completion', public.analytics_rate((select count(*) from m where status = 'accepted' and request_status = 'fulfilled'), (select count(*) from m where accepted_at is not null)),
      'withdrawal', public.analytics_rate((select count(*) from m where status = 'withdrawn'), (select count(*) from m where accepted_at is not null))),
    'timing', jsonb_build_object('invitation_reply', public.analytics_stats((select array_agg(extract(epoch from responded_at - created_at) / 3600) from m where origin = 'invited' and responded_at >= created_at))),
    'trend', (select coalesce(jsonb_agg(jsonb_build_object('t', to_char(s, 'YYYY-MM-DD'),
                'invited',   (select count(*) from m where origin = 'invited' and date_trunc(b, m.created_at at time zone 'UTC') = s),
                'accepted',  (select count(*) from m where date_trunc(b, m.accepted_at at time zone 'UTC') = s),
                'declined',  (select count(*) from m where status = 'declined' and date_trunc(b, m.responded_at at time zone 'UTC') = s),
                'withdrawn', (select count(*) from m where date_trunc(b, m.withdrawn_at at time zone 'UTC') = s)) order by s), '[]') from series)
  ) into res;
  return res;
end $$;

-- ---------- 6. REQUESTER analytics: strictly the caller's own requests; accepted offers are counted, donors are never identified ----------
create function public.analytics_requester(p_from date, p_to date, p_city text default null, p_group public.blood_group default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid()); t0 timestamptz := p_from::timestamp at time zone 'UTC'; t1 timestamptz := (p_to + 1)::timestamp at time zone 'UTC';
  b text := public.analytics_bucket(p_from, p_to); c text := nullif(lower(btrim(coalesce(p_city, ''))), ''); res jsonb;
begin
  if public.current_app_role() is distinct from 'requester' then raise exception 'Requesters only' using errcode = '42501'; end if;
  perform public.analytics_check(p_from, p_to, c, 'all');
  with
  f as (select * from public.analytics_request_facts x where x.requester_id = uid and x.created_at >= t0 and x.created_at < t1
        and (c is null or lower(x.city) = c) and (p_group is null or x.blood_group = p_group)),
  series as (select generate_series(date_trunc(b, p_from::timestamp), p_to::timestamp, ('1 ' || b)::interval) as s)
  select jsonb_build_object(
    'meta', jsonb_build_object('from', p_from, 'to', p_to, 'bucket', b, 'city', c, 'blood_group', p_group, 'generated_at', now()),
    'totals', jsonb_build_object('requests', (select count(*) from f), 'units', (select coalesce(sum(units), 0) from f),
      'with_accepted_donor', (select count(*) from f where first_accept_at is not null), 'fulfilled', (select count(*) from f where status = 'fulfilled'),
      'active', (select count(*) from f where status in ('pending_review', 'approved', 'matched'))),
    'by_status',  (select coalesce(jsonb_agg(jsonb_build_object('key', s, 'n', (select count(*) from f where f.status = s)) order by s), '[]') from unnest(enum_range(null::public.request_status)) s),
    'by_urgency', (select coalesce(jsonb_agg(jsonb_build_object('key', u, 'n', (select count(*) from f where f.urgency = u)) order by u), '[]') from unnest(enum_range(null::public.urgency_level)) u),
    'rates', jsonb_build_object(
      'approval',    public.analytics_rate((select count(*) from f where approved_at is not null), (select count(*) from f where reviewed_at is not null)),
      'response',    public.analytics_rate((select count(*) from f where first_accept_at is not null), (select count(*) from f where approved_at is not null)),
      'fulfillment', public.analytics_rate((select count(*) from f where fulfilled_at is not null), (select count(*) from f where approved_at is not null))),
    'timing', jsonb_build_object(
      'review',                public.analytics_stats((select array_agg(extract(epoch from reviewed_at - created_at) / 3600) from f where reviewed_at >= created_at)),
      'first_response',        public.analytics_stats((select array_agg(extract(epoch from first_accept_at - approved_at) / 3600) from f where first_accept_at >= approved_at)),
      'approval_to_fulfilled', public.analytics_stats((select array_agg(extract(epoch from fulfilled_at - approved_at) / 3600) from f where fulfilled_at >= approved_at))),
    'trend', (select coalesce(jsonb_agg(jsonb_build_object('t', to_char(s, 'YYYY-MM-DD'),
                'created',   (select count(*) from f where date_trunc(b, f.created_at at time zone 'UTC') = s),
                'fulfilled', (select count(*) from f where date_trunc(b, f.fulfilled_at at time zone 'UTC') = s)) order by s), '[]') from series)
  ) into res;
  return res;
end $$;

-- ---------- 7. row-level report data (history tables AND CSV exports): no names, contacts, hospitals, patient labels or user ids ----------
create function public.report_requests(p_scope_kind text, p_from date, p_to date, p_city text default null, p_group public.blood_group default null,
                                       p_data_scope text default 'all', p_limit int default 25, p_offset int default 0)
returns table (total_rows bigint, request_id bigint, created_on date, blood_group public.blood_group, city text, urgency public.urgency_level, units int, status public.request_status,
               hours_to_review numeric, hours_to_first_accept numeric, hours_approval_to_fulfilled numeric, accepted_offers bigint, is_demo boolean)
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); t0 timestamptz := p_from::timestamp at time zone 'UTC'; t1 timestamptz := (p_to + 1)::timestamp at time zone 'UTC';
        c text := nullif(lower(btrim(coalesce(p_city, ''))), '');
begin
  if p_scope_kind = 'admin' then
    if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  elsif p_scope_kind = 'mine' then
    if public.current_app_role() is distinct from 'requester' then raise exception 'Requesters only' using errcode = '42501'; end if;
  else raise exception 'Invalid report'; end if;
  perform public.analytics_check(p_from, p_to, c, p_data_scope);
  if p_limit not between 1 and 10000 or p_offset < 0 then raise exception 'Invalid page'; end if;
  return query
    select count(*) over (), x.id, (x.created_at at time zone 'UTC')::date, x.blood_group, x.city, x.urgency, x.units, x.status,
           round((extract(epoch from x.reviewed_at - x.created_at) / 3600)::numeric, 2), round((extract(epoch from x.first_accept_at - x.approved_at) / 3600)::numeric, 2),
           round((extract(epoch from x.fulfilled_at - x.approved_at) / 3600)::numeric, 2), x.accepted_offers, x.is_demo
    from public.analytics_request_facts x
    where x.created_at >= t0 and x.created_at < t1 and (c is null or lower(x.city) = c) and (p_group is null or x.blood_group = p_group)
      and (p_scope_kind = 'admin' or x.requester_id = uid) and (p_data_scope = 'all' or (p_data_scope = 'demo') = x.is_demo)
    order by x.id desc limit p_limit offset p_offset;
end $$;

create function public.report_offers_mine(p_from date, p_to date, p_city text default null, p_group public.blood_group default null, p_limit int default 25, p_offset int default 0)
returns table (total_rows bigint, offer_id bigint, request_id bigint, created_on date, blood_group public.blood_group, city text, urgency public.urgency_level, request_status public.request_status,
               origin text, offer_status public.offer_status, accepted_on date, withdrawn_on date, completed boolean)
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); t0 timestamptz := p_from::timestamp at time zone 'UTC'; t1 timestamptz := (p_to + 1)::timestamp at time zone 'UTC';
        c text := nullif(lower(btrim(coalesce(p_city, ''))), '');
begin
  if public.current_app_role() is distinct from 'donor' then raise exception 'Donors only' using errcode = '42501'; end if;
  perform public.analytics_check(p_from, p_to, c, 'all');
  if p_limit not between 1 and 10000 or p_offset < 0 then raise exception 'Invalid page'; end if;
  return query
    select count(*) over (), o.id, r.id, (o.created_at at time zone 'UTC')::date, r.blood_group, r.city, r.urgency, r.status, o.origin, o.status,
           (o.accepted_at at time zone 'UTC')::date, (o.withdrawn_at at time zone 'UTC')::date, (o.status = 'accepted' and r.status = 'fulfilled')
    from public.offers o join public.blood_requests r on r.id = o.request_id
    where o.donor_id = uid and o.created_at >= t0 and o.created_at < t1 and (c is null or lower(r.city) = c) and (p_group is null or r.blood_group = p_group)
    order by o.id desc limit p_limit offset p_offset;
end $$;

-- ---------- 8. audit of report access (reports never write business data; only this log row) ----------
insert into public.rate_limit_rules (action, max_hits, window_seconds, scope) values ('report.export', 30, 3600, 'user');
create function public.log_report_event(p_kind text, p_params jsonb default '{}') returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null or public.current_app_role() is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if p_kind not in ('admin.summary', 'admin.trend', 'admin.supply_demand', 'admin.requests', 'donor.offers', 'requester.requests') then raise exception 'Invalid report'; end if;
  if left(p_kind, 5) = 'admin' and not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  perform public.rate_limit_check('report.export');
  insert into public.audit_logs (actor_id, action, entity, entity_id, detail)
  values (uid, 'report.export', 'report', p_kind,
          jsonb_build_object('from', p_params->>'from', 'to', p_params->>'to', 'city', p_params->>'city', 'group', p_params->>'group', 'scope', p_params->>'scope', 'rows', p_params->>'rows'));
end $$;

-- ---------- 9. grants: nothing reachable by anon; helpers and the view stay internal ----------
revoke all on function public.analytics_admin(date, date, text, public.blood_group, text, int), public.analytics_donor(date, date, text, public.blood_group),
  public.analytics_requester(date, date, text, public.blood_group),
  public.report_requests(text, date, date, text, public.blood_group, text, int, int), public.report_offers_mine(date, date, text, public.blood_group, int, int),
  public.log_report_event(text, jsonb), public.analytics_rate(bigint, bigint), public.analytics_stats(double precision[]), public.analytics_bucket(date, date),
  public.analytics_check(date, date, text, text, int), public.t_offer_times(), public.t_profile_demo() from public, anon, authenticated;
grant execute on function public.analytics_admin(date, date, text, public.blood_group, text, int), public.analytics_donor(date, date, text, public.blood_group),
  public.analytics_requester(date, date, text, public.blood_group),
  public.report_requests(text, date, date, text, public.blood_group, text, int, int), public.report_offers_mine(date, date, text, public.blood_group, int, int),
  public.log_report_event(text, jsonb) to authenticated;
