-- Row-Level Security + least-privilege grants. Supabase grants ALL on new tables to anon/authenticated by
-- default; revoke it all, then grant back only what each role needs.

alter table public.profiles         enable row level security;
alter table public.donor_profiles   enable row level security;
alter table public.blood_requests   enable row level security;
alter table public.request_events   enable row level security;
alter table public.offers           enable row level security;
alter table public.contact_consents enable row level security;
alter table public.notifications    enable row level security;
alter table public.audit_logs       enable row level security;
alter table public.blood_compat     enable row level security;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

-- Role helpers (security definer => no RLS recursion). The role comes ONLY from public.profiles,
-- which users cannot write (column grants below), never from JWT/user metadata.
create function public.current_app_role() returns public.app_role
  language sql stable security definer set search_path = '' as
$$ select role from public.profiles where id = (select auth.uid()) $$;
create function public.is_admin() returns boolean
  language sql stable security definer set search_path = '' as
$$ select coalesce((select role = 'admin' from public.profiles where id = (select auth.uid())), false) $$;
revoke all on function public.current_app_role(), public.is_admin() from public, anon;
grant execute on function public.current_app_role(), public.is_admin() to authenticated;

-- ---- grants (authenticated only; anon gets nothing) ----
grant usage on schema public to authenticated;
grant select on public.profiles, public.donor_profiles, public.blood_requests, public.request_events,
                public.offers, public.contact_consents, public.notifications, public.audit_logs, public.blood_compat to authenticated;
grant update (full_name, city, phone)                       on public.profiles       to authenticated;  -- NOT role
grant update (blood_group, available, last_donation_date)   on public.donor_profiles to authenticated;  -- NOT eligibility_*
grant insert (requester_id, patient_label, blood_group, units, city, hospital, urgency, needed_by, note)
                                                            on public.blood_requests to authenticated;
grant update (status)                                       on public.blood_requests to authenticated;
grant update (is_read)                                      on public.notifications to authenticated;

-- ---- policies ----
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_admin());
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy donors_select on public.donor_profiles for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());
create policy donors_update on public.donor_profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy requests_select on public.blood_requests for select to authenticated
  using (requester_id = (select auth.uid()) or public.is_admin());
create policy requests_insert on public.blood_requests for insert to authenticated
  with check (requester_id = (select auth.uid()) and status = 'open' and public.current_app_role() = 'requester');
create policy requests_update on public.blood_requests for update to authenticated
  using (requester_id = (select auth.uid()) and status in ('open', 'matched'))
  with check (requester_id = (select auth.uid()) and status in ('fulfilled', 'cancelled'));

create policy events_select on public.request_events for select to authenticated
  using (exists (select 1 from public.blood_requests r where r.id = request_id
                 and (r.requester_id = (select auth.uid()) or public.is_admin())));

create policy offers_select on public.offers for select to authenticated
  using (donor_id = (select auth.uid()) or public.is_admin()
         or exists (select 1 from public.blood_requests r where r.id = request_id and r.requester_id = (select auth.uid())));

-- Only the donor (owner of the offer) or an admin may even see consent flags; requesters get contacts only via consented_contacts().
create policy consents_select on public.contact_consents for select to authenticated
  using (public.is_admin() or exists (select 1 from public.offers o where o.id = offer_id and o.donor_id = (select auth.uid())));

create policy notifications_select on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy audit_select on public.audit_logs for select to authenticated using (public.is_admin());
create policy compat_select on public.blood_compat for select to authenticated using (true);
