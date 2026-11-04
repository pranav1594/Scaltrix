import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { isConfigured, supabase } from "./lib/supabase";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings";
import Calculator from "./pages/Calculator";
import Employees from "./pages/Employees";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";
import ExtraPayouts from "./pages/ExtraPayouts";
import Reserve from "./pages/Reserve";
import Logo from "./components/Logo";
import ThemeToggle from "./components/ThemeToggle";

function SetupNeeded() {
  return (
    <div className="mx-auto mt-24 max-w-xl card">
      <div className="fixed right-4 top-4"><ThemeToggle /></div>
      <Logo className="mb-4 h-14 w-auto" />
      <h1 className="text-xl font-semibold">Almost there: connect Supabase</h1>
      <p className="mt-2 text-sm text-slate-600">
        Copy <code className="rounded bg-slate-100 px-1">.env.example</code> to{" "}
        <code className="rounded bg-slate-100 px-1">.env</code>, then fill in{" "}
        <code className="rounded bg-slate-100 px-1">VITE_SUPABASE_URL</code> and{" "}
        <code className="rounded bg-slate-100 px-1">VITE_SUPABASE_ANON_KEY</code> from Supabase
        (Project Settings, API Keys). Restart the app after saving.
      </p>
    </div>
  );
}

const nav = [
  { to: "/", label: "Dashboard" },
  { to: "/projects", label: "Projects" },
  { to: "/employees", label: "Employees" },
  { to: "/reserve", label: "Reserve and Bills" },
  { to: "/extra-payouts", label: "Extra Payouts" },
  { to: "/calculator", label: "Split Calculator" },
  { to: "/settings", label: "Settings" },
];

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isConfigured) {
      setReady(true);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!ready) return <div className="p-10 text-sm text-slate-500">Loading...</div>;
  if (!isConfigured) return <SetupNeeded />;
  if (!session) return <Login />;

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col border-r border-slate-200 bg-surface p-4">
        <div className="mb-6 px-1"><Logo className="h-12 w-auto" /></div>
        <nav className="flex flex-1 flex-col gap-1">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-sm ${
                  isActive ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600 hover:bg-slate-100"
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-4 border-t border-slate-200 pt-3 text-xs text-slate-500">
          <ThemeToggle className="mb-3 w-full justify-center" />
          <div className="truncate">{session.user.email}</div>
          <button className="mt-2 text-brand-600 hover:underline" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 p-8">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/employees" element={<Employees />} />
          <Route path="/reserve" element={<Reserve />} />
          <Route path="/extra-payouts" element={<ExtraPayouts />} />
          <Route path="/calculator" element={<Calculator />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
