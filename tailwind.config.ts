import type { Config } from "tailwindcss";

/**
 * THE BRAND ACCENT, and the whole ramp below is derived from it.
 *
 * Change `ACCENT` and the status report's survivor bars, the week strip's
 * selected chip, the picked team card, every focus ring, the primary button's
 * sheen, the `live` status hue, the text selection colour and the PWA theme
 * colour all move together. That is the entire point of it: "the accent" used
 * to be three unrelated hexes under three unrelated names (`shell.alive`
 * #FC855C, `selected` #0C6F28, `brand.strong` #ED7B46) plus four hand-typed
 * ones in component files, so there was no single place to retune it and no way
 * to tell which orange a given surface had picked.
 *
 * It lives in `src/lib/accent.ts` rather than here because `layout.tsx` and
 * `global-error.tsx` need it too and cannot reach a Tailwind token — the first
 * is a metadata string, the second ships inline styles Tailwind never sees.
 * That module is a LEAF (one export, no imports), which is what makes it safe
 * for a config PostCSS loads at build time to depend on.
 */
import { ACCENT } from "./src/lib/accent";

/**
 * Design tokens transcribed from the "Ecosystem Visualization" direction.
 *
 *   accent   #FC5F38   (one const — see `ACCENT` above; the whole orange
 *                       ramp, the sheen and the glow are derived from it)
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
/**
 * Tint / shade / alpha helpers, so the ramp below is DERIVED rather than
 * transcribed. A transcribed ramp is exactly what made the old palette
 * impossible to retune: change the hue and the wash, the soft and the ink all
 * stay behind on the previous one, and nothing anywhere says so.
 *
 * Deliberately NOT `hexToRgb` from `src/components/picks/pick-hero.ts`, which
 * does the same arithmetic. This file is loaded by PostCSS at build time, and
 * that module pulls in app types and the team table with it — where
 * `src/lib/accent.ts` above is a bare string constant with no imports at all.
 *
 * `mix` is sRGB, matching `color-mix(in srgb, …)`. It runs here at build time
 * rather than in CSS so every token stays a plain hex — which is what keeps
 * Tailwind's `/opacity` modifier working on them (27 call sites in `src/` rely
 * on it) and costs no browser-support caveat.
 */
const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const mix = (hex: string, toward: string, amount: number): string => {
  // Destructured rather than `.map`ped over the pair: `noUncheckedIndexedAccess`
  // widens `to[i]` to `number | undefined`, and a tuple destructure does not.
  const [r, g, b] = rgb(hex);
  const [tr, tg, tb] = rgb(toward);
  const step = (from: number, to: number) =>
    Math.round(from + (to - from) * amount)
      .toString(16)
      .padStart(2, "0");
  return `#${step(r, tr)}${step(g, tg)}${step(b, tb)}`.toUpperCase();
};

/** Toward white — the light end of the ramp (`soft`, `wash`). */
const tint = (hex: string, amount: number) => mix(hex, "#FFFFFF", amount);
/** Toward black — accent-coloured ink dark enough to read on one of the washes. */
const shade = (hex: string, amount: number) => mix(hex, "#000000", amount);
/** For the `rgba()` slots inside `boxShadow`, which take no hex. */
const alpha = (hex: string, a: number) => `rgba(${rgb(hex).join(",")},${a})`;

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
        /**
         * THE accent, by its canonical name. Everything else orange in this
         * file is derived from `ACCENT`; this is the token to reach for in new
         * code, and the one the three "this is lit / this is yours" surfaces
         * use — the survivor bars, the week strip's selected chip and the
         * picked team card.
         *
         * `faded` is the design library's `Text Color/Accent faded`, whose
         * value is literally the accent with an alpha byte on it (`#fc5f3814`,
         * 0x14 = 20/255 ≈ 8%). Written as an 8-digit hex rather than as
         * `accent/8` so it is a TOKEN — one name to reuse, and it tracks the
         * accent for free.
         *
         * `ink` is the accent taken dark enough to set type in. It replaces
         * four hand-typed near-duplicates (#B85C2B, #C2551F, #8A4A24) that
         * lived in component files and followed no token at all — the exact
         * drift this whole block exists to end. 4.9:1 on `brand.wash`.
         */
        accent: {
          DEFAULT: ACCENT, // #FC5F38
          faded: `${ACCENT}14`, // #FC5F3814
          ink: shade(ACCENT, 0.3), // #B04327
        },
        /**
         * The accent's light ramp. Retained under the `brand` name because 39
         * call sites across login, buttons, modals and badges already spell it
         * that way, and Tailwind's JIT compiles a class it cannot find to
         * NOTHING — so a bulk rename is a silent-failure risk with no payoff
         * once the values already follow `ACCENT`.
         *
         * `strong` IS the accent. `DEFAULT` is a lighter step that exists so
         * `brand-sheen` stays an actual gradient rather than collapsing to a
         * flat fill.
         *
         * These are opaque mixes, NOT `accent/NN` opacity modifiers, and that
         * is load-bearing: `StandingsGrid` paints its STICKY name column with
         * `bg-brand-wash`, and a translucent value there lets the scrolling
         * rows show through it.
         */
        brand: {
          DEFAULT: tint(ACCENT, 0.18), // #FD7C5C — the sheen's light stop
          strong: ACCENT, // #FC5F38 — the accent itself
          soft: tint(ACCENT, 0.42), // #FDA28C
          wash: tint(ACCENT, 0.87), // #FFEAE5
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
        //
        // `mute` / `soft` / `faint` are NOT a monotonic scale, and the names do
        // not order them: `soft` #6A6A6A is the DARKEST of the three, `mute`
        // #757575 next, `faint` #858585 the lightest. Read the hex, not the name.
        shell: {
          ink: "#1E1E1E", // app name, league name, "Week 6", chevron
          mute: "#757575", // the LEAGUE eyebrow, and every `Label` in the app
          soft: "#6A6A6A", // unused since "15 deaths." moved to `mute` in the mock-up
          faint: "#858585", // the spec's tertiary text — an unselected filter option
          // unused since the Sort filter was removed — it was the only inert
          // control in the app, greyed on the matchup layout. Kept, like `soft`.
          disabled: "#BABABA",
          line: "#D9D9D9", // hairlines, eliminated cells, the app-mark placeholder
          dark: "#A5ACAF", // the spec's "border-dark" — the picks hero's inert strips
          // `alive` (#FC855C) lived here — the survivor strip's living cells,
          // a fourth orange that was neither `brand` nor the green `alive`
          // hue. It is `accent` now, which is what it always meant.
        },
        // `selected` (#0C6F28) lived here — "this is your selection" on both
        // pick surfaces. Both now take `accent`, which carries that meaning for
        // the whole app rather than for these two components, so a token whose
        // only job was to be shared by them has nothing left to say.

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
         * A settled week on the week strip: the ink its corner numeral takes,
         * and the fill its chip takes, once the picked team's game has gone
         * final. `WeekStrip`'s `CORNER_INK` and `CHIP_FILL` are the only
         * readers.
         *
         * `win` / `loss` are the same two hexes as `badge-paid-line` /
         * `badge-due-line`, and `*-fill-deep` the same two as `badge-paid` /
         * `badge-due`. None of the four is aliased to its twin, deliberately:
         * those are an account-page buy-in badge, these report a result on a
         * different screen, and retuning one family must not silently repaint
         * the other. The dark pair is the design library's
         * `Semantic/Success Green - Dark` / `Semantic/Error Red - Dark` in its
         * own right.
         *
         * #7BE170 is back, and this is NOT the move the note it replaced
         * forbids. It was `result.win-lit` — INK, lifted to stay legible on the
         * chip's old dark-GREEN fill, and it lost that argument the day the
         * fill became `accent`, where it reads 1.9:1. It returns as a FILL,
         * where being light is the whole point: the dark `win` numeral measures
         * 3.87:1 on it against 2.06:1 on accent. `-lit` stays retired and
         * `palette.test.ts` still asserts both keys are gone. Its partner
         * #F8787A does not come back at all — the spec's loss fill is #FC615F,
         * a different colour.
         *
         * Six-digit hexes, never eight. The alpha is a Tailwind `/opacity`
         * modifier at the call site, because the spec draws these at 60/50/40%.
         * `accent-faded`'s 8-digit spelling would make `/60` a silent no-op and
         * the chip would render fully saturated with nothing erroring anywhere.
         *
         * Not folded into `alive` / `out` either: those are the standings
         * palette's desaturated hues, painted as a wash BEHIND a logo. These
         * are saturated values painted under one and on one.
         */
        result: {
          win: "#0C6F28", // Semantic/Success Green - Dark
          loss: "#A71930", // Semantic/Error Red - Dark
          // The `-deep` pair is what hover tints — and, for loss, what REST
          // tints too. The spec tints the light green and the dark red, which
          // reads as a slip in its own table and is what the file draws.
          "win-fill": "#7BE170", // Semantic/Success Green - Extra Light
          "win-fill-deep": "#0F9900",
          "loss-fill": "#FC615F", // unbound in the library — a raw value
          "loss-fill-deep": "#CD1411",
        },
        // Instrumentation status hues.
        alive: { DEFAULT: "#57A773", wash: "#E7F1EA" },
        out: { DEFAULT: "#D1495B", wash: "#F7E3E6" },
        // `live` was #ED7B46 — `brand.strong`'s exact value under a second
        // name, so it was always the accent and now says so.
        live: { DEFAULT: ACCENT, wash: tint(ACCENT, 0.85) }, // #FC5F38 / #FFE7E1
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
        glow: `0 0 0 1px ${alpha(ACCENT, 0.35)}, 0 8px 28px -10px ${alpha(ACCENT, 0.45)}`,
        inset: "inset 0 1px 0 rgba(255,255,255,0.06)",
      },
      backgroundImage: {
        // Both stops off `ACCENT`, so the primary button and the app mark
        // follow a hue change too. The lighter stop is `brand.DEFAULT` — same
        // mix, restated rather than imported, because `theme()` is not
        // available this early in the config object.
        "brand-sheen": `linear-gradient(135deg, ${ACCENT} 0%, ${tint(ACCENT, 0.18)} 100%)`,
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
        // The toast. It fades as well as slides, unlike `drawer-up` — a drawer
        // has a scrim to do its fading, and a toast arriving over live page
        // content has nothing behind it, so a bare slide reads as a chunk of UI
        // being shoved in from the edge. The travel is short (12px, the same
        // nudge `reveal-up` uses) because it appears near where it starts.
        "toast-in": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "toast-out": {
          from: { opacity: "1", transform: "translateY(0)" },
          to: { opacity: "0", transform: "translateY(12px)" },
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
        // Same 0.32/0.28 in-then-out asymmetry as the drawer above, and for the
        // same reason: nobody is waiting to look at the thing they dismissed.
        "toast-in": "toast-in 0.32s cubic-bezier(0.22,1,0.36,1) both",
        "toast-out": "toast-out 0.28s cubic-bezier(0.22,1,0.36,1) both",
        "reveal-mask": "reveal-mask 0.6s cubic-bezier(0.22,1,0.36,1) both",
        // A curve of its own — the app's other entrances use
        // cubic-bezier(0.22,1,0.36,1), and this one is flatter still at the
        // tail so a word is legible long before its animation formally ends.
        // The per-element delay is NOT here: it is inline, from `revealDelay`.
        //
        // The duration is a custom property so a surface can set its own pace
        // on its own root and have every piece under it inherit — `PickHero`
        // uses `[--blur-ms:650ms]`, because a module you re-form on every tap
        // wants to be quicker than a title you look at once. A prop would have
        // had to be threaded through a dozen call sites; a property inherits.
        // It goes inside the shorthand rather than a second `animation-duration`
        // declaration so there is only ever one rule, and no question of which
        // of the two wins. The fallback is `BLUR_DURATION_MS`.
        "blur-in": "blur-in var(--blur-ms,1250ms) cubic-bezier(0.16,1,0.3,1) both",
        "pulse-live": "pulse-live 1.6s ease-in-out infinite",
        drift: "drift 9s ease-in-out infinite",
        shimmer: "shimmer 1.6s infinite",
      },
    },
  },
  plugins: [],
};

export default config;
