import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";
const KEY = "scaltrix-theme";

// index.html applies the saved theme before the first paint (no white flash),
// so the page itself is the source of truth at start-up.
let current: Theme =
  typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light";
const listeners = new Set<() => void>();

export function setTheme(t: Theme): void {
  current = t;
  document.documentElement.classList.toggle("dark", t === "dark");
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* private window or blocked storage: the choice just lasts until the app closes */
  }
  listeners.forEach((l) => l());
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => "light" as Theme,
  );
  return { theme, toggle: () => setTheme(theme === "dark" ? "light" : "dark") };
}
