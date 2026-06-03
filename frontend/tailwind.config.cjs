/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        accent: "#06b6d4",
        ink: "#0f172a",
        ink2: "#334155",
        ink3: "#64748b",
        ink4: "#94a3b8",
        hair: "#e2e8f0",
        bg: "#f8fafc",
      },
      borderRadius: {
        pill: "999px",
        md: "8px",
        sm: "6px",
      },
      fontFamily: {
        sans: ["Inter", "Hiragino Sans", "Meiryo", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
