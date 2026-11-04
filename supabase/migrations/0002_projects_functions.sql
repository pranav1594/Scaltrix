-- =====================================================================
-- Scaltrix step 3: atomic database functions
-- Run AFTER 0001_init.sql (SQL Editor > New query > paste > Run).
--
-- Each function does several writes in ONE transaction, so a payment is
-- either fully recorded (payment + reserve + founder + employee amounts)
-- or not recorded at all. They run with the caller's rights, so Row Level
-- Security still applies.
-- =====================================================================

-- ---------------------------------------------------------------------
-- record_payment: save a client payment and its split.
--   p_founders  : [{"founder_id": "...", "weight_bp": 5000, "paise": 500000}, ...]  (cumulative)
--   p_employees : [{"employee_id": "...", "share_bp": 4000, "share_paise": 2000000}, ...] (cumulative)
--   p_reserve_delta : new money for the reserve from THIS payment
--   p_snapshot  : rules used (saved on the project the first time only)
-- Safety check: reserve + founders + employees must equal the net money
-- received, to the paisa. Otherwise everything is rolled back.
-- ---------------------------------------------------------------------
create or replace function public.record_payment(
  p_project        uuid,
  p_amount         bigint,
  p_received_on    date,
  p_gst            bigint,
  p_tds            bigint,
  p_note           text,
  p_document       uuid,
  p_reserve_delta  bigint,
  p_founders       jsonb,
  p_employees      jsonb,
  p_snapshot       jsonb
) returns uuid
language plpgsql as $$
declare
  v_payment uuid;
  v_net     bigint;
  v_out     bigint;
begin
  if not exists (select 1 from public.project_employees where project_id = p_project) then
    raise exception 'Add at least one team member before recording a payment';
  end if;
  if p_reserve_delta < 0 then
    raise exception 'Reserve increase cannot be negative';
  end if;

  insert into public.payments (project_id, amount_paise, received_on, gst_paise, tds_paise, note, document_id)
  values (p_project, p_amount, p_received_on, coalesce(p_gst, 0), coalesce(p_tds, 0), p_note, p_document)
  returning id into v_payment;

  if p_reserve_delta > 0 then
    insert into public.reserve_ledger (kind, direction, amount_paise, description, project_id, occurred_on)
    values ('project_inflow', 'in', p_reserve_delta,
            'Share of project payment', p_project, p_received_on);
  end if;

  insert into public.project_founder_payouts (project_id, founder_id, weight_bp, paise)
  select p_project, x.founder_id, x.weight_bp, x.paise
  from jsonb_to_recordset(p_founders) as x(founder_id uuid, weight_bp integer, paise bigint)
  on conflict (project_id, founder_id)
  do update set paise = excluded.paise, weight_bp = excluded.weight_bp;

  update public.project_employees pe
     set share_bp = x.share_bp, share_paise = x.share_paise
    from jsonb_to_recordset(p_employees) as x(employee_id uuid, share_bp integer, share_paise bigint)
   where pe.project_id = p_project and pe.employee_id = x.employee_id;

  update public.projects
     set settings_snapshot = coalesce(settings_snapshot, p_snapshot),
         revision = revision + 1
   where id = p_project;

  -- Integrity check: every paisa received is accounted for.
  select coalesce(sum(amount_paise - gst_paise - tds_paise), 0) into v_net
    from public.payments where project_id = p_project;

  select (select coalesce(sum(paise), 0) from public.project_founder_payouts where project_id = p_project)
       + (select coalesce(sum(share_paise), 0) from public.project_employees where project_id = p_project)
       + (select coalesce(sum(amount_paise), 0) from public.reserve_ledger
            where project_id = p_project and kind = 'project_inflow' and direction = 'in')
    into v_out;

  if v_out <> v_net then
    raise exception 'Split does not add up: net received % paise, distributed % paise', v_net, v_out;
  end if;

  return v_payment;
end $$;

-- ---------------------------------------------------------------------
-- save_team: replace a project's employee list, roles and scores.
--   p_team : [{"employee_id": "...", "role": "Developer", "score": 40,
--              "share_bp": 4000, "share_paise": 2000000}, ...]
-- If money has already been split, the employee pool must stay the same
-- (people can be re-weighted, but not paid more or less in total).
-- ---------------------------------------------------------------------
create or replace function public.save_team(p_project uuid, p_team jsonb) returns void
language plpgsql as $$
declare
  v_old bigint;
  v_new bigint;
begin
  -- Lock the rows first (Postgres does not allow FOR UPDATE together with sum()).
  perform 1 from public.project_employees where project_id = p_project for update;
  select coalesce(sum(share_paise), 0) into v_old
    from public.project_employees where project_id = p_project;

  delete from public.project_employees
   where project_id = p_project
     and employee_id not in (
       select x.employee_id from jsonb_to_recordset(p_team) as x(employee_id uuid));

  insert into public.project_employees (project_id, employee_id, role, score, share_bp, share_paise)
  select p_project, x.employee_id, x.role, x.score, x.share_bp, x.share_paise
  from jsonb_to_recordset(p_team)
       as x(employee_id uuid, role text, score numeric, share_bp integer, share_paise bigint)
  on conflict (project_id, employee_id)
  do update set role = excluded.role, score = excluded.score,
                share_bp = excluded.share_bp, share_paise = excluded.share_paise;

  select coalesce(sum(share_paise), 0) into v_new
    from public.project_employees where project_id = p_project;

  if v_old > 0 and v_new <> v_old then
    raise exception 'Employee pool must stay the same: was % paise, now % paise', v_old, v_new;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- record_recovery: deduct part of an employee's extra payout.
-- ---------------------------------------------------------------------
create or replace function public.record_recovery(
  p_extra    uuid,
  p_amount   bigint,
  p_on       date,
  p_project  uuid,
  p_note     text
) returns void
language plpgsql as $$
declare v_outstanding bigint;
begin
  select outstanding_paise into v_outstanding
    from public.extra_payouts where id = p_extra for update;
  if v_outstanding is null then raise exception 'Extra payout not found'; end if;
  if p_amount <= 0 then raise exception 'Recovery must be above zero'; end if;
  if p_amount > v_outstanding then
    raise exception 'Cannot recover more than is owed (% paise outstanding)', v_outstanding;
  end if;

  insert into public.recoveries (extra_payout_id, amount_paise, recovered_on, project_id, note)
  values (p_extra, p_amount, p_on, p_project, p_note);

  update public.extra_payouts set outstanding_paise = outstanding_paise - p_amount where id = p_extra;
end $$;

grant execute on function public.record_payment(uuid, bigint, date, bigint, bigint, text, uuid, bigint, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.save_team(uuid, jsonb) to authenticated;
grant execute on function public.record_recovery(uuid, bigint, date, uuid, text) to authenticated;
