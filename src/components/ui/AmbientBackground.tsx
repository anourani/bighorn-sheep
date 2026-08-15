/**
 * Ambient background layer: a faint technical grid over the page colour, fading
 * out down the viewport — the "supporting layer behind the content" the design
 * direction calls for. CSS only: two 1px line-gradients on a 34px tile (the
 * `grid` token in tailwind.config.ts), no canvas and no image asset.
 *
 * It is `fixed`, so the falloff is a viewport vignette that stays put while the
 * page scrolls, rather than a gradient tied to document height.
 */
export function AmbientBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-bg">
      <div className="absolute inset-0 bg-grid opacity-[0.45] [background-size:34px_34px] [mask-image:linear-gradient(to_bottom,black,transparent)]" />
    </div>
  );
}
