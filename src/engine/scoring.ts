/**
 * Four contribution-scoring systems. Each project picks ONE.
 * Every system turns per-person inputs into a score; shares are score / total score.
 *
 *  manual_rating : a 0-10 rating you give each person.         share = rating / sum(ratings)
 *  hours         : hours worked x a role multiplier.           share = (hours x multiplier) / sum
 *  task_points   : points of the tasks the person COMPLETED.   share = done points / sum
 *  mix           : blends the three above by percentages.      share = w1*rating% + w2*hours% + w3*tasks%
 *
 * "mix" compares people on percentages (not raw numbers), so ratings, hours and
 * points can be on completely different scales. A component nobody has data for
 * is dropped and the remaining weights are re-normalised (reported in `notes`).
 */
export type ScoreMethod = "manual_rating" | "hours" | "task_points" | "mix";

export const SCORE_METHODS: { value: ScoreMethod; label: string; blurb: string }[] = [
  { value: "manual_rating", label: "Manual rating", blurb: "You rate each person 0-10. Share = rating / total of all ratings." },
  { value: "hours", label: "Hours worked", blurb: "Hours x role multiplier (1 = normal, 1.5 = senior). Share = weighted hours / total." },
  { value: "task_points", label: "Task points", blurb: "Only COMPLETED tasks count. Share = person's done points / all done points." },
  { value: "mix", label: "Weighted mix", blurb: "Blend of rating, hours and task points by percentages you choose." },
];

export interface MixWeights {
  ratingBp: number;
  hoursBp: number;
  tasksBp: number;
}
export const DEFAULT_MIX: MixWeights = { ratingBp: 4000, hoursBp: 4000, tasksBp: 2000 };

export interface PersonInputs {
  id: string;
  rating: number; // 0-10
  hours: number;
  hourWeight: number; // role multiplier, default 1
  taskPoints: number; // points of COMPLETED tasks
}

export interface ScoreResult {
  /** Same order as the input. Only the ratios matter. */
  scores: number[];
  notes: string[];
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

export function computeScores(method: ScoreMethod, people: PersonInputs[], mix: MixWeights = DEFAULT_MIX): ScoreResult {
  const notes: string[] = [];
  const rating = people.map((p) => Math.max(0, p.rating));
  const hours = people.map((p) => Math.max(0, p.hours) * Math.max(0, p.hourWeight));
  const tasks = people.map((p) => Math.max(0, p.taskPoints));

  switch (method) {
    case "manual_rating":
      return { scores: rating, notes };
    case "hours":
      return { scores: hours, notes };
    case "task_points":
      if (people.length > 0 && sum(tasks) === 0) notes.push("No completed tasks yet, so no task points to share.");
      return { scores: tasks, notes };
    case "mix": {
      const parts: { name: string; w: number; v: number[] }[] = [
        { name: "rating", w: mix.ratingBp, v: rating },
        { name: "hours", w: mix.hoursBp, v: hours },
        { name: "task points", w: mix.tasksBp, v: tasks },
      ];
      const active = parts.filter((p) => p.w > 0 && sum(p.v) > 0);
      for (const p of parts) {
        if (p.w > 0 && sum(p.v) === 0) notes.push(`No ${p.name} entered, so its ${p.w / 100}% was spread over the others.`);
      }
      const wTotal = sum(active.map((p) => p.w));
      if (wTotal === 0) return { scores: people.map(() => 0), notes };
      const scores = people.map((_, i) => sum(active.map((p) => (p.w / wTotal) * (p.v[i] / sum(p.v)) * 100)));
      return { scores, notes };
    }
  }
}

/** Percent share per person (for display). */
export function sharesFromScores(scores: number[]): number[] {
  const t = sum(scores);
  return scores.map((s) => (t > 0 ? (s / t) * 100 : 0));
}
