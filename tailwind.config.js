/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { 50: "#eef2ff", 500: "#4f46e5", 600: "#4338ca", 700: "#3730a3" },
        // Page cards, sidebar and inputs. Changes with the theme (see src/index.css).
        surface: v("surface"),
        // The grey scale reads its values from CSS variables, so every existing
        // slate class flips automatically between light and dark.
        slate: {
          50: v("slate-50"),
          100: v("slate-100"),
          200: v("slate-200"),
          300: v("slate-300"),
          400: v("slate-400"),
          500: v("slate-500"),
          600: v("slate-600"),
          700: v("slate-700"),
          800: v("slate-800"),
          900: v("slate-900"),
        },
      },
    },
  },
  plugins: [],
};
