-- Stage 3: review workflow, transitions enforced in the database, suspension, eligibility provenance, notification dedupe.

-- ---------- columns ----------
alter table public.blood_requests alter column status set default 'pending_review';
alter table public.blood_requests
  add column reviewed_by uuid references public.profiles (id),
  add column reviewed_at timestamptz,
  add column review_note text check (review_note is null or char_length(review_note) <= 500),
  add column verification_method text check (verification_method in ('hospital_call', 'hospital_document', 'known_requester', 'other'));

alter table public.profiles
  add column suspended boolean not null default false,
  add column suspended_reason text check (suspended_reason is null or char_length(suspended_reason) <= 300);

-- Eligibility is recorded from an authorised blood service's decision; keep who/when/source for accountability.
alter table public.donor_profiles
  add column notify_new_requests boolean not null default true,
  add column eligibility_source text check (eligibility_source is null or char_length(eligibility_source) <= 120),
  add column eligibility_recorded_by uuid references public.profiles (id),
  add column eligibility_recorded_at timestamptz;

-- One notification per (user, event): retries and races cannot spam anyone.
alter table public.notifications add column dedupe_key text;
create unique index notifications_dedupe on public.notifications (user_id, dedupe_key) where dedupe_key is not null;

-- ---------- allowed request transitions (the single source of truth; enforced by trigger) ----------
create table public.request_transitions (
  from_status public.request_status not null,
  to_status   public.request_status not null,
  actor       text not null check (actor in ('requester', 'admin', 'system')),
  primary key (from_status, to_status, actor)
);
insert into public.request_transitions values
  ('pending_review', 'approved',  'admin'),
  ('pending_review', 'rejected',  'admin'),
  ('pending_review', 'cancelled', 'requester'),
  ('pending_review', 'cancelled', 'admin'),
  ('approved',       'matched',   'system'),
  ('approved',       'cancelled', 'requester'),
  ('approved',       'cancelled', 'admin'),
  ('matched',        'approved',  'system'),   -- every accepted donor withdrew
  ('matched',        'fulfilled', 'requester'),
  ('matched',        'cancelled', 'requester'),
  ('matched',        'cancelled', 'admin');
alter table public.request_transitions enable row level security;
revoke all on public.request_transitions from anon, authenticated;
grant select on public.request_transitions to authenticated;
create policy transitions_select on public.request_transitions for select to authenticated using (true);

-- Defence in depth: whoever tries (even service role, even a future bug), an invalid status jump is rejected.
create function public.enforce_request_transition() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status and not exists (
    select 1 from public.request_transitions t where t.from_status = old.status and t.to_status = new.status) then
    raise exception 'Invalid status change: % to %', old.status, new.status using errcode = '23514';
  end if;
  return new;
end $$;
create trigger t_request_transition before update of status on public.blood_requests
  for each row execute function public.enforce_request_transition();

-- ---------- roles: a suspended account loses every privileged capability ----------
create or replace function public.current_app_role() returns public.app_role
  language sql stable security definer set search_path = '' as
$$ select role from public.profiles where id = (select auth.uid()) and not suspended $$;
create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = '' as
$$ select coalesce((select role = 'admin' from public.profiles where id = (select auth.uid()) and not suspended), false) $$;

-- ---------- policies ----------
-- Requests are created unreviewed and can no longer be changed directly: status moves only through audited functions.
drop policy requests_insert on public.blood_requests;
drop policy requests_update on public.blood_requests;
revoke update on public.blood_requests from authenticated;
create policy requests_insert on public.blood_requests for insert to authenticated
  with check (requester_id = (select auth.uid()) and status = 'pending_review' and public.current_app_role() = 'requester');

-- Requesters no longer read raw offer rows (donor ids); they use owner_request_offers().
drop policy offers_select on public.offers;
create policy offers_select on public.offers for select to authenticated
  using (donor_id = (select auth.uid()) or public.is_admin());

-- Donors may manage their notification preference (not eligibility fields).
grant update (blood_group, available, last_donation_date, notify_new_requests) on public.donor_profiles to authenticated;

-- ---------- history + audit trigger (replaces stage 2 version; carries the optional transition note) ----------
create or replace function public.log_request_change() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.request_events (request_id, status, actor_id, note) values (new.id, new.status, (select auth.uid()), 'Request submitted for review');
    insert into public.audit_logs (actor_id, action, entity, entity_id, detail)
    values ((select auth.uid()), 'request.submit', 'blood_requests', new.id::text, jsonb_build_object('status', new.status));
    -- tell every active administrator (deduplicated)
    insert into public.notifications (user_id, message, link, dedupe_key)
    select p.id, 'A new blood request is waiting for review', '/dashboard/admin/review', 'review:' || new.id
    from public.profiles p where p.role = 'admin' and not p.suspended
    on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  elsif new.status is distinct from old.status then
    insert into public.request_events (request_id, status, actor_id, note)
    values (new.id, new.status, (select auth.uid()), nullif(current_setting('app.transition_note', true), ''));
    insert into public.audit_logs (actor_id, action, entity, entity_id, detail)
    values ((select auth.uid()), 'request.transition', 'blood_requests', new.id::text, jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return new;
end $$;

-- Internal helper (not callable by users): at most one notification per (user, dedupe key).
create function public.push_notification(p_user uuid, p_message text, p_link text, p_key text) returns void
  language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, message, link, dedupe_key) values (p_user, p_message, p_link, p_key)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing
$$;

-- Internal helper: donors who are preliminarily compatible, available, not deferred and not suspended.
create function public.matching_donors(p_group public.blood_group, p_city text)
returns table (user_id uuid, same_city boolean, notify boolean)
language sql stable security definer set search_path = '' as $$
  select d.user_id, lower(p.city) = lower(p_city), d.notify_new_requests
  from public.donor_profiles d
  join public.profiles p on p.id = d.user_id
  join public.blood_compat c on c.donor_group = d.blood_group and c.recipient_group = p_group
  where p.role = 'donor' and not p.suspended and d.available and d.eligibility_status <> 'deferred'
$$;
revoke all on function public.push_notification(uuid, text, text, text), public.matching_donors(public.blood_group, text) from public, anon, authenticated;
