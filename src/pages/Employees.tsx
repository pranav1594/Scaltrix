import { FormEvent, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useEmployees } from "../lib/data";

export default function Employees() {
  const q = useEmployees();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("employees").insert({
        name: name.trim(),
        role: role.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setName("");
      setRole("");
      setEmail("");
      setPhone("");
      qc.invalidateQueries({ queryKey: ["employees"] });
    },
  });

  const toggle = useMutation({
    mutationFn: async (e: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("employees").update({ is_active: e.is_active }).eq("id", e.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["employees"] }),
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      if (!name.trim()) throw new Error("Name is required");
      await add.mutateAsync();
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Could not add employee");
    }
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold">Employees</h1>
      <p className="mb-6 text-sm text-slate-500">
        People you can assign to projects. Deactivate someone instead of deleting, so past records stay intact.
      </p>

      <form onSubmit={onSubmit} className="card mb-6 grid gap-3 sm:grid-cols-4">
        <div>
          <label className="label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">Default role</label>
          <input className="input" value={role} onChange={(e) => setRole(e.target.value)} />
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label">Phone</label>
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="sm:col-span-4 flex items-center gap-3">
          <button className="btn" disabled={add.isPending}>
            Add employee
          </button>
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
      </form>

      <div className="card">
        {q.isLoading ? (
          <p className="text-sm text-slate-500">Loading...</p>
        ) : q.data && q.data.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pb-2 font-medium">Name</th>
                <th className="pb-2 font-medium">Role</th>
                <th className="pb-2 font-medium">Contact</th>
                <th className="pb-2 font-medium">Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {q.data.map((e) => (
                <tr key={e.id} className="border-t border-slate-100">
                  <td className="py-2 font-medium">{e.name}</td>
                  <td>{e.role ?? "-"}</td>
                  <td className="text-slate-600">{[e.email, e.phone].filter(Boolean).join(" · ") || "-"}</td>
                  <td>{e.is_active ? "Active" : "Inactive"}</td>
                  <td className="text-right">
                    <button
                      className="text-brand-600 hover:underline"
                      onClick={() => toggle.mutate({ id: e.id, is_active: !e.is_active })}
                    >
                      {e.is_active ? "Deactivate" : "Reactivate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-slate-500">No employees yet. Add your first one above.</p>
        )}
      </div>
    </div>
  );
}
