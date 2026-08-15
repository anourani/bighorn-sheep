import type { Config } from "tailwindcss";

/**
 * Design tokens transcribed from the "Ecosystem Visualization" direction.
 *
 *   primary  #E48B59   secondary/accent #ED7B46
 *   bg       #FFFFFF   surface (slate panels) #53617A
 *   text     #111827 / #4B5563   border #D8DADF
 *   type     Inter throughout — display, body, and semibold labels/metrics
 *   radii    card 16 · control 8 · pill 9999
 *
 * The signature look is dark slate "data panels" floating on a white page,
 * lit by a warm orange accent — an operational dashboard aesthetic that maps
 * naturally onto live scores, standings, and metric tiles.
 *
 * Status hues (alive / out / live / strike) extend the base palette; they are
 * deliberately desaturated so they read as instrumentation, not decoration.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        bg: "#FFFFFF",
        line: "#D8DADF",
        // Warm accent — the single lit element on every panel.
        brand: {
          DEFAULT: "#E48B59",
          strong: "#ED7B46",
          soft: "#F4B48C",
          wash: "#FCEDE3",
        },
        // Near-black / grey ink used on the light page.
        ink: {
          DEFAULT: "#111827",
          soft: "#4B5563",
          mute: "#6B7280",
        },
        // Slate surfaces (the operational panels) + text that rides on them.
        surface: {
          DEFAULT: "#53617A",
          strong: "#454F63",
          deep: "#3A4356",
          muted: "#5E6C86",
          raised: "#64728C",
          line: "#6C7A93",
        },
        onsurface: {
          DEFAULT: "#F5F7FA",
          soft: "#C7CEDB",
          mute: "#9AA5B9",
        },
        // Inline text links. The only blue in the palette — deliberately not a
        // status hue, so it never competes with the orange accent.
        link: "#151E9D",
        // Neutral fills for flat cards and rows on the white page — the light
        // counterpart to the `surface` slate family. `soft` reads as a raised
        // tile against white (league cards, secondary buttons); `raised` is the
        // barely-there wash used for grouped setting rows.
        fill: {
          soft: "#F3F3F3",
          raised: "#FAFAFA",
        },
        // The design spec's own greys — the app shell (AppHeader,
        // LeagueStatusBar), every `Label` in the app, and the account page's
        // cards and rows.
        //
        // These are the design spec's PURE neutrals, deliberately a separate
        // family from `ink`/`line`: those are blue-tinted (#111827, #6B7280,
        // #D8DADF) and the difference is visible where the two meet at a 1px
        // border. Every other screen keeps the tinted family untouched.
        //
        // Named `shell` and NOT `neutral`: `extend.colors.neutral` silently
        // replaces Tailwind's built-in neutral-50..950 scale. (Safe either way
        // today — no neutral-*/zinc-*/stone-* class exists in src/ — but the
        // trap is worth not setting.)
        shell: {
          ink: "#1E1E1E", // app name, league name, "Week 6", chevron
          mute: "#757575", // the LEAGUE eyebrow, and every `Label` in the app
          soft: "#6A6A6A", // "15 deaths."
          line: "#D9D9D9", // hairlines, eliminated cells, the app-mark placeholder
          alive: "#FC855C", // living cells — not `brand`, and not the green `alive` hue
        },
        // Instrumentation status hues.
        alive: { DEFAULT: "#57A773", wash: "#E7F1EA" },
        out: { DEFAULT: "#D1495B", wash: "#F7E3E6" },
        live: { DEFAULT: "#ED7B46", wash: "#FBE9DE" },
        strike: { DEFAULT: "#E0A458", wash: "#FBF0DD" },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        // No `mono` override: the app ships one webfont (Inter). `font-mono` is
        // left to Tailwind's default system stack and is reserved for literal
        // machine strings — invite codes, invite links, error digests, timezone
        // IDs — where character alignment and 0/O disambiguation matter.
      },
      fontSize: {
        // display-lg token, plus a responsive step down for phones.
        "display-lg": ["clamp(2.5rem, 6vw, 4rem)", { lineHeight: "1.04", letterSpacing: "-0.02em", fontWeight: "500" }],
        "display-md": ["clamp(2rem, 5vw, 2.75rem)", { lineHeight: "1.06", letterSpacing: "-0.02em", fontWeight: "500" }],
        "display-sm": ["1.625rem", { lineHeight: "1.1", letterSpacing: "-0.015em", fontWeight: "500" }],
        // label-md token (semibold, technical metadata).
        "label-md": ["0.75rem", { lineHeight: "1.2", letterSpacing: "0.06em", fontWeight: "600" }],
        "label-sm": ["0.6875rem", { lineHeight: "1.2", letterSpacing: "0.08em", fontWeight: "600" }],
        // Oversized metric readout for stat tiles.
        metric: ["2.25rem", { lineHeight: "1.0", letterSpacing: "-0.02em", fontWeight: "600" }],
      },
      borderRadius: {
        card: "16px",
        control: "8px",
        pill: "9999px",
      },
      spacing: {
        card: "24px", // card-padding token
        section: "80px", // section-padding token
      },
      maxWidth: {
        app: "480px", // mobile-first single-column shell (modals, auth, narrow content)
        shell: "1000px", // widened app shell on desktop — responsive down to phones
        wide: "1120px",
      },
      boxShadow: {
        // Soft, layered depth for slate panels sitting on white.
        panel: "0 1px 2px rgba(17,24,39,0.04), 0 18px 40px -24px rgba(17,24,39,0.45)",
        "panel-sm": "0 1px 2px rgba(17,24,39,0.05), 0 8px 20px -14px rgba(17,24,39,0.35)",
        lift: "0 1px 2px rgba(17,24,39,0.06), 0 24px 48px -20px rgba(17,24,39,0.5)",
        glow: "0 0 0 1px rgba(237,123,70,0.35), 0 8px 28px -10px rgba(237,123,70,0.45)",
        inset: "inset 0 1px 0 rgba(255,255,255,0.06)",
      },
      backgroundImage: {
        "brand-sheen": "linear-gradient(135deg, #ED7B46 0%, #E48B59 100%)",
        "surface-sheen": "linear-gradient(160deg, #5E6C86 0%, #53617A 42%, #454F63 100%)",
        grid: "linear-gradient(rgba(108,122,147,0.14) 1px, transparent 1px), linear-gradient(90deg, rgba(108,122,147,0.14) 1px, transparent 1px)",
      },
      keyframes: {
        "reveal-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "reveal-mask": {
          from: { opacity: "0", clipPath: "inset(0 0 100% 0)" },
          to: { opacity: "1", clipPath: "inset(0 0 0 0)" },
        },
        "pulse-live": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.45", transform: "scale(0.85)" },
        },
        drift: {
          "0%, 100%": { transform: "translate3d(0,0,0)" },
          "50%": { transform: "translate3d(0,-14px,0)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "reveal-up": "reveal-up 0.5s cubic-bezier(0.22,1,0.36,1) both",
        "reveal-mask": "reveal-mask 0.6s cubic-bezier(0.22,1,0.36,1) both",
        "pulse-live": "pulse-live 1.6s ease-in-out infinite",
        drift: "drift 9s ease-in-out infinite",
        shimmer: "shimmer 1.6s infinite",
      },
    },
  },
  plugins: [],
};

export default config;
