import type { Config } from "tailwindcss";

/**
 * Design tokens transcribed from the "Ecosystem Visualization" direction.
 *
 *   primary  #E48B59   secondary/accent #ED7B46
 *   bg       #FDFDFD   surface (slate panels) #53617A
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
        // The page itself — a hair off white, so a `bg-white` card or input reads
        // as a surface lifted off the page rather than merging into it.
        //
        // Two places consume this and they are NOT redundant: `body`
        // (globals.css) paints the overscroll/rubber-band area, while
        // `AmbientBackground`'s `fixed inset-0` layer paints what you actually
        // see in the viewport. Changing one without the other seams on overscroll.
        bg: "#FDFDFD",
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
          soft: "#6A6A6A", // unused since "15 deaths." moved to `mute` in the mock-up
          line: "#D9D9D9", // hairlines, eliminated cells, the app-mark placeholder
          dark: "#A5ACAF", // the spec's "border-dark" — the picks hero's inert strips
          alive: "#FC855C", // living cells — not `brand`, and not the green `alive` hue
        },
        // "This is your selection", across both pick surfaces: the week strip's
        // filled chip (`bg-selected`) and the team grid's picked card
        // (`ring-selected`). One token for one meaning — a second green 6% away
        // with no difference of meaning is exactly the near-duplicate family the
        // comments here keep arguing against.
        //
        // No longer a bespoke hue. It takes the design library's
        // `Semantic/Success Green - Dark`, which is the same value `result.win`
        // below carries — deliberately, since the strip's filled chip and its
        // "you got through this week" ink are the same green by design. They
        // never co-occur on one chip: a selected chip's numeral takes the `-lit`
        // pair instead.
        //
        // Still deliberately NOT the `alive` hue below, despite both being
        // green: that family is desaturated on purpose so it reads as
        // instrumentation, and this is the opposite job — the one saturated,
        // decorative fill in the app, marking where you are on the week axis.
        selected: "#0C6F28",
        /**
         * The account page's buy-in badge, from the mock-ups' semantic ramp.
         * Each pair is a fill and the hairline that sits on it.
         *
         * Not folded into `alive` / `out` below: those are the standings
         * palette's softer, wash-backed status hues, and this badge is a
         * saturated solid with white text. Two things that mean different things
         * on different screens, kept apart on purpose.
         */
        badge: {
          paid: "#0F9900",
          "paid-line": "#0C6F28",
          due: "#CD1411",
          "due-line": "#A71930",
        },
        /**
         * Outcome ink for a played week on the week strip: what colour the
         * corner numeral takes once the picked team's game has gone final.
         *
         * `win` and `loss` are the same two hexes as `badge-paid-line` /
         * `badge-due-line` and are deliberately NOT aliased to them. Those are
         * hairlines under the account page's buy-in badge; these are text
         * reporting a result, and they are the design library's
         * `Semantic/Success Green - Dark` and `Semantic/Error Red - Dark` in
         * their own right. Retuning one family must not silently repaint the
         * other.
         *
         * The `-lit` pair has no counterpart anywhere else: the same two
         * semantics lifted to survive on the SELECTED chip's dark green fill,
         * where the dark pair would read as a smudge. Figma calls them
         * "-Extra Light".
         *
         * Not folded into `alive` / `out` either: those are the standings
         * palette's desaturated hues, painted as a wash BEHIND a logo. These are
         * saturated ink painted ON one.
         */
        result: {
          win: "#0C6F28", // Semantic/Success Green - Dark
          "win-lit": "#7BE170", // Semantic/Success Green - Extra Light
          loss: "#A71930", // Semantic/Error Red - Dark
          "loss-lit": "#F8787A", // Semantic/Error Red - Extra Light
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
        // The design system's `radius/medium`, named after it rather than after
        // a surface, because that is how the design refers to it. NOT `md`:
        // Tailwind already ships `rounded-md` at 6px and `WeekStrip` uses it, so
        // redefining that key would silently resize a control on the pick page.
        medium: "12px",
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
        // A whole panel height, not a card's 12px nudge. Paired with `scrim-in`
        // rather than fading itself: a sheet that slides AND fades reads as two
        // effects competing, so the scrim does all the fading.
        "drawer-up": {
          from: { transform: "translateY(100%)" },
          to: { transform: "translateY(0)" },
        },
        // The scrim used to borrow `reveal-up`, which starts at
        // translateY(12px) — so an `absolute inset-0` scrim sat 12px low for the
        // length of the animation, leaving the top 12px of the viewport
        // unscrimmed and unblurred. Invisible behind a 480px card; a bright band
        // across the top of the screen behind a full-bleed drawer.
        "scrim-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        // The exits. Separate keyframes rather than `animation-direction:
        // reverse`, because a reversed animation also reverses its easing curve
        // — the drawer would leave slowly and stop abruptly, which is backwards.
        "drawer-down": {
          from: { transform: "translateY(0)" },
          to: { transform: "translateY(100%)" },
        },
        "scrim-out": {
          from: { opacity: "1" },
          to: { opacity: "0" },
        },
        "reveal-mask": {
          from: { opacity: "0", clipPath: "inset(0 0 100% 0)" },
          to: { opacity: "1", clipPath: "inset(0 0 0 0)" },
        },
        // The per-element fade+blur used by `BlurReveal` — the landing title and
        // every piece of the My Picks hero. Distinct from `reveal-mask` above,
        // which wipes a whole box; this resolves one word, strip or logo in
        // place and is applied to dozens of elements at staggered delays.
        //
        // `blur(0)` rather than `none` in the `to` frame on purpose: `none` is
        // not a filter-function list, so the two frames would not interpolate
        // and the blur would snap off at the end instead of easing out.
        "blur-in": {
          from: { opacity: "0", filter: "blur(12px)", transform: "scale(1.04)" },
          to: { opacity: "1", filter: "blur(0)", transform: "scale(1)" },
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
        // 0.32s, not reveal-up's 0.5s: the travel is a full panel height rather
        // than 12px, and half a second of that reads as lag rather than grace.
        "drawer-up": "drawer-up 0.32s cubic-bezier(0.22,1,0.36,1) both",
        "scrim-in": "scrim-in 0.2s ease both",
        // 0.28s against the entrance's 0.32s. An exit that lingers as long as
        // the entrance reads as sluggish: nobody is waiting to look at the thing
        // they just dismissed.
        "drawer-down": "drawer-down 0.28s cubic-bezier(0.22,1,0.36,1) both",
        "scrim-out": "scrim-out 0.2s ease both",
        "reveal-mask": "reveal-mask 0.6s cubic-bezier(0.22,1,0.36,1) both",
        // 1250ms and a curve of its own — the app's other entrances use
        // cubic-bezier(0.22,1,0.36,1), and this one is flatter still at the
        // tail so a word is legible long before its animation formally ends.
        // The per-element delay is NOT here: it is inline, from `revealDelay`.
        "blur-in": "blur-in 1250ms cubic-bezier(0.16,1,0.3,1) both",
        "pulse-live": "pulse-live 1.6s ease-in-out infinite",
        drift: "drift 9s ease-in-out infinite",
        shimmer: "shimmer 1.6s infinite",
      },
    },
  },
  plugins: [],
};

export default config;
