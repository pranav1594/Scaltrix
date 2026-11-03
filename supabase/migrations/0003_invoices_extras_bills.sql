-- =====================================================================
-- Scaltrix step 5
--   1. Client invoices recorded per project
--   2. Extra payouts for founders (shareholders) as well as employees
--   3. Bills on reserve spending become OPTIONAL, plus category / paid-to
-- Run AFTER 0001 and 0002 (SQL Editor > New query > paste > Run).
-- Safe to run once. Existing data is kept.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Client invoices
-- ---------------------------------------------------------------------
create table public.project_invoices (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  invoice_number  text not null,
  issued_on       date not null default current_date,
  due_on          date,
  amount_paise    bigint not null check (amount_paise >= 0),
  status          text not null default 'sent'
                    check (status in ('draft','sent','paid','cancelled')),
  description     text,
  note            text,
  document_id     uuid references public.documents(id),   -- the invoice file (optional)
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  unique (project_id, invoice_number)
);
create index on public.project_invoices (project_id);

alter table public.project_invoices enable row level security;
create policy "authenticated full access" on public.project_invoices
  for all to authenticated using (true) with check (true);
create trigger trg_audit_project_invoices after insert or update or delete on public.project_invoices
  for each row execute function public.write_audit();

-- ---------------------------------------------------------------------
-- 2. Extra payouts: employees OR founders (shareholders)
-- ---------------------------------------------------------------------
alter table public.extra_payouts alter column employee_id drop not null;
alter table public.extra_payouts add column founder_id uuid references public.founders(id);

-- A base amount is optional now (free-standing extras have no project share to compare with).
alter table public.extra_payouts drop constraint if exists extra_payouts_base_paise_check;
alter table public.extra_payouts alter column base_paise drop not null;
alter table public.extra_payouts alter column extra_bp   drop not null;
alter table public.extra_payouts add constraint extra_payouts_base_positive
  check (base_paise is null or base_paise > 0);

-- Exactly one recipient: an employee or a founder.
alter table public.extra_payouts add constraint extra_payouts_one_recipient
  check (num_nonnulls(employee_id, founder_id) = 1);

create index on public.extra_payouts (founder_id);

-- ---------------------------------------------------------------------
-- 3. Reserve spending: bills are optional; add category and paid-to
-- ---------------------------------------------------------------------
alter table public.reserve_ledger drop constraint if exists expense_needs_bill;
alter table public.reserve_ledger add column category text;
alter table public.reserve_ledger add column paid_to  text;

-- Bills attach to a ledger row through the documents table:
--   documents.linked_table = 'reserve_ledger', documents.linked_id = <ledger row id>
-- That is why a bill can be added later even though ledger rows are append-only.
