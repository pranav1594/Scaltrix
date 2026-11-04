-- =====================================================================
-- Scaltrix Finance Manager: initial schema
-- Run this once in Supabase: SQL Editor > New query > paste > Run.
--
-- Conventions
--   * Money is stored as BIGINT paise (1 rupee = 100 paise). Never floats.
--   * Percentages are stored as INTEGER basis points (100% = 10000).
--   * Every table has Row Level Security ON. Only logged-in users can
--     read/write. Sign-ups are disabled, so only people YOU add can log in.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Settings (editable rules). One row per setting key.
-- ---------------------------------------------------------------------
create table public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

insert into public.settings (key, value) values
  ('split',            '{"companyBp":5000,"reserveBp":8000}'),
  ('founder_advance',  '{"mode":"equalizing"}'),                    -- equalizing | loan
  ('contribution',     '{"method":"manual_rating"}'),               -- hours | task_points | manual_rating | mix
  ('extra_recovery',   '{"mode":"installments","count":3}'),        -- one_time | installments | per_project
  ('bond_compensation','{"kind":"percent","bp":1000}'),            -- percent | fixed | per_missed
  ('tax',              '{"gst":{"enabled":false,"rateBp":1800},"tds":{"enabled":false,"rateBp":1000}}');

-- ---------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------
create table public.founders (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  email      text,
  phone      text,
  weight_bp  integer not null check (weight_bp between 0 and 10000),
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.employees (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  role       text,
  email      text,
  phone      text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.clients (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  email      text,
  phone      text,
  notes      text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Documents: one row per uploaded file (the file itself lives in Storage)
-- ---------------------------------------------------------------------
create table public.documents (
  id            uuid primary key default gen_random_uuid(),
  bucket        text not null,
  path          text not null,
  file_name     text not null,
  mime_type     text,
  size_bytes    bigint,
  linked_table  text,
  linked_id     uuid,
  uploaded_by   uuid default auth.uid(),
  uploaded_at   timestamptz not null default now(),
  unique (bucket, path)
);
create index on public.documents (linked_table, linked_id);

-- ---------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------
create table public.projects (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  client_id          uuid references public.clients(id),
  status             text not null default 'active'
                       check (status in ('draft','active','completed','cancelled')),
  price_paise        bigint not null check (price_paise >= 0),
  start_date         date,
  end_date           date,
  -- Rules in force when the split was calculated. Old projects keep their
  -- own rules, so changing Settings later never rewrites history.
  settings_snapshot  jsonb,
  revision           integer not null default 1,
  notes              text,
  created_at         timestamptz not null default now()
);

create table public.payments (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  amount_paise bigint not null check (amount_paise > 0),
  received_on  date not null default current_date,
  gst_paise    bigint not null default 0,
  tds_paise    bigint not null default 0,
  note         text,
  document_id  uuid references public.documents(id),   -- proof of client payment
  created_at   timestamptz not null default now()
);

create table public.project_employees (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  employee_id  uuid not null references public.employees(id),
  role         text,
  score        numeric(12,3) not null check (score >= 0),
  share_bp     integer,
  share_paise  bigint not null default 0,
  unique (project_id, employee_id)
);

create table public.project_founder_payouts (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  founder_id  uuid not null references public.founders(id),
  weight_bp   integer not null,
  paise       bigint not null,
  unique (project_id, founder_id)
);

-- ---------------------------------------------------------------------
-- Reserve ledger. Positive amount + direction.
-- ---------------------------------------------------------------------
create table public.reserve_ledger (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('project_inflow','expense','founder_advance','adjustment')),
  direction     text not null check (direction in ('in','out')),
  amount_paise  bigint not null check (amount_paise > 0),
  occurred_on   date not null default current_date,
  description   text not null,
  project_id    uuid references public.projects(id),
  document_id   uuid references public.documents(id),  -- the bill
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  -- Every reserve spend MUST have a bill attached.
  constraint expense_needs_bill check (kind <> 'expense' or document_id is not null)
);
create index on public.reserve_ledger (occurred_on);

create or replace view public.reserve_balance as
select coalesce(sum(case direction when 'in' then amount_paise else -amount_paise end), 0)::bigint
         as balance_paise
from public.reserve_ledger;

-- The reserve can never go below zero. An advisory lock stops two
-- simultaneous withdrawals from sneaking past the check.
create or replace function public.guard_reserve_balance() returns trigger
language plpgsql as $$
declare current_balance bigint;
begin
  perform pg_advisory_xact_lock(hashtext('scaltrix_reserve'));
  select coalesce(sum(case direction when 'in' then amount_paise else -amount_paise end), 0)
    into current_balance from public.reserve_ledger;
  if new.direction = 'out' and current_balance - new.amount_paise < 0 then
    raise exception 'Reserve balance too low: have % paise, need % paise',
      current_balance, new.amount_paise;
  end if;
  return new;
end $$;

create trigger trg_guard_reserve before insert on public.reserve_ledger
for each row execute function public.guard_reserve_balance();

-- Ledger rows are never edited or deleted. Fix mistakes with an 'adjustment'.
create or replace function public.ledger_is_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'reserve_ledger is append-only; add an adjustment entry instead';
end $$;

create trigger trg_ledger_no_update before update or delete on public.reserve_ledger
for each row execute function public.ledger_is_append_only();

-- ---------------------------------------------------------------------
-- Founder advances
-- ---------------------------------------------------------------------
create table public.founder_advances (
  id                     uuid primary key default gen_random_uuid(),
  founder_id             uuid not null references public.founders(id),
  mode                   text not null check (mode in ('equalizing','loan')),
  amount_paise           bigint not null check (amount_paise > 0),
  total_withdrawal_paise bigint not null check (total_withdrawal_paise > 0),
  outstanding_paise      bigint not null default 0 check (outstanding_paise >= 0), -- loan mode only
  taken_on               date not null default current_date,
  note                   text,
  created_at             timestamptz not null default now()
);

create table public.founder_advance_shares (
  id          uuid primary key default gen_random_uuid(),
  advance_id  uuid not null references public.founder_advances(id) on delete cascade,
  founder_id  uuid not null references public.founders(id),
  paise       bigint not null check (paise >= 0)
);

-- ---------------------------------------------------------------------
-- Employee extra payouts and recoveries
-- ---------------------------------------------------------------------
create table public.extra_payouts (
  id                uuid primary key default gen_random_uuid(),
  employee_id       uuid not null references public.employees(id),
  project_id        uuid references public.projects(id),
  base_paise        bigint not null check (base_paise > 0),
  extra_paise       bigint not null check (extra_paise > 0),
  extra_bp          integer not null,
  recovery_mode     text not null check (recovery_mode in ('one_time','installments','per_project')),
  installments      integer,
  per_project_bp    integer,
  outstanding_paise bigint not null check (outstanding_paise >= 0),
  given_on          date not null default current_date,
  note              text,
  created_at        timestamptz not null default now()
);

create table public.recoveries (
  id               uuid primary key default gen_random_uuid(),
  extra_payout_id  uuid not null references public.extra_payouts(id) on delete cascade,
  amount_paise     bigint not null check (amount_paise > 0),
  recovered_on     date not null default current_date,
  project_id       uuid references public.projects(id),
  note             text
);

-- ---------------------------------------------------------------------
-- Bonds and referrals
-- ---------------------------------------------------------------------
create table public.bonds (
  id                   uuid primary key default gen_random_uuid(),
  party_type           text not null check (party_type in ('client','founder','employee')),
  party_name           text not null,
  client_id            uuid references public.clients(id),
  founder_id           uuid references public.founders(id),
  employee_id          uuid references public.employees(id),
  project_id           uuid references public.projects(id),
  title                text not null,
  terms                text,
  total_price_paise    bigint,
  paid_paise           bigint,
  outstanding_paise    bigint,
  required_referrals   integer check (required_referrals is null or required_referrals >= 1),
  compensation_kind    text check (compensation_kind in ('percent','fixed','per_missed')),
  compensation_value   bigint,                 -- bp for percent, paise otherwise
  signed_on            date,
  deadline             date,
  status               text not null default 'active'
                         check (status in ('active','fulfilled','partial','failed','cancelled')),
  document_id          uuid references public.documents(id),   -- scan of the signed bond
  created_at           timestamptz not null default now()
);

create table public.referrals (
  id             uuid primary key default gen_random_uuid(),
  bond_id        uuid not null references public.bonds(id) on delete cascade,
  referred_name  text not null,
  contact        text,
  verified       boolean not null default false,
  verified_on    date,
  note           text
);

-- ---------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------
create table public.products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  status      text not null default 'active',
  created_at  timestamptz not null default now()
);

create table public.product_entries (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products(id) on delete cascade,
  kind          text not null check (kind in ('cost','revenue')),
  amount_paise  bigint not null check (amount_paise > 0),
  occurred_on   date not null default current_date,
  description   text not null,
  document_id   uuid references public.documents(id),   -- invoice proof
  created_at    timestamptz not null default now(),
  constraint product_cost_needs_invoice check (kind <> 'cost' or document_id is not null)
);

-- ---------------------------------------------------------------------
-- Audit log: who changed what, when, old and new values
-- ---------------------------------------------------------------------
create table public.audit_log (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  row_id      text,
  action      text not null,
  old_data    jsonb,
  new_data    jsonb,
  changed_by  uuid default auth.uid(),
  changed_at  timestamptz not null default now()
);

create or replace function public.write_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare rid text;
begin
  if tg_op = 'DELETE' then rid := to_jsonb(old)->>'id';
  else rid := to_jsonb(new)->>'id'; end if;
  insert into public.audit_log(table_name, row_id, action, old_data, new_data)
  values (tg_table_name, coalesce(rid, to_jsonb(new)->>'key'), tg_op,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

-- Audit every business table (the audit log itself is excluded).
do $$
declare t text;
begin
  foreach t in array array[
    'settings','founders','employees','clients','documents','projects','payments',
    'project_employees','project_founder_payouts','reserve_ledger','founder_advances',
    'founder_advance_shares','extra_payouts','recoveries','bonds','referrals',
    'products','product_entries'
  ] loop
    execute format(
      'create trigger trg_audit_%1$s after insert or update or delete on public.%1$I
       for each row execute function public.write_audit()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Row Level Security: ON for every table.
-- Rule: any logged-in user (a founder you added in Authentication > Users)
-- has full access. Anonymous visitors get nothing.
-- audit_log is read-only for users (the trigger writes it).
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'settings','founders','employees','clients','documents','projects','payments',
    'project_employees','project_founder_payouts','reserve_ledger','founder_advances',
    'founder_advance_shares','extra_payouts','recoveries','bonds','referrals',
    'products','product_entries'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "authenticated full access" on public.%I
         for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

alter table public.audit_log enable row level security;
create policy "authenticated can read audit log" on public.audit_log
  for select to authenticated using (true);

-- The reserve_balance view runs with the caller's rights, so RLS still applies.
alter view public.reserve_balance set (security_invoker = true);

-- ---------------------------------------------------------------------
-- Storage: eight PRIVATE buckets + policies. Files open through
-- short-lived signed links (the "View Bill" buttons).
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values
  ('reserve-expenses', 'reserve-expenses', false),
  ('project-invoices', 'project-invoices', false),
  ('client-payments',  'client-payments',  false),
  ('product-invoices', 'product-invoices', false),
  ('bonds-clients',    'bonds-clients',    false),
  ('bonds-founders',   'bonds-founders',   false),
  ('bonds-employees',  'bonds-employees',  false),
  ('exports',          'exports',          false)
on conflict (id) do nothing;

create policy "scaltrix files: read" on storage.objects for select to authenticated
  using (bucket_id in ('reserve-expenses','project-invoices','client-payments','product-invoices',
                       'bonds-clients','bonds-founders','bonds-employees','exports'));

create policy "scaltrix files: upload" on storage.objects for insert to authenticated
  with check (bucket_id in ('reserve-expenses','project-invoices','client-payments','product-invoices',
                            'bonds-clients','bonds-founders','bonds-employees','exports'));

create policy "scaltrix files: replace" on storage.objects for update to authenticated
  using (bucket_id in ('reserve-expenses','project-invoices','client-payments','product-invoices',
                       'bonds-clients','bonds-founders','bonds-employees','exports'));

-- No delete policy on purpose: bills and bonds cannot be deleted from the app.
-- If you ever need to remove one, do it manually in the Supabase dashboard.
