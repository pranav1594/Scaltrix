import { SCORE_METHODS, type MixWeights, type ScoreMethod } from "../engine";
import NumberInput from "./NumberInput";

/** The four scoring systems as pick-one cards, each saying how it works. */
export function MethodCards({ value, onChange, disabled }: { value: ScoreMethod | null; onChange: (m: ScoreMethod) => void; disabled?: boolean }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {SCORE_METHODS.map((m) => (
        <label
          key={m.value}
          className={`cursor-pointer rounded-lg border p-3 text-sm ${
            value === m.value ? "border-brand-600 bg-brand-50 dark:bg-slate-800" : "border-slate-200"
          } ${disabled ? "opacity-60" : ""}`}
        >
          <input type="radio" className="mr-2" disabled={disabled} checked={value === m.value} onChange={() => onChange(m.value)} />
          <b>{m.label}</b>
          <div className="mt-1 text-xs text-slate-500">{m.blurb}</div>
        </label>
      ))}
    </div>
  );
}

/** Percentages for the weighted mix. Must total 100. */
export function MixEditor({ value, onChange }: { value: MixWeights; onChange: (m: MixWeights) => void }) {
  const total = value.ratingBp + value.hoursBp + value.tasksBp;
  const field = (label: string, key: keyof MixWeights) => (
    <label className="text-xs text-slate-500">
      {label} %
      <NumberInput
        className="input mt-1 w-24"
        min={0}
        max={100}
        step={5}
        value={value[key] / 100}
        onChange={(n) => onChange({ ...value, [key]: Math.round(Math.max(0, n) * 100) })}
      />
    </label>
  );
  return (
    <div className="mt-2 flex flex-wrap items-end gap-3">
      {field("Rating", "ratingBp")}
      {field("Hours", "hoursBp")}
      {field("Task points", "tasksBp")}
      <span className={`pb-2 text-xs ${total === 10000 ? "text-green-700" : "text-red-600"}`}>
        Total {total / 100}% {total === 10000 ? "" : "(must be 100%)"}
      </span>
    </div>
  );
}
