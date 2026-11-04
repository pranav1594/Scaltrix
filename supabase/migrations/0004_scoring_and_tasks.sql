-- =====================================================================
-- Scaltrix step 6
--   1. Per-project contribution scoring (4 methods, chosen per project)
--   2. Project tasks (for the "task points" method)
--   3. save_team now stores rating / hours / hour multiplier
--   4. Client bonds: referral rows can point at the client that was brought
-- Run AFTER 0001, 0002 and 0003. Existing projects keep working.
-- =====================================================================

-- 1. Scoring method per project -------------------------------------
-- NULL scoring_method = an older project: it keeps using the typed "score" as before.
alter table public.projects add column scoring_method text
  check (scoring_method in ('manual_rating','hours','task_points','mix'));
alter table public.projects add column scoring_weights jsonb;   -- {"ratingBp":4000,"hoursBp":4000,"tasksBp":2000}

alter table public.project_employees alter column score type numeric(18,6);
alter table public.project_employees add column rating      numeric(6,2)  not null default 0 check (rating >= 0 and rating <= 10);
alter table public.project_employees add column hours       numeric(10,2) not null default 0 check (hours >= 0);
alter table public.project_employees add column hour_weight numeric(6,2) not null default 1 check (hour_weight >= 0);

-- 2. Tasks -----------------------------------------------------------
create table public.project_tasks (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  title        text not null,
  points       numeric(8,2) not null default 1 check (points >= 0),
  employee_id  uuid references public.employees(id),
  status       text not null default 'todo' check (status in ('todo','doing','done')),
  done_on      date,
  created_at   timestamptz not null default now()
);
create index on public.project_tasks (project_id);
alter table public.project_tasks enable row level security;
create policy "authenticated full access" on public.project_tasks
  for all to authenticated using (true) with check (true);
create trigger trg_audit_project_tasks after insert or update or delete on public.project_tasks
  for each row execute function public.write_audit();

-- 3. save_team with the new inputs -----------------------------------
-- Same pool guard as before. p_method / p_weights are saved on the project.
create or replace function public.save_team(p_project uuid, p_team jsonb) returns void
language plpgsql as $$
begin
  perform public.save_team(p_project, p_team, null, null);
end $$;

create or replace function public.save_team(p_project uuid, p_team jsonb, p_method text, p_weights jsonb) returns void
language plpgsql as $$
declare
  v_old bigint;
  v_new bigint;
begin
  perform 1 from public.project_employees where project_id = p_project for update;
  select coalesce(sum(share_paise), 0) into v_old
    from public.project_employees where project_id = p_project;

  delete from public.project_employees
   where project_id = p_project
     and employee_id not in (
       select x.employee_id from jsonb_to_recordset(p_team) as x(employee_id uuid));

  insert into public.project_employees
    (project_id, employee_id, role, score, share_bp, share_paise, rating, hours, hour_weight)
  select p_project, x.employee_id, x.role, x.score, x.share_bp, x.share_paise,
         coalesce(x.rating, 0), coalesce(x.hours, 0), coalesce(x.hour_weight, 1)
  from jsonb_to_recordset(p_team)
       as x(employee_id uuid, role text, score numeric, share_bp integer, share_paise bigint,
            rating numeric, hours numeric, hour_weight numeric)
  on conflict (project_id, employee_id)
  do update set role = excluded.role, score = excluded.score,
                share_bp = excluded.share_bp, share_paise = excluded.share_paise,
                rating = excluded.rating, hours = excluded.hours, hour_weight = excluded.hour_weight;

  select coalesce(sum(share_paise), 0) into v_new
    from public.project_employees where project_id = p_project;

  if v_old > 0 and v_new <> v_old then
    raise exception 'Employee pool must stay the same: was % paise, now % paise', v_old, v_new;
  end if;

  if p_method is not null then
    update public.projects set scoring_method = p_method, scoring_weights = p_weights where id = p_project;
  end if;
end $$;

grant execute on function public.save_team(uuid, jsonb) to authenticated;
grant execute on function public.save_team(uuid, jsonb, text, jsonb) to authenticated;

-- 4. Referral rows can point at the client that was brought ----------
alter table public.referrals add column referred_client_id uuid references public.clients(id);
create index if not exists bonds_project_idx on public.bonds (project_id);
