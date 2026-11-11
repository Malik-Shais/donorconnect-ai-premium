-- DonorConnect core schema. Medical eligibility is NEVER computed here: it is a status recorded by
-- authorised staff (admin acting for a blood service); no donation interval is encoded anywhere.

create type public.app_role       as enum ('donor', 'requester', 'admin');
create type public.blood_group    as enum ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-');
create type public.urgency_level  as enum ('routine', 'urgent', 'critical');
create type public.request_status as enum ('open', 'matched', 'fulfilled', 'cancelled');
create type public.offer_status   as enum ('invited', 'accepted', 'declined');
create type public.eligibility    as enum ('unverified', 'cleared', 'deferred');

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  role       public.app_role not null default 'donor',
  full_name  text not null check (char_length(full_name) between 2 and 60),
  city       text not null check (char_length(city) between 2 and 60),
  phone      text check (phone is null or phone ~ '^[0-9+()\-\s]{7,20}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.donor_profiles (
  user_id            uuid primary key references public.profiles (id) on delete cascade,
  blood_group        public.blood_group not null,
  available          boolean not null default true,
  last_donation_date date check (last_donation_date is null or last_donation_date <= current_date),
  eligibility_status public.eligibility not null default 'unverified',  -- set only by authorised staff
  eligibility_note   text check (eligibility_note is null or char_length(eligibility_note) <= 300),
  updated_at         timestamptz not null default now()
);

create table public.blood_requests (
  id            bigint generated always as identity primary key,
  requester_id  uuid not null references public.profiles (id) on delete restrict,
  patient_label text not null check (char_length(patient_label) between 2 and 40),  -- alias only, no medical records
  blood_group   public.blood_group not null,
  units         int not null check (units between 1 and 10),
  city          text not null check (char_length(city) between 2 and 60),
  hospital      text not null check (char_length(hospital) between 2 and 100),
  urgency       public.urgency_level not null,
  needed_by     date,
  note          text check (note is null or char_length(note) <= 300),
  status        public.request_status not null default 'open',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on public.blood_requests (requester_id);
create index on public.blood_requests (status, blood_group, city);

create table public.request_events (
  id         bigint generated always as identity primary key,
  request_id bigint not null references public.blood_requests (id) on delete cascade,
  status     public.request_status not null,
  note       text,
  actor_id   uuid,
  created_at timestamptz not null default now()
);
create index on public.request_events (request_id);

create table public.offers (
  id         bigint generated always as identity primary key,
  request_id bigint not null references public.blood_requests (id) on delete cascade,
  donor_id   uuid not null references public.profiles (id) on delete cascade,
  origin     text not null check (origin in ('invited', 'volunteered')),
  status     public.offer_status not null,
  created_at timestamptz not null default now(),
  unique (request_id, donor_id)
);
create index on public.offers (donor_id);

-- Explicit, revocable, per-offer consent to share the donor's phone/email with the requester.
create table public.contact_consents (
  offer_id   bigint primary key references public.offers (id) on delete cascade,
  granted    boolean not null default false,
  granted_at timestamptz,
  revoked_at timestamptz
);

create table public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  message    text not null,
  link       text,
  is_read    boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.notifications (user_id, is_read);

create table public.audit_logs (
  id         bigint generated always as identity primary key,
  actor_id   uuid,
  action     text not null,
  entity     text not null,
  entity_id  text,
  detail     jsonb,
  created_at timestamptz not null default now()
);

-- Preliminary red-cell compatibility reference (informational; clinicians confirm real compatibility).
create table public.blood_compat (
  donor_group     public.blood_group not null,
  recipient_group public.blood_group not null,
  primary key (donor_group, recipient_group)
);
insert into public.blood_compat values
  ('O-','O-'),('O-','O+'),('O-','A-'),('O-','A+'),('O-','B-'),('O-','B+'),('O-','AB-'),('O-','AB+'),
  ('O+','O+'),('O+','A+'),('O+','B+'),('O+','AB+'),
  ('A-','A-'),('A-','A+'),('A-','AB-'),('A-','AB+'),('A+','A+'),('A+','AB+'),
  ('B-','B-'),('B-','B+'),('B-','AB-'),('B-','AB+'),('B+','B+'),('B+','AB+'),
  ('AB-','AB-'),('AB-','AB+'),('AB+','AB+');

-- ---------- triggers ----------
create function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;
create trigger t_profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger t_donors_touch   before update on public.donor_profiles for each row execute function public.touch_updated_at();
create trigger t_requests_touch before update on public.blood_requests for each row execute function public.touch_updated_at();

-- New auth user -> profile. Metadata is CLIENT-CONTROLLED, so role is clamped: 'admin' can never come from here.
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  r public.app_role := case m->>'role' when 'requester' then 'requester' else 'donor' end;
begin
  insert into public.profiles (id, role, full_name, city, phone)
  values (new.id, r, btrim(coalesce(m->>'full_name', '')), btrim(coalesce(m->>'city', '')), nullif(btrim(coalesce(m->>'phone', '')), ''));
  if r = 'donor' then
    insert into public.donor_profiles (user_id, blood_group) values (new.id, (m->>'blood_group')::public.blood_group);
  end if;
  insert into public.notifications (user_id, message, link)
  values (new.id, 'Welcome to DonorConnect AI. Complete your profile to get started.', '/dashboard');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Request history + audit trail on create / status change.
create function public.log_request_change() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.request_events (request_id, status, actor_id, note)
    values (new.id, new.status, (select auth.uid()), case when tg_op = 'INSERT' then 'Request created' end);
    insert into public.audit_logs (actor_id, action, entity, entity_id, detail)
    values ((select auth.uid()), 'request.' || lower(tg_op), 'blood_requests', new.id::text, jsonb_build_object('status', new.status));
  end if;
  return new;
end $$;
create trigger t_request_log after insert or update on public.blood_requests for each row execute function public.log_request_change();
