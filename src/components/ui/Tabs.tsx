"use client";

import { useRef } from "react";
import { cn } from "@/lib/cn";
import { nextTabIndex, panelId, tabId } from "./tabs";

/**
 * A real tablist: roving focus, arrow keys, and panels wired both ways.
 *
 * Not built on `Segmented`, which looks the same and is imported by nothing.
 * `Segmented` puts `role="tablist"`/`role="tab"` on a plain value selector with
 * no panels at all, so bolting optional panel wiring onto it would leave every
 * other caller still claiming a role it doesn't fulfil, and would couple every
 * future segmented control to a concept it doesn't have. The visual treatment is
 * deliberately identical; the semantics are not.
 *
 * NOTHING HERE MAY SCROLL, and that has not changed. The bar is never
 * `overflow-x-auto` and panels carry no `max-h`/`overflow`; the containing
 * dialog owns the one scroller in the tree — `Modal`'s panel, or the body of
 * `Drawer`'s fixed-height panel — so a short tab doesn't scroll at all and a
 * long one scrolls as one dialog rather than trapping a scrollbar inside a tab.
 *
 * The bar being a plain flow child DID change, and only inside `Drawer`, where
 * the admin panel pins it in the sticky header. Sticky is a pin, not a scroll
 * region, so the invariant above is untouched — but the reason it used to be a
 * flow child is worth keeping: in a 480px modal the bar was never more than a
 * short scroll from the top of the viewport, so pinning it bought nothing and
 * cost vertical space. At 90dvh with a sixteen-row roster under it, it scrolls
 * out of sight and the tabs become unreachable without scrolling back. The
 * caller decides by wrapping; nothing in this file assumes either.
 */

export interface TabOption<T extends string> {
  value: T;
  label: React.ReactNode;
}

export function Tabs<T extends string>({
  options,
  value,
  onChange,
  idBase,
  label,
  className,
}: {
  options: TabOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Namespace for the tab/panel id pair. Must match the `TabPanel`s below it. */
  idBase: string;
  /** Accessible name for the tablist itself, e.g. "Group settings sections". */
  label: string;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = options.findIndex((o) => o.value === value);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const next = nextTabIndex(activeIndex, e.key, options.length);
    if (next === null) return;
    e.preventDefault();
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    // Selection follows focus, which is the WAI-ARIA default for a tablist whose
    // panels are cheap to render. Focus has to move too, or the roving
    // tabIndex leaves the keyboard stranded on the old tab.
    refs.current[next]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn("flex w-full rounded-control bg-[#EDEFF3] p-1", className)}
    >
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={tabId(idBase, o.value)}
            aria-controls={panelId(idBase, o.value)}
            aria-selected={active}
            // Roving: exactly one tab is in the page's tab order at a time, so
            // Tab enters the tablist once and then arrows move within it.
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex-1 whitespace-nowrap rounded-[6px] px-3 py-1.5 text-sm font-medium transition-colors",
              active ? "bg-white text-ink shadow-sm" : "text-ink-mute hover:text-ink",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The region a tab controls.
 *
 * Render only the active one rather than hiding the others: it keeps the panel's
 * height honest (so the modal is exactly as tall as what's on screen), and it
 * makes "fetch the feed status when the Data Feed tab opens" fall out of mount
 * rather than needing a visibility effect.
 */
export function TabPanel({
  idBase,
  value,
  children,
  className,
}: {
  idBase: string;
  value: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="tabpanel"
      id={panelId(idBase, value)}
      aria-labelledby={tabId(idBase, value)}
      // Focusable so a keyboard user can Tab from the bar straight into the
      // content, which is the point of aria-controls existing.
      tabIndex={0}
      className={cn("outline-none", className)}
    >
      {children}
    </div>
  );
}
