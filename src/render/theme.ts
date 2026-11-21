export type ThemeName = "dark" | "light";

/** Colors the canvas code needs; the DOM takes its colors from CSS variables. */
export interface Theme {
  name: ThemeName;
  bg: string;
  text: string;
  /** Label color of molecules outside the top families. */
  other: string;
  /**
   * "Color by family" hues, in order of rank. Checked all-pairs against the
   * background for normal vision and color blindness; the label text itself
   * identifies each molecule, so color is never the only cue.
   */
  families: readonly string[];
  wall: string;
  hover: string;
  /** Sparkline baseline and hover rule. */
  grid: string;
  gridStrong: string;
  /** How halos and flashes combine with the soup: additive on dark, multiply on light. */
  glow: GlobalCompositeOperation;
  halo: readonly [number, string][];
  flash: readonly [number, string][];
}

export const THEMES: Record<ThemeName, Theme> = {
  dark: {
    name: "dark",
    bg: "#06080d",
    text: "rgba(214, 222, 235, 0.86)",
    other: "rgba(214, 222, 235, 0.42)",
    families: ["#5aa9ff", "#ff8a3d", "#3fd0a0", "#ffd84a", "#e07ad8"],
    wall: "rgba(120, 220, 255, 0.28)",
    hover: "rgba(120, 220, 255, 0.7)",
    grid: "rgba(255, 255, 255, 0.1)",
    gridStrong: "rgba(255, 255, 255, 0.25)",
    glow: "lighter",
    halo: [
      [0, "rgba(120, 220, 255, 0.9)"],
      [0.5, "rgba(80, 180, 255, 0.35)"],
      [1, "rgba(60, 140, 255, 0)"],
    ],
    flash: [
      [0, "rgba(255, 255, 240, 1)"],
      [0.15, "rgba(255, 220, 140, 0.85)"],
      [0.45, "rgba(255, 140, 60, 0.25)"],
      [1, "rgba(255, 80, 40, 0)"],
    ],
  },
  light: {
    name: "light",
    bg: "#f5f3ee",
    text: "rgba(26, 32, 44, 0.88)",
    other: "rgba(26, 32, 44, 0.4)",
    families: ["#1f6fd1", "#d0580a", "#0c8a63", "#a67a00", "#b03aa0"],
    wall: "rgba(0, 120, 170, 0.35)",
    hover: "rgba(0, 120, 170, 0.75)",
    grid: "rgba(0, 0, 0, 0.12)",
    gridStrong: "rgba(0, 0, 0, 0.3)",
    glow: "multiply",
    halo: [
      [0, "rgba(90, 190, 240, 0.75)"],
      [0.5, "rgba(120, 200, 245, 0.3)"],
      [1, "rgba(150, 210, 250, 0)"],
    ],
    flash: [
      [0, "rgba(255, 150, 40, 0.75)"],
      [0.2, "rgba(255, 175, 80, 0.55)"],
      [0.5, "rgba(255, 200, 130, 0.2)"],
      [1, "rgba(255, 220, 170, 0)"],
    ],
  },
};

const STORAGE_KEY = "algochem-theme";

/** The current theme. Read it at draw time; it changes with setTheme. */
export let theme: Theme = THEMES[initialTheme()];
document.documentElement.dataset.theme = theme.name;

/** Switch theme and remember the choice. Canvas users must redraw their caches. */
export function setTheme(name: ThemeName): void {
  theme = THEMES[name];
  document.documentElement.dataset.theme = name;
  try {
    localStorage.setItem(STORAGE_KEY, name);
  } catch {
    // storage unavailable (private mode): the choice just isn't remembered
  }
}

function initialTheme(): ThemeName {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
