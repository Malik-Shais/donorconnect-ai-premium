-- Stage 3 privileged operations. All SECURITY DEFINER with pinned search_path; each re-checks the caller.
-- Business-rule errors use the default SQLSTATE P0001 (message is user-safe); authorisation errors use 42501.
-- Request rows are locked (FOR UPDATE) before any state change so concurrent actions serialise.

drop function public.open_requests_for_donor();
drop function public.accept_request(bigint, boolean);
drop function public.consented_contacts(bigint);
drop function public.set_donor_eligibility(uuid, public.eligibility, text);
drop function public.set_contact_consent(bigint, boolean);

-- ---------- requester / admin: cancel, fulfil, moderate ----------
create function public.transition_request(p_id bigint, p_to public.request_status, p_note text default null)
returns public.request_status language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid()); me public.app_role := public.current_app_role();
  r public.blood_requests; v_actor text; v_note text := nullif(btrim(coalesce(p_note, '')), ''); o record;
begin
  if me is null then raise exception 'Not authorised' using errcode = '42501'; end if;
  if p_to not in ('cancelled', 'fulfilled') then raise exception 'Requests are approved or rejected through the review action'; end if;
  select * into r from public.blood_requests where id = p_id for update;
  if not found or (me <> 'admin' and r.requester_id <> uid) then raise exception 'Request not found'; end if;
  v_actor := case when me = 'admin' then 'admin' else 'requester' end;
  if not exists (select 1 from public.request_transitions t where t.from_status = r.status and t.to_status = p_to and t.actor = v_actor) then
    raise exception 'That change is not allowed while the request is %', replace(r.status::text, '_', ' ');
  end if;
  if v_actor = 'admin' and (v_note is null or char_length(v_note) < 5) then raise exception 'A moderation note (at least 5 characters) is required'; end if;

  perform set_config('app.transition_note', coalesce(left(v_note, 300), ''), true);
  update public.blood_requests set status = p_to where id = p_id;

  if v_actor = 'admin' then
    perform public.push_notification(r.requester_id, 'An administrator cancelled your request: ' || left(v_note, 200), '/dashboard/requester/requests/' || p_id, 'req:' || p_id || ':moderated');
    insert into public.audit_logs (actor_id, action, entity, entity_id, detail) values (uid, 'request.moderate', 'blood_requests', p_id::text, jsonb_build_object('to', p_to));
  end if;
  for o in select donor_id from public.offers where request_id = p_id and status in ('accepted', 'invited') loop
    perform public.push_notification(o.donor_id, 'A request you were involved with is now ' || p_to, '/dashboard/donor/offers', 'req:' || p_id || ':closed');
  end loop;
  return p_to;
end $$;

-- ---------- admin: verification + decision ----------
create function public.review_request(p_id bigint, p_decision text, p_note text default null, p_method text default null)
returns public.request_status language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid()); r public.blood_requests; v_note text := nullif(btrim(coalesce(p_note, '')), ''); to_status public.request_status; m record;
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  if p_decision not in ('approve', 'reject') then raise exception 'Invalid decision'; end if;
  select * into r from public.blood_requests where id = p_id for update;
  if not found then raise exception 'Request not found'; end if;
  if r.status <> 'pending_review' then raise exception 'This request has already been reviewed'; end if;
  if p_decision = 'approve' and p_method is null then raise exception 'Choose how the request was verified'; end if;
  if p_decision = 'reject' and (v_note is null or char_length(v_note) < 5) then raise exception 'A reason (at least 5 characters) is required to reject a request'; end if;
  to_status := case p_decision when 'approve' then 'approved' else 'rejected' end;

  update public.blood_requests set reviewed_by = uid, reviewed_at = now(), review_note = left(v_note, 500), verification_method = p_method where id = p_id;
  perform set_config('app.transition_note', coalesce(left(v_note, 300), ''), true);
  update public.blood_requests set status = to_status where id = p_id;

  perform public.push_notification(r.requester_id,
    case p_decision when 'approve' then 'Your request was approved and matching donors have been notified.' else 'Your request was not approved: ' || left(v_note, 200) end,
    '/dashboard/requester/requests/' || p_id, 'req:' || p_id || ':reviewed');
  if p_decision = 'approve' then  -- donors are notified ONLY after approval, only same-city compatible donors who opted in
    for m in select user_id from public.matching_donors(r.blood_group, r.city) where same_city and notify limit 50 loop
      perform public.push_notification(m.user_id, upper(left(r.urgency::text, 1)) || substr(r.urgency::text, 2) || ' ' || r.blood_group || ' request in ' || r.city,
        '/dashboard/donor/opportunities', 'req:' || p_id || ':approved');
    end loop;
  end if;
  insert into public.audit_logs (actor_id, action, entity, entity_id, detail)
  values (uid, 'request.review', 'blood_requests', p_id::text, jsonb_build_object('decision', p_decision, 'method', p_method));
  return to_status;
end $$;

-- ---------- requester: invite preliminary matches WITHOUT learning who they are ----------
create function public.invite_donors(p_id bigint) returns int language plpgsql security definer set search_path = '' as $$
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
      order by m.same_city desc, m.user_id limit 20),
    ins as (
      insert into public.offers (request_id, donor_id, origin, status) select p_id, user_id, 'invited', 'invited' from picks
      on conflict (request_id, donor_id) do nothing returning id, donor_id)
    select id, donor_id from ins
  loop
    n := n + 1;
    perform public.push_notification(rec.donor_id, 'You were invited to help with a ' || r.blood_group || ' request at ' || r.hospital, '/dashboard/donor/offers', 'invite:' || rec.id);
  end loop;
  insert into public.audit_logs (actor_id, action, entity, entity_id, detail) values (uid, 'request.invite', 'blood_requests', p_id::text, jsonb_build_object('invited', n));
  return n;
end $$;

-- ---------- donor: accept (idempotent), decline, withdraw, consent ----------
create function public.accept_request(p_request_id bigint, p_share_contact boolean default false)
returns bigint language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); d public.donor_profiles; r public.blood_requests; o public.offers;
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

create function public.respond_to_invitation(p_offer_id bigint, p_action text, p_share_contact boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); o public.offers; n int;
begin
  if public.current_app_role() is distinct from 'donor' then raise exception 'Only donors can respond to invitations' using errcode = '42501'; end if;
  select * into o from public.offers where id = p_offer_id and donor_id = uid;
  if not found then raise exception 'Invitation not found'; end if;
  if o.status <> 'invited' then raise exception 'You have already responded to this invitation'; end if;
  if p_action = 'accept' then
    perform public.accept_request(o.request_id, p_share_contact);
  elsif p_action = 'decline' then
    update public.offers set status = 'declined' where id = p_offer_id and status = 'invited';
    get diagnostics n = row_count;
    if n = 1 then
      insert into public.audit_logs (actor_id, action, entity, entity_id, detail) values (uid, 'offer.decline', 'offers', p_offer_id::text, null);
    end if;
  else
    raise exception 'Invalid action';
  end if;
end $$;

create function public.withdraw_offer(p_offer_id bigint) returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); o public.offers; r public.blood_requests; n int;
begin
  select * into o from public.offers where id = p_offer_id and donor_id = uid;
  if not found then raise exception 'Offer not found'; end if;
  select * into r from public.blood_requests where id = o.request_id for update;
  update public.offers set status = 'withdrawn' where id = p_offer_id and status = 'accepted';
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Only an accepted offer can be withdrawn'; end if;
  update public.contact_consents set granted = false, revoked_at = now() where offer_id = p_offer_id;  -- withdrawing also withdraws consent
  if r.status = 'matched' and not exists (select 1 from public.offers where request_id = r.id and status = 'accepted') then
    perform set_config('app.transition_note', 'All donors withdrew; request is open to donors again', true);
    update public.blood_requests set status = 'approved' where id = r.id;
  end if;
  perform public.push_notification(r.requester_id, 'A donor withdrew their offer for your ' || r.blood_group || ' request.', '/dashboard/requester/requests/' || r.id, 'offer:' || p_offer_id || ':withdrawn');
  insert into public.audit_logs (actor_id, action, entity, entity_id, detail) values (uid, 'offer.withdraw', 'offers', p_offer_id::text, jsonb_build_object('request_id', r.id));
end $$;

create function public.set_contact_consent(p_offer_id bigint, p_granted boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); o public.offers; r public.blood_requests;
begin
  select * into o from public.offers where id = p_offer_id and donor_id = uid;
  if not found then raise exception 'Offer not found' using errcode = '42501'; end if;
  select * into r from public.blood_requests where id = o.request_id;
  if p_granted and (o.status <> 'accepted' or r.status not in ('approved', 'matched')) then
    raise exception 'Contact details can only be shared for an active, accepted offer';
  end if;
  update public.contact_consents
     set granted = p_granted, granted_at = case when p_granted then now() else granted_at end, revoked_at = case when p_granted then null else now() end
   where offer_id = p_offer_id;
  insert into public.audit_logs (actor_id, action, entity, entity_id, detail)
  values (uid, case when p_granted then 'consent.grant' else 'consent.revoke' end, 'contact_consents', p_offer_id::text, null);
end $$;

-- ---------- requester: offers on MY request. Identity + contact only with live consent, only while the request is active ----------
create function public.owner_request_offers(p_request_id bigint)
returns table (offer_id bigint, origin text, status public.offer_status, blood_group public.blood_group, donor_city text,
               contact_shared boolean, donor_name text, phone text, email text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare uid uuid := (select auth.uid()); me public.app_role := public.current_app_role(); r public.blood_requests; can_see boolean; n int;
begin
  select * into r from public.blood_requests where id = p_request_id;
  if me is null or not found or (me <> 'admin' and r.requester_id <> uid) then raise exception 'Request not found'; end if;
  can_see := me = 'requester' and r.requester_id = uid and r.status in ('approved', 'matched');  -- admins never see contact details
  return query
    select s.id, s.origin, s.status, s.dbg, s.city, s.shared,
           case when s.shared then s.name end, case when s.shared then s.phone end, case when s.shared then s.email end
    from (select o.id, o.origin, o.status, d.blood_group as dbg, p.city, p.full_name as name, p.phone, u.email::text as email,
                 (can_see and o.status = 'accepted' and coalesce(c.granted, false)) as shared, o.created_at
          from public.offers o
          join public.profiles p on p.id = o.donor_id
          join public.donor_profiles d on d.user_id = o.donor_id
          join auth.users u on u.id = o.donor_id
          left join public.contact_consents c on c.offer_id = o.id
          where o.request_id = p_request_id) s
    order by s.created_at;
  if can_see then  -- audit the disclosure (never its content); at most once per 10 minutes per request and viewer
    select count(*) into n from public.offers o join public.contact_consents c on c.offer_id = o.id where o.request_id = p_request_id and o.status = 'accepted' and c.granted;
    if n > 0 and not exists (select 1 from public.audit_logs a where a.action = 'contact.disclosed' and a.entity_id = p_request_id::text and a.actor_id = uid and a.created_at > now() - interval '10 minutes') then
      insert into public.audit_logs (actor_id, action, entity, entity_id, detail) values (uid, 'contact.disclosed', 'blood_requests', p_request_id::text, jsonb_build_object('contacts', n));
    end if;
  end if;
end $$;

-- ---------- donor views (never expose patient label or requester identity) ----------
create function public.my_offers()
returns table (offer_id bigint, request_id bigint, origin text, status public.offer_status, consent_granted boolean, created_at timestamptz,
               blood_group public.blood_group, units int, city text, hospital text, urgency public.urgency_level, needed_by date, request_status public.request_status)
language sql stable security definer set search_path = '' as $$
  select o.id, r.id, o.origin, o.status, coalesce(c.granted, false), o.created_at, r.blood_group, r.units, r.city, r.hospital, r.urgency, r.needed_by, r.status
  from public.offers o
  join public.blood_requests r on r.id = o.request_id
  left join public.contact_consents c on c.offer_id = o.id
  where o.donor_id = (select auth.uid()) order by o.created_at desc
$$;

create function public.open_requests_for_donor()
returns table (id bigint, blood_group public.blood_group, units int, city text, hospital text, urgency public.urgency_level, needed_by date,
               status public.request_status, created_at timestamptz, city_match boolean, offer_id bigint, offer_status public.offer_status)
language sql stable security definer set search_path = '' as $$
  select r.id, r.blood_group, r.units, r.city, r.hospital, r.urgency, r.needed_by, r.status, r.created_at, lower(r.city) = lower(p.city), o.id, o.status
  from public.profiles p
  join public.donor_profiles d on d.user_id = p.id
  join public.blood_requests r on r.status in ('approved', 'matched')   -- unreviewed / rejected / closed requests are never visible
  join public.blood_compat c on c.donor_group = d.blood_group and c.recipient_group = r.blood_group
  left join public.offers o on o.request_id = r.id and o.donor_id = p.id
  where p.id = (select auth.uid()) and p.role = 'donor' and not p.suspended and d.available and d.eligibility_status <> 'deferred'
  order by lower(r.city) = lower(p.city) desc, case r.urgency when 'critical' then 0 when 'urgent' then 1 else 2 end, r.needed_by nulls last, r.created_at desc
  limit 100
$$;

-- ---------- admin: eligibility RECORDING (not deciding), suspension ----------
-- Eligibility is a healthcare decision made by an authorised blood service. This function only records that decision,
-- who recorded it and the stated source, so it is auditable. An app administrator cannot medically clear anyone.
create function public.set_donor_eligibility(p_user uuid, p_status public.eligibility, p_source text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  if p_source is null or char_length(btrim(p_source)) < 3 then raise exception 'Name the blood service (or reference) that made this decision'; end if;
  update public.donor_profiles set eligibility_status = p_status, eligibility_note = left(nullif(btrim(coalesce(p_note, '')), ''), 300),
         eligibility_source = left(btrim(p_source), 120), eligibility_recorded_by = uid, eligibility_recorded_at = now()
   where user_id = p_user;
  if not found then raise exception 'Donor not found'; end if;
  insert into public.audit_logs (actor_id, action, entity, entity_id, detail) values (uid, 'eligibility.record', 'donor_profiles', p_user::text, jsonb_build_object('status', p_status));
  insert into public.notifications (user_id, message, link) values (p_user, 'A blood service decision about your donor eligibility was recorded.', '/dashboard/donor/profile');
end $$;

create function public.set_user_suspended(p_user uuid, p_suspended boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); t public.profiles;
begin
  if not public.is_admin() then raise exception 'Administrators only' using errcode = '42501'; end if;
  select * into t from public.profiles where id = p_user;
  if not found then raise exception 'User not found'; end if;
  if p_user = uid or t.role = 'admin' then raise exception 'Administrator accounts cannot be suspended here'; end if;
  if p_suspended and char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'A reason (at least 5 characters) is required'; end if;
  update public.profiles set suspended = p_suspended, suspended_reason = case when p_suspended then left(btrim(p_reason), 300) end where id = p_user;
  insert into public.audit_logs (actor_id, action, entity, entity_id, detail)
  values (uid, case when p_suspended then 'user.suspend' else 'user.restore' end, 'profiles', p_user::text, null);
end $$;

-- ---------- grants ----------
revoke all on function public.transition_request(bigint, public.request_status, text), public.review_request(bigint, text, text, text), public.invite_donors(bigint),
  public.accept_request(bigint, boolean), public.respond_to_invitation(bigint, text, boolean), public.withdraw_offer(bigint), public.set_contact_consent(bigint, boolean),
  public.owner_request_offers(bigint), public.my_offers(), public.open_requests_for_donor(),
  public.set_donor_eligibility(uuid, public.eligibility, text, text), public.set_user_suspended(uuid, boolean, text) from public, anon;
grant execute on function public.transition_request(bigint, public.request_status, text), public.review_request(bigint, text, text, text), public.invite_donors(bigint),
  public.accept_request(bigint, boolean), public.respond_to_invitation(bigint, text, boolean), public.withdraw_offer(bigint), public.set_contact_consent(bigint, boolean),
  public.owner_request_offers(bigint), public.my_offers(), public.open_requests_for_donor(),
  public.set_donor_eligibility(uuid, public.eligibility, text, text), public.set_user_suspended(uuid, boolean, text) to authenticated;
