/**
 * Focus-trap arithmetic for `Drawer`, kept pure so it can be tested.
 *
 * Same split as `tabs.ts` beside it: the DOM work lives in the component, the
 * decision lives here. There is no jsdom in this project — every test is a node
 * vitest run over a pure module — so anything not extracted like this is
 * untested by construction.
 */

/**
 * What counts as focusable for the trap.
 *
 * Deliberately does not try to be exhaustive (no `contenteditable`, no `audio
 * [controls]`): the drawer holds buttons, text inputs, radios, switches and one
 * `<select>`, and a selector that matches things this dialog cannot contain is a
 * selector nobody can verify.
 *
 * `:not([disabled])` matters more here than in most dialogs. The rules fieldset
 * disables its radios wholesale once the season starts, and a trap that treated
 * them as stops would park focus on controls that cannot be operated.
 */
export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Where Tab should move focus, or null to let the browser handle it.
 *
 * Null means "not ours — do not preventDefault", the same convention
 * `nextTabIndex` uses one file over, and it is load-bearing twice here. The tab
 * bar runs a roving tabindex, and the rules editor is a native radio group;
 * both implement their own Tab and arrow semantics, and a trap that intervened
 * on every keystroke would quietly break them. This fires only at the two ends
 * of the list, which is the only place a trap is needed.
 *
 * `current === -1` is focus sitting on the panel itself — it has `tabIndex={-1}`
 * so it is not in the list, and it is where every drawer opens. Tab from there
 * enters at the top, Shift+Tab at the bottom.
 *
 * Contrast `nextTabIndex`, which WRAPS because WAI-ARIA says a tablist wraps,
 * and `week-strip.ts`'s `nextIndex`, which CLAMPS. This wraps for the third
 * reason again: a modal dialog's focus must not escape to the page behind it.
 */
export function nextFocusIndex(current: number, length: number, back: boolean): number | null {
  if (length <= 0) return null;
  if (current === -1) return back ? length - 1 : 0;
  if (back && current === 0) return length - 1;
  if (!back && current === length - 1) return 0;
  return null;
}
