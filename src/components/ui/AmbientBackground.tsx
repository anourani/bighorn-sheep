/**
 * Ambient, performant background layer: a warm orange bloom bleeding down from
 * the top and a faint technical grid that fades out — the "supporting layer
 * behind the content" the design direction calls for. CSS only, no canvas.
 */
export function AmbientBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-bg">
      <div className="absolute -top-40 left-1/2 h-[460px] w-[760px] -translate-x-1/2 rounded-full bg-brand/20 blur-[130px]" />
      <div className="absolute -top-24 right-[-6rem] h-[320px] w-[320px] rounded-full bg-brand-strong/10 blur-[110px]" />
      <div className="absolute inset-x-0 top-0 h-[380px] bg-grid opacity-[0.45] [background-size:34px_34px] [mask-image:linear-gradient(to_bottom,black,transparent)]" />
    </div>
  );
}
