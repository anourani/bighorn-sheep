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
 * Some assets carry it BY HAND and cannot import this. `src/lib/palette.test.ts`
 * fails on each of them if the value moves, so the suite names what is stale.
 *
 *   - `public/manifest.webmanifest` — `theme_color`.
 *   - `public/icons/icon.svg` — the app mark. Its gradient stops mirror
 *     `bg-brand-sheen`: this value, then its 18% tint toward white
 *     (`brand.DEFAULT`); the tick takes this value straight. Used only as the
 *     browser favicon — the in-app mark is `BrandMark.tsx`, a `bg-brand-sheen`
 *     gradient that follows the token on its own.
 *   - `public/icons/icon-maskable.svg` — the same art squared off (no corner
 *     radius) with the shield inset into a maskable icon's safe zone.
 *
 * Five rasters are RENDERED from those two SVGs and must be regenerated with
 * them — they are not separate artwork:
 *
 *   from `icon.svg`          → `public/favicon.ico` (48, a PNG despite the
 *                              extension), `icons/icon-192.png`,
 *                              `icons/icon-512.png`
 *   from `icon-maskable.svg` → `icons/maskable-512.png`,
 *                              `icons/apple-touch-icon.png` (180, no alpha)
 *
 * There is no rasterizer in this project's dependencies, so regeneration is
 * manual: render each SVG at 4x into a transparent PNG (headless Chromium's
 * `--screenshot` does it) and downscale with a Lanczos filter. Rendering at 4x
 * and downscaling measured better on edge quality than rendering at the target
 * size directly.
 *
 * `#FC5F38` is the design library's `Text Color/Accent`.
 */
export const ACCENT = "#FC5F38";
