/**
 * THE BRAND ACCENT — one hex, and every orange in the app comes off it.
 *
 * This module exists so the value is reachable from BOTH sides of the build:
 * `tailwind.config.ts` derives the whole orange ramp from it (see the comment
 * there), and the two places Tailwind cannot reach — the PWA theme colour in
 * `app/layout.tsx` and `global-error.tsx`, which ships its own `<html>`/`<body>`
 * with inline styles — import it directly.
 *
 * Deliberately a LEAF: no imports, no types, nothing but the string. The
 * Tailwind config is loaded by PostCSS at build time, so anything this file
 * pulled in would be dragged into the build with it.
 *
 * Two static assets carry it by hand and CANNOT import this — update them in
 * the same commit if you change the value:
 *   - `public/manifest.webmanifest` (`theme_color`)
 *   - `public/icons/icon.svg` (the app mark's gradient stops, which mirror
 *     `bg-brand-sheen`: this value, then its 18% tint toward white)
 *
 * `#FC5F38` is the design library's `Text Color/Accent`.
 */
export const ACCENT = "#FC5F38";
