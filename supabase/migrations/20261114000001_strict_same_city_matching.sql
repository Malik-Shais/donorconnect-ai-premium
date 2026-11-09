-- Strict same-city matching (forward-only; earlier migrations are untouched).
-- Defect: matching_donors() only RANKED same-city donors, so invite_donors() filled its 20 slots with donors from any city, open_requests_for_donor()
-- listed other cities' requests and accept_request() (also reached by respond_to_invitation()) never compared cities.
-- Rule now enforced in the database, so direct RPC calls cannot bypass it: a donor can be invited to, see, or accept a request only when
-- their profile city equals the request city (case- and extra-whitespace-insensitive; an empty city never matches).

create function public.city_key(p text) returns text language sql immutable set search_path = '' as $$
  select lower(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'))
$$;
revoke all on function public.city_key(text) from public, anon, authenticated;

-- Same signature and output columns (same_city is now always true for returned rows; kept so callers and the review_request notification loop keep working).
create or replace function public.matching_donors(p_group public.blood_group, p_city text)
returns table (user_id uuid, same_city boolean, notify boolean)
language sql stable security definer set search_path = '' as $$
  select d.user_id, true, d.notify_new_requests
  from public.donor_profiles d
  join public.profiles p on p.id = d.user_id
  join public.blood_compat c on c.donor_group = d.blood_group and c.recipient_group = p_group
  where p.role = 'donor' and not p.suspended and d.available and d.eligibility_status <> 'deferred'
    and public.city_key(p_city) <> '' and public.city_key(p.city) = public.city_key(p_city)
$$;

-- invite_donors() (rate-limited wrapper) calls this; the body is unchanged except it relies on the strict matching_donors() and records the city in the audit row.
create or replace function public.invite_donors_impl(p_id bigint) returns int language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); r public.blood_requests; n int := 0; rec record;
begin
  if public.current_app_role() is distinct from 'requester' then raise exception 'Only requesters can invite donors' using errcode = '42501'; end if;
  select * into r from public.blood_requests where id = p_id and requester_id = uid for update;
  if not found then raise exception 'Request not found'; end if;
  if r.status not in ('approved', 'matched') then raise exception 'Donors can only be invited once the request is approved'; end if;
  for rec in
    with picks as (
      select m.user_id from public.matching_donors(r.blood_group, r.city) m
      where m.notify and not exists (select 1 from public.offers o where o.request_id = p_id and o.donor_id = m.user_id)
      order by m.user_id limit 20),
    ins as (
      insert into public.offers (request_id, donor_id, origin, status) select p_id, user_id, 'invited', 'invited' from picks
      on conflict (request_id, donor_id) do nothing returning id, donor_id)
    select id, donor_id from ins
  loop
    n := n + 1;
    perform public.push_notification(rec.donor_id, 'You were invited to help with a ' || r.blood_group || ' request at ' || r.hospital, '/dashboard/donor/offers', 'invite:' || rec.id);
  end loop;
  insert into public.audit_logs (actor_id, action, entity, entity_id, detail) values (uid, 'request.invite', 'blood_requests', p_id::text, jsonb_build_object('invited', n, 'city', r.city));
  return n;
end $$;

-- A donor sees only requests in their own city (and compatible, approved/matched).
create or replace function public.open_requests_for_donor()
returns table (id bigint, blood_group public.blood_group, units int, city text, hospital text, urgency public.urgency_level, needed_by date,
               status public.request_status, created_at timestamptz, city_match boolean, offer_id bigint, offer_status public.offer_status)
language sql stable security definer set search_path = '' as $$
  select r.id, r.blood_group, r.units, r.city, r.hospital, r.urgency, r.needed_by, r.status, r.created_at, true, o.id, o.status
  from public.profiles p
  join public.donor_profiles d on d.user_id = p.id
  join public.blood_requests r on r.status in ('approved', 'matched') and public.city_key(r.city) = public.city_key(p.city)
  join public.blood_compat c on c.donor_group = d.blood_group and c.recipient_group = r.blood_group
  left join public.offers o on o.request_id = r.id and o.donor_id = p.id
  where p.id = (select auth.uid()) and p.role = 'donor' and not p.suspended and d.available and d.eligibility_status <> 'deferred' and public.city_key(p.city) <> ''
  order by case r.urgency when 'critical' then 0 when 'urgent' then 1 else 2 end, r.needed_by nulls last, r.created_at desc
  limit 100
$$;

-- accept_request(): identical to the previous definition plus the city check. respond_to_invitation('accept') delegates here, so both paths are covered.
-- An already-accepted offer still returns idempotently; declining a legacy out-of-city invitation stays possible.
create or replace function public.accept_request(p_request_id bigint, p_share_contact boolean default false)
returns bigint language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); d public.donor_profiles; r public.blood_requests; o public.offers; dcity text;
begin
  if uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if public.current_app_role() is distinct from 'donor' then raise exception 'Only donors can respond to requests' using errcode = '42501'; end if;
  select * into d from public.donor_profiles where user_id = uid;
  if not d.available or d.eligibility_status = 'deferred' then raise exception 'You are not currently available to donate'; end if;
  select * into r from public.blood_requests where id = p_request_id for update;
  if not found or r.status not in ('approved', 'matched') then raise exception 'This request is not open to donors'; end if;
  if not exists (select 1 from public.blood_compat where donor_group = d.blood_group and recipient_group = r.blood_group) then
    raise exception 'Your blood group is not preliminarily compatible with this request';
  end if;
  select * into o from public.offers where request_id = r.id and donor_id = uid;
  if found and o.status = 'accepted' then return o.id; end if;  -- already accepted: no duplicate offer, no repeat notification
  select city into dcity from public.profiles where id = uid;
  if public.city_key(dcity) = '' or public.city_key(dcity) <> public.city_key(r.city) then
    raise exception 'This request is outside your city. You can only respond to requests in your own city.';
  end if;

  insert into public.offers (request_id, donor_id, origin, status) values (r.id, uid, 'volunteered', 'accepted')
  on conflict (request_id, donor_id) do update set status = 'accepted' returning * into o;
  insert into public.contact_consents (offer_id, granted, granted_at) values (o.id, p_share_contact, case when p_share_contact then now() end)
  on conflict (offer_id) do update set granted = excluded.granted, granted_at = excluded.granted_at, revoked_at = null;

  if r.status = 'approved' then
    perform set_config('app.transition_note', 'A donor accepted', true);
    update public.blood_requests set status = 'matched' where id = r.id;
  end if;
  perform public.push_notification(r.requester_id, 'A donor accepted your ' || r.blood_group || ' request' || case when p_share_contact then ' and shared contact details.' else '.' end,
    '/dashboard/requester/requests/' || r.id, 'offer:' || o.id || ':accepted');
  insert into public.audit_logs (actor_id, action, entity, entity_id, detail)
  values (uid, 'offer.accept', 'offers', o.id::text, jsonb_build_object('request_id', r.id, 'contact_consent', p_share_contact));
  return o.id;
end $$;
-- create or replace keeps the existing owner and grants (execute for authenticated only), so no grant changes are needed here.
