import { FormEvent, useState } from "react";
import { supabase } from "../lib/supabase";
import Logo from "../components/Logo";
import ThemeToggle from "../components/ThemeToggle";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setBusy(false);
  }

  return (
    <div className="mx-auto mt-24 max-w-sm card">
      <div className="fixed right-4 top-4"><ThemeToggle /></div>
      <Logo className="mx-auto mb-4 h-20 w-auto" />
      <h1 className="sr-only">Scaltrix</h1>
      <p className="mb-5 text-center text-sm text-slate-500">Sign in with the account created in Supabase.</p>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label">Password</label>
          <input
            className="input"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn w-full" disabled={busy}>
          {busy ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}
