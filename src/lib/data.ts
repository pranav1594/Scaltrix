import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";

export interface EmployeeRow {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  is_active: boolean;
}

export function useEmployees() {
  return useQuery({
    queryKey: ["employees"],
    queryFn: async (): Promise<EmployeeRow[]> => {
      const { data, error } = await supabase
        .from("employees")
        .select("id,name,role,email,phone,is_active")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export interface ProjectListRow {
  id: string;
  name: string;
  status: string;
  price_paise: number;
  clients: { name: string } | null;
  payments: { amount_paise: number }[];
}

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: async (): Promise<ProjectListRow[]> => {
      const { data, error } = await supabase
        .from("projects")
        .select("id,name,status,price_paise,clients(name),payments(amount_paise)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ProjectListRow[];
    },
  });
}

export interface ProjectDetailRow {
  id: string;
  name: string;
  status: string;
  price_paise: number;
  revision: number;
  notes: string | null;
  settings_snapshot: ProjectSnapshot | null;
  scoring_method: "manual_rating" | "hours" | "task_points" | "mix" | null;
  scoring_weights: { ratingBp: number; hoursBp: number; tasksBp: number } | null;
  clients: { id: string; name: string } | null;
  payments: {
    id: string;
    amount_paise: number;
    gst_paise: number;
    tds_paise: number;
    received_on: string;
    note: string | null;
    document_id: string | null;
  }[];
  project_employees: {
    id: string;
    employee_id: string;
    role: string | null;
    score: number;
    rating: number;
    hours: number;
    hour_weight: number;
    share_bp: number | null;
    share_paise: number;
    employees: { name: string } | null;
  }[];
  project_founder_payouts: {
    founder_id: string;
    weight_bp: number;
    paise: number;
    founders: { name: string } | null;
  }[];
}

/** The rules a project was first calculated under. Saved on the project. */
export interface ProjectSnapshot {
  companyBp: number;
  reserveBp: number;
  gst: { enabled: boolean; rateBp: number };
  tds: { enabled: boolean; rateBp: number };
  founders: { id: string; name: string; weightBp: number }[];
}

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: ["project", id],
    enabled: Boolean(id),
    queryFn: async (): Promise<ProjectDetailRow> => {
      const { data, error } = await supabase
        .from("projects")
        .select(
          "id,name,status,price_paise,revision,notes,settings_snapshot,scoring_method,scoring_weights,clients(id,name)," +
            "payments(id,amount_paise,gst_paise,tds_paise,received_on,note,document_id)," +
            "project_employees(id,employee_id,role,score,rating,hours,hour_weight,share_bp,share_paise,employees(name))," +
            "project_founder_payouts(founder_id,weight_bp,paise,founders(name))",
        )
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as unknown as ProjectDetailRow;
    },
  });
}

export interface ProjectDocRow {
  id: string;
  file_name: string;
  uploaded_at: string;
}

export function useProjectInvoices(projectId: string | undefined) {
  return useQuery({
    queryKey: ["project-invoices", projectId],
    enabled: Boolean(projectId),
    queryFn: async (): Promise<ProjectDocRow[]> => {
      const { data, error } = await supabase
        .from("documents")
        .select("id,file_name,uploaded_at")
        .eq("linked_table", "projects")
        .eq("linked_id", projectId!)
        .order("uploaded_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export interface ExtraPayoutRow {
  id: string;
  /** What the person's share was, for working out the extra as a %. Optional. */
  base_paise: number | null;
  extra_paise: number;
  extra_bp: number | null;
  recovery_mode: "one_time" | "installments" | "per_project";
  installments: number | null;
  per_project_bp: number | null;
  outstanding_paise: number;
  given_on: string;
  note: string | null;
  project_id: string | null;
  /** Exactly one of these is set: the extra went to an employee or to a founder (shareholder). */
  employee_id: string | null;
  founder_id: string | null;
  employees: { name: string } | null;
  founders: { name: string } | null;
  projects: { name: string } | null;
  recoveries: { id: string; amount_paise: number; recovered_on: string; note: string | null }[];
}

export function recipientName(x: Pick<ExtraPayoutRow, "employees" | "founders">): string {
  return x.employees?.name ?? x.founders?.name ?? "Unknown";
}
export function recipientKind(x: Pick<ExtraPayoutRow, "employee_id">): "Employee" | "Founder" {
  return x.employee_id ? "Employee" : "Founder";
}
/** Stable key for grouping by person. */
export function recipientKey(x: Pick<ExtraPayoutRow, "employee_id" | "founder_id">): string {
  return x.employee_id ?? x.founder_id ?? "";
}

export function useExtraPayouts() {
  return useQuery({
    queryKey: ["extra-payouts"],
    queryFn: async (): Promise<ExtraPayoutRow[]> => {
      const { data, error } = await supabase
        .from("extra_payouts")
        .select(
          "id,base_paise,extra_paise,extra_bp,recovery_mode,installments,per_project_bp,outstanding_paise," +
            "given_on,note,project_id,employee_id,founder_id,employees(name),founders(name),projects(name)," +
            "recoveries(id,amount_paise,recovered_on,note)",
        )
        .order("given_on", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ExtraPayoutRow[];
    },
  });
}

/* ------------------------------------------------------------------ */
/* Client invoices recorded against a project                          */
/* ------------------------------------------------------------------ */
export interface InvoiceRow {
  id: string;
  project_id: string;
  invoice_number: string;
  issued_on: string;
  due_on: string | null;
  amount_paise: number;
  status: "draft" | "sent" | "paid" | "cancelled";
  description: string | null;
  note: string | null;
  document_id: string | null;
}

export function useInvoiceRecords(projectId: string | undefined) {
  return useQuery({
    queryKey: ["invoice-records", projectId],
    enabled: Boolean(projectId),
    queryFn: async (): Promise<InvoiceRow[]> => {
      const { data, error } = await supabase
        .from("project_invoices")
        .select("id,project_id,invoice_number,issued_on,due_on,amount_paise,status,description,note,document_id")
        .eq("project_id", projectId!)
        .order("issued_on", { ascending: false });
      if (error) throw error;
      return (data ?? []) as InvoiceRow[];
    },
  });
}

/* ------------------------------------------------------------------ */
/* Reserve ledger with its bills                                       */
/* ------------------------------------------------------------------ */
export interface LedgerRow {
  id: string;
  kind: "project_inflow" | "expense" | "founder_advance" | "adjustment";
  direction: "in" | "out";
  amount_paise: number;
  occurred_on: string;
  description: string;
  category: string | null;
  paid_to: string | null;
  project_id: string | null;
  projects: { name: string } | null;
  /** Bills and screenshots attached to this entry (any number, all optional). */
  bills: { id: string; file_name: string }[];
}

export function useReserveLedger() {
  return useQuery({
    queryKey: ["reserve-ledger"],
    queryFn: async (): Promise<LedgerRow[]> => {
      const led = await supabase
        .from("reserve_ledger")
        .select("id,kind,direction,amount_paise,occurred_on,description,category,paid_to,project_id,document_id,projects(name)")
        .order("occurred_on", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(500);
      if (led.error) throw led.error;

      const docs = await supabase
        .from("documents")
        .select("id,file_name,linked_id")
        .eq("linked_table", "reserve_ledger");
      if (docs.error) throw docs.error;

      const byRow = new Map<string, { id: string; file_name: string }[]>();
      for (const d of docs.data ?? []) {
        if (!d.linked_id) continue;
        byRow.set(d.linked_id, [...(byRow.get(d.linked_id) ?? []), { id: d.id, file_name: d.file_name }]);
      }
      return (led.data ?? []).map((r) => {
        const row = r as unknown as LedgerRow & { document_id: string | null };
        const bills = byRow.get(row.id) ?? [];
        // Bills added in earlier versions were stored directly on the ledger row.
        if (row.document_id && !bills.some((b) => b.id === row.document_id)) {
          bills.unshift({ id: row.document_id, file_name: "Bill" });
        }
        return { ...row, bills };
      });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Bonds signed by founders (the signed paper is a file in Storage)    */
/* ------------------------------------------------------------------ */
export interface FounderBondRow {
  id: string;
  founder_id: string;
  document_id: string;
  created_at: string;
  documents: { file_name: string } | null;
}

/** Every founder bond that has a file, newest first. The newest per founder is the current one. */
export function useFounderBonds() {
  return useQuery({
    queryKey: ["founder-bonds"],
    queryFn: async (): Promise<FounderBondRow[]> => {
      const { data, error } = await supabase
        .from("bonds")
        .select("id,founder_id,document_id,created_at,documents(file_name)")
        .eq("party_type", "founder")
        .not("document_id", "is", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as FounderBondRow[];
    },
  });
}
