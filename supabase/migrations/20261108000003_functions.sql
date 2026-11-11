-- Privileged operations as narrow SECURITY DEFINER functions. Each re-checks the caller; all pin search_path.

create function public.open_requests_for_donor()
returns table (id bigint, blood_group public.blood_group, units int, city text, hospital text, urgency public.urgency_level,
               needed_by date, status public.request_status, created_at timestamptz, city_match boolean, responded boolean)
language sql stable security definer set search_path = '' as $$
  select r.id, r.blood_group, r.units, r.city, r.hospital, r.urgency, r.needed_by, r.status, r.created_at,
         lower(r.city) = lower(p.city),
         exists (select 1 from public.offers o where o.request_id = r.id and o.donor_id = p.id and o.status = 'accepted')
  from public.profiles p
  join public.donor_profiles d on d.user_id = p.id
  join public.blood_requests r on r.status in ('open', 'matched')
  join public.blood_compat c on c.donor_group = d.blood_group and c.recipient_group = r.blood_group
  where p.id = (select auth.uid()) and p.role = 'donor' and d.available and d.eligibility_status <> 'deferred'
  order by lower(r.city) = lower(p.city) desc,
           case r.urgency when 'critical' then 0 when 'urgent' then 1 else 2 end, r.created_at desc
  limit 50
$$;

create function public.accept_request(p_request_id bigint, p_share_contact boolean default false)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  d public.donor_profiles; r public.blood_requests; oid bigint;
begin
  if uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if public.current_app_role() is distinct from 'donor' then raise exception 'Only donors can respond to requests' using errcode = '42501'; end if;
  select * into d from public.donor_profiles where user_id = uid;
  if not d.available or d.eligibility_status = 'deferred' then raise exception 'You are not currently available to donate'; end if;
  select * into r from public.blood_requests where id = p_request_id for update;
  if not found or r.status not in ('open', 'matched') then raise exception 'This request is no longer open'; end if;
  if not exists (select 1 from public.blood_compat where donor_group = d.blood_group and recipient_group = r.blood_group) then
    raise exception 'Your blood group is not preliminarily compatible with this request';
  end if;

  insert into public.offers (request_id, donor_id, origin, status) values (r.id, uid, 'volunteered', 'accepted')
  on conflict (request_id, donor_id) do update set status = 'accepted' returning id into oid;
  insert into public.contact_consents (offer_id, granted, granted_at) values (oid, p_share_contact, case when p_share_contact then now() end)
  on conflict (offer_id) do update set granted = excluded.granted, granted_at = excluded.granted_at, revoked_at = null;

  if r.status = 'open' then update public.blood_requests set status = 'matched' where id = r.id; end if;
  insert into public.notifications (user_id, message, link) values
    (r.requester_id, 'A donor accepted your ' || r.blood_group || ' request' || case when p_share_contact then ' and shared contact details.' else '.' end, '/dashboard/requester');
  insert into public.audit_logs (actor_id, action, entity, entity_id, detail)
  values (uid, 'offer.accept', 'offers', oid::text, jsonb_build_object('request_id', r.id, 'contact_consent', p_share_contact));
  return oid;
end $$;

create function public.set_contact_consent(p_offer_id bigint, p_granted boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if not exists (select 1 from public.offers where id = p_offer_id and donor_id = uid) then
    raise exception 'Offer not found' using errcode = '42501';
  end if;
  update public.contact_consents
     set granted = p_granted,
         granted_at = case when p_granted then now() else granted_at end,
         revoked_at = case when p_granted then null else now() end
   where offer_id = p_offer_id;
  insert into public.audit_logs (actor_id, action, entity, entity_id, detail)
  values (uid, case when p_granted then 'consent.grant' else 'consent.revoke' end, 'contact_consents', p_offer_id::text, null);
end $$;

-- Contact details are released only to the OWNER of the request, only for accepted offers with live consent.
create function public.consented_contacts(p_request_id bigint)
returns table (offer_id bigint, donor_name text, blood_group public.blood_group, phone text, email text)
language sql stable security definer set search_path = '' as $$
  select o.id, p.full_name, d.blood_group, p.phone, u.email::text
  from public.blood_requests r
  join public.offers o on o.request_id = r.id and o.status = 'accepted'
  join public.contact_consents c on c.offer_id = o.id and c.granted
  join public.profiles p on p.id = o.donor_id
  join public.donor_profiles d on d.user_id = o.donor_id
  join auth.users u on u.id = o.donor_id
  where r.id = p_request_id and r.requester_id = (select auth.uid())
$$;

-- Eligibility is a healthcare decision: recorded by an admin on behalf of the blood service, audited, never self-service.
create function public.set_donor_eligibility(p_user uuid, p_status public.eligibility, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  update public.donor_profiles set eligibility_status = p_status, eligibility_note = left(p_note, 300) where user_id = p_user;
  if not found then raise exception 'Donor not found'; end if;
  insert into public.audit_logs (actor_id, action, entity, entity_id, detail)
  values ((select auth.uid()), 'eligibility.set', 'donor_profiles', p_user::text, jsonb_build_object('status', p_status));
  insert into public.notifications (user_id, message) values (p_user, 'Your donor eligibility status was updated by the blood service team.');
end $$;

revoke all on function public.open_requests_for_donor(), public.accept_request(bigint, boolean), public.set_contact_consent(bigint, boolean),
  public.consented_contacts(bigint), public.set_donor_eligibility(uuid, public.eligibility, text) from public, anon;
grant execute on function public.open_requests_for_donor(), public.accept_request(bigint, boolean), public.set_contact_consent(bigint, boolean),
  public.consented_contacts(bigint), public.set_donor_eligibility(uuid, public.eligibility, text) to authenticated;
