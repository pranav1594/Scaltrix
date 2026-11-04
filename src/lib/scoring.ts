import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { DEFAULT_MIX, SCORE_METHODS, type MixWeights, type ScoreMethod } from "../engine";

export interface TaskRow {
  id: string;
  project_id: string;
  title: string;
  points: number;
  employee_id: string | null;
  status: "todo" | "doing" | "done";
  done_on: string | null;
}

export function useProjectTasks(projectId: string | undefined) {
  return useQuery({
    queryKey: ["project-tasks", projectId],
    enabled: Boolean(projectId),
    queryFn: async (): Promise<TaskRow[]> => {
      const { data, error } = await supabase
        .from("project_tasks")
        .select("id,project_id,title,points,employee_id,status,done_on")
        .eq("project_id", projectId!)
        .order("created_at");
      if (error) throw error;
      return (data ?? []).map((t) => ({ ...t, points: Number(t.points) })) as TaskRow[];
    },
  });
}

export const methodLabel = (m: ScoreMethod | null | undefined) =>
  m ? (SCORE_METHODS.find((x) => x.value === m)?.label ?? m) : "Typed score (older project)";

export const normalizeMix = (m: Partial<MixWeights> | null | undefined): MixWeights => ({ ...DEFAULT_MIX, ...(m ?? {}) });

/** Completed task points per employee. */
export function donePoints(tasks: TaskRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tasks) if (t.status === "done" && t.employee_id) m.set(t.employee_id, (m.get(t.employee_id) ?? 0) + t.points);
  return m;
}

/** One line saying what a person's score was built from, for the PDF. */
export function contributionDetail(
  method: ScoreMethod | null | undefined,
  e: { rating: number; hours: number; hour_weight: number },
  taskPoints: number,
): string {
  const h = `${e.hours} h x ${e.hour_weight}`;
  switch (method) {
    case "manual_rating":
      return `Rating ${e.rating}/10`;
    case "hours":
      return h;
    case "task_points":
      return `${taskPoints} done pts`;
    case "mix":
      return `Rating ${e.rating}, ${h}, ${taskPoints} pts`;
    default:
      return "";
  }
}

export function methodExplanation(method: ScoreMethod | null | undefined, mix: MixWeights): string {
  switch (method) {
    case "manual_rating":
      return "Scoring: Manual rating. Each person is rated 0-10; the share is their rating divided by the total of all ratings.";
    case "hours":
      return "Scoring: Hours worked. Hours multiplied by the role weight; the share is a person's weighted hours divided by the total.";
    case "task_points":
      return "Scoring: Task points. Only completed tasks count; the share is a person's completed points divided by all completed points.";
    case "mix":
      return `Scoring: Weighted mix. Rating ${mix.ratingBp / 100}%, hours ${mix.hoursBp / 100}%, task points ${mix.tasksBp / 100}%. Each part is compared as a percentage of the team total, then blended.`;
    default:
      return "";
  }
}
