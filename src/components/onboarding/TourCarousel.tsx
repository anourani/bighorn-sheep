"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { XIcon } from "@/components/icons";
import { FOCUSABLE_SELECTOR, nextFocusIndex } from "@/components/ui/drawer";
import { H4 } from "@/lib/type-scale";
import { cn } from "@/lib/cn";
import { TourArt } from "./TourArt";
import { clampStep, TOUR_STEP_COUNT, tourView, type TourStep } from "./tour-steps";

export type TourExit = "finished" | "skipped";

/**
 * The first-run tour: seven cards over a scrim, a bottom sheet on a phone and a
 * centred card from `sm`.
 *
 * **Why this is not `Modal`.** It is the same geometry and deliberately reuses
 * `Modal`'s class strings for the scrim and the panel, but `Modal`'s chrome is
 * wrong here in three ways that cannot be reached from a prop: its header
 * carries a `border-b` and renders `title` at 18px semibold ink (this design's
 * header is borderless, and its "title" is a 12px uppercase counter), and its
 * footer adds a `border-t` and its own padding where this one has neither.
 * Bending `Modal` for one caller would have changed all five of its existing
 * ones; `Drawer` is the other primitive and is full-bleed at every width, which
 * is the opposite of what a 480px desktop modal wants. A third surface, sharing
 * the tokens rather than the component, is the cheaper of the two mistakes.
 *
 * What it inherits from `Modal` regardless, because they are the same dialog
 * contract: Escape closes, the body scroll locks while it is open, the panel
 * takes focus on mount, and the scrim is a real `<button>` so a pointer user
 * can dismiss it without the click target being a `<div>` with a handler.
 *
 * **It also takes `Drawer`'s focus trap and focus restore, which `Modal` does
 * not have** — and the reason is this surface's alone rather than a general
 * preference. The page behind the first-run tour is the pick grid. A keyboard
 * user who tabs off the end of an untrapped dialog lands on a team card, and
 * activating one there spends that team for the season. The other dialogs in
 * this app sit over a roster or a settings list, where the same escape costs
 * nothing. `FOCUSABLE_SELECTOR` and `nextFocusIndex` come from `ui/drawer.ts`,
 * already pure and already tested, rather than being written again here.
 *
 * **It does not portal, and the caller must therefore not render it inside
 * `.stagger`.** `globals.css` gives every direct child of a `.stagger` root
 * `reveal-up ... both`, whose fill-mode leaves a transform applied for the life
 * of the page — and any non-`none` transform makes an element a containing
 * block for `position: fixed` descendants, which would pin this to a page block
 * instead of the viewport. Both call sites mount it outside that root, and
 * `MyPicksClient`'s own `PickStickyBar` carries the long version of this note.
 *
 * The entrance is two animations by breakpoint, matching the two presentations:
 * `drawer-up` slides the sheet a full panel height on a phone, and
 * `reveal-up`'s 12px fade is what a centred card should do instead of flying up
 * from the bottom of the screen. They land in different tailwind-merge groups
 * (`animate-*` and `sm:animate-*`), so both survive `cn()`.
 */
export function TourCarousel({
  open,
  ctaLabel,
  showSkip = true,
  onDone,
}: {
  open: boolean;
  /**
   * The last card's primary button. The tour hands off to the pick screen
   * ("Make my pick"); the account page's replay hands back ("Back to Account").
   */
  ctaLabel: string;
  showSkip?: boolean;
  /**
   * Called once, on the way out. `"finished"` means they reached the end and
   * took the CTA; `"skipped"` covers the X, the Skip link, Escape and the
   * scrim. Both callers treat the two the same — seeing the tour and declining
   * it are equally a decision — but the reason is passed so that stops being an
   * assumption baked into this component.
   */
  onDone: (reason: TourExit) => void;
}) {
  const [index, setIndex] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const returnRef = useRef<HTMLElement | null>(null);

  // Held in a ref so the effect below can depend on `open` alone. `onDone` is an
  // inline arrow at both call sites, so a new identity every render — in the
  // dependency array it would tear down and rebuild the scroll lock and the
  // Escape listener on every keystroke, and re-steal focus with them.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  // Reset to the first card whenever it reopens. `if (!open) return null` does
  // not unmount this component — the account page keeps it mounted so it can be
  // replayed — so without this a second viewing resumes on whichever card the
  // first one ended.
  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    // Captured before focus is stolen, so closing puts the caret back on the
    // Replay button that opened it.
    returnRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDoneRef.current("skipped");
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      // `isConnected` rather than a bare focus(): `completeTour` revalidates,
      // and focusing a node React has since replaced drops focus to <body>,
      // which is worse than not restoring at all.
      const back = returnRef.current;
      if (back?.isConnected) back.focus();
    };
  }, [open]);

  function onPanelKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;

    const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      // A cheap "not rendered" test, valid only because nothing inside this
      // panel is position: fixed — the same caveat `Drawer` states.
      (el) => el.offsetParent !== null,
    );
    const target = nextFocusIndex(
      nodes.indexOf(document.activeElement as HTMLElement),
      nodes.length,
      e.shiftKey,
    );
    // Null means the interior of the list, where the browser's own Tab is
    // correct. Calling preventDefault on every Tab would be the bug.
    if (target === null) return;
    e.preventDefault();
    nodes[target]?.focus();
  }

  if (!open) return null;

  const view = tourView(index, ctaLabel);

  const next = () => {
    if (view.isLast) onDone("finished");
    else setIndex((i) => clampStep(i + 1));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="How to play"
    >
      <button
        aria-label="Close the tour"
        tabIndex={-1}
        onClick={() => onDone("skipped")}
        className="absolute inset-0 cursor-default bg-ink/45 backdrop-blur-[2px] animate-scrim-in"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        onKeyDown={onPanelKeyDown}
        className={cn(
          "relative z-10 w-full max-w-app rounded-t-card bg-white shadow-lift outline-none",
          "sm:rounded-card",
          "animate-drawer-up sm:animate-reveal-up",
        )}
      >
        <div className="flex items-center justify-between gap-3 py-3.5 pl-6 pr-5">
          {/* "01 / 07" names nothing out loud, so the drawn form is hidden from
              the accessibility tree and a spoken one sits beside it — the same
              split `Headcount` makes for its "W6". */}
          <span
            aria-hidden="true"
            className="text-xs font-semibold uppercase leading-none tabular-nums text-shell-mute"
          >
            {view.counter}
          </span>
          <span className="sr-only">{`Step ${index + 1} of ${TOUR_STEP_COUNT}`}</span>
          <button
            type="button"
            onClick={() => onDone("skipped")}
            aria-label="Close the tour"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-control text-ink-mute transition-colors hover:bg-[#F1F2F5] hover:text-ink"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Fixed 180px, and the frame is `aria-hidden` because everything in it
            is a picture of a surface the copy below already names. */}
        <div
          aria-hidden="true"
          className="mx-5 flex h-[180px] items-center justify-center overflow-hidden rounded-medium border border-line bg-fill-raised"
        >
          <TourArt step={view.step} />
        </div>

        {/* Announced as one block, so stepping reads the new card rather than
            leaving the reader to discover it. Not the dialog's own label: that
            is stable ("How to play") so the dialog does not rename itself seven
            times. */}
        <div aria-live="polite" className="px-6 pb-1 pt-5">
          <h2 className={cn(H4, "truncate text-shell-ink")}>
            {view.step.title}
          </h2>
          {/* The 72px is FIXED and is the reason the sheet does not change
              height between cards — the PRD lists a stable height as an
              acceptance criterion, and the bodies run from 52 to 103
              characters. Do not let this become content-driven. */}
          <p className="mt-2 h-[72px] overflow-hidden text-[15px] leading-[1.55] text-ink-soft [text-wrap:pretty]">
            <Body body={view.step.body} />
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 px-6 pb-7 pt-4">
          {/* The dots yield first, and that is the whole reason they are the
              flexible half while the controls are `shrink-0`.

              On the last card this row carries its widest load — seven dots,
              "Not now", "Back" and the CTA — and at the design's own 393px
              frame that lands within a few pixels of the content width, close
              enough that a font metric decides it. Left to itself the row would
              push the CTA off the panel or wrap it, and wrapping would break the
              fixed height the 180px frame and 72px body exist to protect.
              Clipping a decorative dot is the cheapest of those three failures:
              the dots are `aria-hidden` and the header's counter already states
              the position in words. */}
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            {view.dots.map((on, i) => (
              <span
                key={i}
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-pill",
                  on ? "bg-accent" : "bg-shell-line",
                )}
              />
            ))}
          </div>
          {/* Null placeholders rather than `&&` short-circuits that vanish:
              these keep Next at a stable position in the children array, so
              gaining a Back button on card two does not remount Next and drop
              the focus of anyone stepping through on a keyboard. */}
          <div className="flex shrink-0 items-center gap-2">
            {showSkip ? (
              <button
                type="button"
                onClick={() => onDone("skipped")}
                className="inline-flex h-11 items-center whitespace-nowrap rounded-control px-3 text-sm font-medium text-ink-mute transition-colors hover:text-ink"
              >
                {view.skipLabel}
              </button>
            ) : null}
            {view.canBack ? (
              <button
                type="button"
                onClick={() => setIndex((i) => clampStep(i - 1))}
                className="inline-flex h-11 items-center whitespace-nowrap rounded-control border border-shell-line bg-white px-3.5 text-sm font-medium text-[#374151] transition-colors hover:bg-[#F6F7F9]"
              >
                Back
              </button>
            ) : null}
            <Button
              variant="primary"
              size="md"
              onClick={next}
              className="whitespace-nowrap px-[18px]"
            >
              {view.nextLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A step's body, which is usually a plain string and once is a run of segments.
 *
 * The struck segment is `aria-hidden`, so the sentence a screen reader hears is
 * the one without it — "Select the team you think is going to win". Struck text
 * is a visual joke, and read aloud it is simply a wrong sentence. `<s>` rather
 * than a `line-through` class because the element already carries that meaning,
 * and the class would leave the markup saying nothing.
 */
function Body({ body }: { body: TourStep["body"] }) {
  if (typeof body === "string") return <>{body}</>;
  return (
    <>
      {body.map((segment, i) =>
        segment.strike ? (
          <s key={i} aria-hidden="true">
            {segment.text}
          </s>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </>
  );
}
