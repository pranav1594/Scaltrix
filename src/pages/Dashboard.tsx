import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { recipientKey, recipientKind, recipientName, useExtraPayouts, useProjects, useReserveLedger } from "../lib/data";
import { totalsFor } from "../lib/extras";
import { bpToPct, formatINR } from "../engine";
import { bondStanding, useAllClientBonds, verifiedCount } from "../lib/bonds";

function Stat({ label, value, hint, to }: { label: string; value: string; hint?: string; to?: string }) {
  const body = (
    <div className="card h-full">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
  return to ? (
    <Link to={to} className="block hover:opacity-90">
      {body}
    </Link>
  ) : (
    body
  );
}

export default function Dashboard() {
  const reserve = useQuery({
    queryKey: ["reserve-balance"],
    queryFn: async () => {
      const { data, error } = await supabase.from("reserve_balance").select("balance_paise").single();
      if (error) throw error;
      return Number(data.balance_paise);
    },
  });
  const projectsQ = useProjects();
  const extrasQ = useExtraPayouts();
  const ledgerQ = useReserveLedger();

  const money = useMemo(() => {
    const ps = (projectsQ.data ?? []).filter((p) => p.status !== "cancelled");
    const received = ps.reduce((a, p) => a + p.payments.reduce((b, x) => b + Number(x.amount_paise), 0), 0);
    const price = ps.reduce((a, p) => a + Number(p.price_paise), 0);
    const open = ps
      .map((p) => ({ p, balance: Number(p.price_paise) - p.payments.reduce((b, x) => b + Number(x.amount_paise), 0) }))
      .filter((x) => x.balance > 0)
      .sort((a, b) => b.balance - a.balance);
    return { count: ps.length, received, toCollect: Math.max(price - received, 0), open };
  }, [projectsQ.data]);

  const extras = extrasQ.data ?? [];
  const totals = totalsFor(extras);
  const recoveredPct = totals.given > 0 ? Math.round((totals.recovered / totals.given) * 100) : 0;

  // Who still owes the company, grouped by employee.
  const owedByEmployee = useMemo(() => {
    const m = new Map<string, { name: string; kind: string; owed: number; items: number }>();
    for (const x of extras) {
      if (Number(x.outstanding_paise) <= 0) continue;
      const key = recipientKey(x);
      const cur = m.get(key) ?? { name: recipientName(x), kind: recipientKind(x), owed: 0, items: 0 };
      cur.owed += Number(x.outstanding_paise);
      cur.items += 1;
      m.set(key, cur);
    }
    return [...m.values()].sort((a, b) => b.owed - a.owed);
  }, [extras]);

  const spending = useMemo(
    () => (ledgerQ.data ?? []).filter((r) => r.kind === "expense").slice(0, 5),
    [ledgerQ.data],
  );

  const bondsQ = useAllClientBonds();
  const openBonds = (bondsQ.data ?? []).filter((b) => b.status === "active");
  const receivedBy = new Map((projectsQ.data ?? []).map((p) => [p.id, p.payments.reduce((a, x) => a + Number(x.amount_paise), 0)]));

  const recent = useMemo(
    () => [...extras].sort((a, b) => b.given_on.localeCompare(a.given_on)).slice(0, 5),
    [extras],
  );

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="mb-6 text-sm text-slate-500">Where the company's money stands right now.</p>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Reserve balance"
          value={reserve.isLoading ? "..." : reserve.isError ? "Not set up" : formatINR(reserve.data ?? 0)}
          hint="See spending and bills"
          to="/reserve"
        />
        <Stat label="Received from clients" value={formatINR(money.received)} hint={`${money.count} project${money.count === 1 ? "" : "s"}`} to="/projects" />
        <Stat label="Still to collect" value={formatINR(money.toCollect)} hint="Agreed price minus received" to="/projects" />
        <Stat
          label="Extra payouts to recover"
          value={formatINR(totals.outstanding)}
          hint={extras.length ? `${recoveredPct}% of ${formatINR(totals.given)} recovered` : "None recorded"}
          to="/extra-payouts"
        />
      </div>

      {openBonds.length > 0 && (
        <section className="card mb-6">
          <h2 className="font-semibold">Client bonds in progress</h2>
          <p className="mb-2 text-xs text-slate-500">Money covered by a signed bond, waiting for the client to bring new clients.</p>
          <ul className="divide-y divide-slate-100 text-sm">
            {openBonds.map((b) => {
              const st = bondStanding(b, receivedBy.get(b.project_id ?? "") ?? 0);
              const overdue = b.deadline != null && b.deadline < new Date().toISOString().slice(0, 10);
              return (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <Link className="font-medium text-brand-600 hover:underline" to={`/projects/${b.project_id}`}>
                      {b.projects?.name ?? b.title}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {b.party_name} · {verifiedCount(b)} of {b.required_referrals} clients verified
                      {b.deadline ? ` · deadline ${b.deadline}` : ""}
                      {overdue ? " (passed)" : ""}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium">{formatINR(b.outstanding_paise ?? 0)} covered</div>
                    <div className="text-xs text-slate-500">If it failed today: collect {formatINR(st.payableNowPaise)}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Extra payouts</h2>
            <Link className="text-sm text-brand-600 hover:underline" to="/extra-payouts">
              Open
            </Link>
          </div>

          <div className="mb-4 grid grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-slate-500">Given</div>
              <div className="font-semibold">{formatINR(totals.given)}</div>
            </div>
            <div>
              <div className="text-slate-500">Recovered</div>
              <div className="font-semibold">{formatINR(totals.recovered)}</div>
            </div>
            <div>
              <div className="text-slate-500">Outstanding</div>
              <div className="font-semibold">{formatINR(totals.outstanding)}</div>
            </div>
          </div>

          <div className="mb-4 h-2 overflow-hidden rounded-full bg-slate-100" aria-label="Recovered share">
            <div className="h-full bg-brand-500" style={{ width: `${recoveredPct}%` }} />
          </div>

          <div className="mb-1 text-sm font-medium">Who owes the company</div>
          {extrasQ.isLoading ? (
            <p className="text-sm text-slate-500">Loading...</p>
          ) : owedByEmployee.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing outstanding.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {owedByEmployee.map((o) => (
                <li key={o.name + o.kind} className="flex justify-between py-1.5">
                  <span>
                    {o.name} <span className="text-xs text-slate-400">({o.kind.toLowerCase()}, {o.items} extra{o.items === 1 ? "" : "s"})</span>
                  </span>
                  <span className="font-medium">{formatINR(o.owed)}</span>
                </li>
              ))}
            </ul>
          )}

          {recent.length > 0 && (
            <>
              <div className="mb-1 mt-4 text-sm font-medium">Latest extras given</div>
              <ul className="divide-y divide-slate-100 text-sm">
                {recent.map((x) => (
                  <li key={x.id} className="flex justify-between py-1.5">
                    <span>
                      {recipientName(x)}
                      <span className="text-xs text-slate-400"> · {x.given_on}</span>
                    </span>
                    <span>
                      {formatINR(Number(x.extra_paise))} <span className="text-xs text-slate-500">{x.extra_bp != null ? `(${bpToPct(x.extra_bp).toFixed(1)}%)` : ""}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Projects with money to collect</h2>
            <Link className="text-sm text-brand-600 hover:underline" to="/projects">
              All projects
            </Link>
          </div>
          {projectsQ.isLoading ? (
            <p className="text-sm text-slate-500">Loading...</p>
          ) : money.open.length === 0 ? (
            <p className="text-sm text-slate-500">Every project is fully paid.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {money.open.slice(0, 6).map(({ p, balance }) => (
                <li key={p.id} className="flex justify-between py-1.5">
                  <Link className="text-brand-600 hover:underline" to={`/projects/${p.id}`}>
                    {p.name}
                  </Link>
                  <span className="font-medium">{formatINR(balance)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mb-1 mt-5 flex items-center justify-between">
            <div className="text-sm font-medium">Latest reserve spending</div>
            <Link className="text-sm text-brand-600 hover:underline" to="/reserve">
              Open
            </Link>
          </div>
          {spending.length === 0 ? (
            <p className="text-sm text-slate-500">No spending recorded.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {spending.map((r) => (
                <li key={r.id} className="flex justify-between gap-3 py-1.5">
                  <span className="truncate">
                    {r.description}
                    <span className="text-xs text-slate-400"> · {r.occurred_on}</span>
                  </span>
                  <span className="whitespace-nowrap font-medium">{formatINR(Number(r.amount_paise))}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
