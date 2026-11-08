-- Stage 4: notification categories + preferences, realtime pings (ids only), private email outbox, persistent rate limits.

-- ================= notification categories =================
alter table public.notifications
  add column category text not null default 'account' check (category in ('request', 'offer', 'invitation', 'review', 'account'));
create index notifications_user_created on public.notifications (user_id, created_at desc);

create function public.categorize_notification() returns trigger language plpgsql set search_path = '' as $$
begin
  new.category := case
    when new.dedupe_key like 'invite:%' then 'invitation'
    when new.dedupe_key like 'offer:%'  then 'offer'
    when new.dedupe_key like 'req:%'    then 'request'
    when new.dedupe_key like 'review:%' then 'review'
    else 'account' end;
  return new;
end $$;
create trigger t_notification_category before insert on public.notifications for each row execute function public.categorize_notification();
update public.notifications set category = case
  when dedupe_key like 'invite:%' then 'invitation' when dedupe_key like 'offer:%' then 'offer'
  when dedupe_key like 'req:%' then 'request' when dedupe_key like 'review:%' then 'review' else 'account' end;

-- ================= preferences (in-app is always on; email is opt-in) =================
create table public.notification_preferences (
  user_id          uuid primary key references public.profiles (id) on delete cascade,
  email_enabled    boolean not null default false,
  email_categories text[] not null default array['request', 'offer', 'invitation'],
  updated_at       timestamptz not null default now(),
  check (email_categories <@ array['request', 'offer', 'invitation', 'review', 'account'])
);
alter table public.notification_preferences enable row level security;
revoke all on public.notification_preferences from anon, authenticated;
grant select on public.notification_preferences to authenticated;
grant insert (user_id, email_enabled, email_categories) on public.notification_preferences to authenticated;
grant update (email_enabled, email_categories) on public.notification_preferences to authenticated;
create policy prefs_select on public.notification_preferences for select to authenticated using (user_id = (select auth.uid()));
create policy prefs_insert on public.notification_preferences for insert to authenticated with check (user_id = (select auth.uid()));
create policy prefs_update on public.notification_preferences for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create trigger t_prefs_touch before update on public.notification_preferences for each row execute function public.touch_updated_at();

-- ================= realtime: PRIVATE per-user broadcast channel, ids only =================
-- A trigger broadcasts {notification_id} to the private topic "notif:<user_id>". RLS on realtime.messages lets a user JOIN
-- only their own topic; anonymous users and other users cannot subscribe at all, and clients cannot publish.
-- The payload carries no message text, identity, patient label or contact data: clients re-read notifications through normal RLS.
create function public.emit_notification_event() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(jsonb_build_object('notification_id', new.id), 'notification', 'notif:' || new.user_id::text, true);
  return new;
end $$;
create trigger t_notification_event after insert on public.notifications for each row execute function public.emit_notification_event();

-- Default deny. The only way to read realtime.messages is this policy, which requires BOTH:
--   (1) the topic the session is joined to is "notif:<uid>", where uid comes from the signature-verified JWT (never from the client), and
--   (2) the ROW being read belongs to that same topic (so a session can never read another topic's rows, whatever it claims).
create policy notif_topic_receive on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.messages.topic = (select realtime.topic())
    and (select realtime.topic()) = 'notif:' || (select auth.uid())::text
  );
-- There is deliberately NO insert/update/delete policy: with RLS enabled that is default-deny, so app roles can never write
-- (only the SECURITY DEFINER trigger via realtime.send publishes). Table grants belong to the Realtime service role; the dev stack
-- tightens them as supabase_admin (scripts/stack.mjs). RLS above is the authoritative control either way.

-- ================= optional email: private outbox (no app role can read or write it) =================
create table public.email_outbox (
  id              bigint generated always as identity primary key,
  notification_id bigint not null unique references public.notifications (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  category        text not null,
  status          text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts        int not null default 0,
  last_error      text,
  next_attempt_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);
create index on public.email_outbox (status, next_attempt_at);
alter table public.email_outbox enable row level security;
revoke all on public.email_outbox from anon, authenticated;

create function public.queue_notification_email() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.email_outbox (notification_id, user_id, category)
  select new.id, new.user_id, new.category from public.notification_preferences p
  where p.user_id = new.user_id and p.email_enabled and new.category = any (p.email_categories)
  on conflict (notification_id) do nothing;
  return new;
end $$;
create trigger t_notification_email after insert on public.notifications for each row execute function public.queue_notification_email();

-- ================= persistent, atomic rate limits =================
create table public.rate_limits (
  key          text not null,
  window_start timestamptz not null,
  hits         int not null default 0,
  primary key (key, window_start)
);
create table public.rate_limit_rules (
  action         text primary key,
  max_hits       int not null check (max_hits > 0),
  window_seconds int not null check (window_seconds > 0),
  scope          text not null check (scope in ('user', 'anon'))
);
alter table public.rate_limits enable row level security;
alter table public.rate_limit_rules enable row level security;
revoke all on public.rate_limits, public.rate_limit_rules from anon, authenticated;
insert into public.rate_limit_rules values
  ('request.create', 10, 3600, 'user'), ('offer.create', 100, 3600, 'user'), ('invite', 10, 3600, 'user'), ('review', 300, 3600, 'user'),
  ('contact.view', 60, 600, 'user'), ('consent.change', 30, 3600, 'user'), ('profile.update', 30, 3600, 'user'), ('ai.chat', 20, 3600, 'user'),
  ('auth.login', 10, 600, 'anon'), ('auth.login.global', 600, 60, 'anon'),
  ('auth.register', 5, 3600, 'anon'), ('auth.register.global', 300, 600, 'anon'),
  ('auth.forgot', 3, 3600, 'anon'), ('auth.forgot.global', 60, 600, 'anon');

-- One atomic statement: concurrent callers cannot both slip under the limit. Returns 0 if allowed, else seconds until the window resets.
create function public.rate_limit_hit(p_key text, p_max int, p_window int) returns int language plpgsql security definer set search_path = '' as $$
declare w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window) * p_window); n int;
begin
  insert into public.rate_limits as r (key, window_start, hits) values (p_key, w, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1 returning r.hits into n;
  if random() < 0.01 then delete from public.rate_limits where window_start < now() - interval '1 day'; end if;
  if n > p_max then return greatest(1, ceil(extract(epoch from (w + p_window * interval '1 second' - now())))::int); end if;
  return 0;
end $$;

create function public.rate_limit_wait_text(p_seconds int) returns text language sql immutable set search_path = '' as $$
  select case when p_seconds < 90 then p_seconds || ' seconds' else ceil(p_seconds / 60.0)::int || ' minutes' end
$$;

-- Authenticated actions. Privileged contexts with no auth.uid() (migrations, seed, maintenance) are not limited.
create function public.rate_limit_check(p_action text) returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); rule public.rate_limit_rules; wait int;
begin
  if uid is null then return; end if;
  select * into rule from public.rate_limit_rules where action = p_action and scope = 'user';
  if not found then raise exception 'Unknown rate-limited action'; end if;
  wait := public.rate_limit_hit('u:' || uid || ':' || p_action, rule.max_hits, rule.window_seconds);
  if wait > 0 then raise exception 'You are doing that too often. Please try again in %.', public.rate_limit_wait_text(wait) using errcode = 'PT429'; end if;
end $$;

-- Callable by the app for actions that have no SQL function of their own (e.g. a future AI endpoint).
create function public.check_rate_limit(p_action text) returns void language sql security definer set search_path = '' as $$
  select public.rate_limit_check(p_action)
$$;

-- Unauthenticated flows (login / register / password reset). p_subject is an opaque hash chosen by the app, never a raw email or IP.
-- p_count=false "peeks": it reports whether the subject is already blocked WITHOUT consuming quota (used to count only failed logins).
create function public.anon_rate_limit(p_action text, p_subject text, p_count boolean default true) returns int language plpgsql security definer set search_path = '' as $$
declare rule public.rate_limit_rules; h int; w timestamptz;
begin
  if p_subject is null or char_length(p_subject) not between 1 and 128 then raise exception 'Invalid subject'; end if;
  select * into rule from public.rate_limit_rules where action = p_action and scope = 'anon';
  if not found then raise exception 'Unknown rate-limited action'; end if;
  if p_count then return public.rate_limit_hit('a:' || p_action || ':' || p_subject, rule.max_hits, rule.window_seconds); end if;
  w := to_timestamp(floor(extract(epoch from now()) / rule.window_seconds) * rule.window_seconds);
  select hits into h from public.rate_limits where key = 'a:' || p_action || ':' || p_subject and window_start = w;
  if coalesce(h, 0) >= rule.max_hits then return greatest(1, ceil(extract(epoch from (w + rule.window_seconds * interval '1 second' - now())))::int); end if;
  return 0;
end $$;

-- Database-level enforcement: direct API calls cannot bypass these.
create function public.t_limit_request_create() returns trigger language plpgsql security definer set search_path = '' as $$
begin perform public.rate_limit_check('request.create'); return new; end $$;
create trigger t_request_limit before insert on public.blood_requests for each row execute function public.t_limit_request_create();
create function public.t_limit_offer_create() returns trigger language plpgsql security definer set search_path = '' as $$
begin perform public.rate_limit_check('offer.create'); return new; end $$;
create trigger t_offer_limit before insert on public.offers for each row execute function public.t_limit_offer_create();

-- Wrap sensitive functions: the original becomes *_impl (not callable by app roles); the public name checks the limit first.
alter function public.invite_donors(bigint)               rename to invite_donors_impl;
alter function public.review_request(bigint, text, text, text) rename to review_request_impl;
alter function public.set_contact_consent(bigint, boolean) rename to set_contact_consent_impl;
alter function public.owner_request_offers(bigint)        rename to owner_request_offers_impl;

create function public.invite_donors(p_id bigint) returns int language plpgsql security definer set search_path = '' as $$
begin perform public.rate_limit_check('invite'); return public.invite_donors_impl(p_id); end $$;
create function public.review_request(p_id bigint, p_decision text, p_note text default null, p_method text default null)
returns public.request_status language plpgsql security definer set search_path = '' as $$
begin perform public.rate_limit_check('review'); return public.review_request_impl(p_id, p_decision, p_note, p_method); end $$;
create function public.set_contact_consent(p_offer_id bigint, p_granted boolean) returns void language plpgsql security definer set search_path = '' as $$
begin perform public.rate_limit_check('consent.change'); perform public.set_contact_consent_impl(p_offer_id, p_granted); end $$;
create function public.owner_request_offers(p_request_id bigint)
returns table (offer_id bigint, origin text, status public.offer_status, blood_group public.blood_group, donor_city text, contact_shared boolean, donor_name text, phone text, email text)
language plpgsql security definer set search_path = '' as $$
begin perform public.rate_limit_check('contact.view'); return query select * from public.owner_request_offers_impl(p_request_id); end $$;

revoke all on function public.invite_donors_impl(bigint), public.review_request_impl(bigint, text, text, text), public.set_contact_consent_impl(bigint, boolean),
  public.owner_request_offers_impl(bigint), public.rate_limit_hit(text, int, int), public.rate_limit_check(text), public.rate_limit_wait_text(int),
  public.t_limit_request_create(), public.t_limit_offer_create(), public.emit_notification_event(), public.queue_notification_email(), public.categorize_notification()
  from public, anon, authenticated;
revoke all on function public.invite_donors(bigint), public.review_request(bigint, text, text, text), public.set_contact_consent(bigint, boolean),
  public.owner_request_offers(bigint), public.check_rate_limit(text), public.anon_rate_limit(text, text, boolean) from public, anon;
grant execute on function public.invite_donors(bigint), public.review_request(bigint, text, text, text), public.set_contact_consent(bigint, boolean),
  public.owner_request_offers(bigint), public.check_rate_limit(text) to authenticated;
grant execute on function public.anon_rate_limit(text, text, boolean) to anon, authenticated;
