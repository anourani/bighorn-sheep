/**
 * The toast's lifecycle arithmetic, kept out of the component so it unit-tests
 * without a component-test stack — vitest runs in the Node environment here,
 * with no jsdom and no @testing-library. Same split `drawer.ts` and `tabs.ts`
 * make beside their own components.
 *
 * The component owns the side effects (the portal, the timer, the animationend
 * listener); this module only answers "what should be on screen, and for how
 * long".
 */

/** How long a toast stays up before it dismisses itself. */
export const TOAST_DURATION_MS = 5000;

/**
 * The exit animation's length, plus slack, used as the unmount backstop.
 *
 * Longer than the 0.28s `toast-out` runs for, on the same argument `Drawer`
 * makes: if `animationend` never arrives — a `display: none` ancestor, a
 * cancelled animation, a browser quirk — a toast stuck on screen forever is a
 * far worse failure than one that vanishes without animating.
 */
export const TOAST_EXIT_BACKSTOP_MS = 500;

export interface ToastMessage {
  /**
   * Distinguishes one toast from the next when the TEXT is identical.
   *
   * Releasing the same team from the same week twice running produces the same
   * sentence, and a component keyed on the string alone would not re-run its
   * entrance animation — the second release would look like nothing happened.
   */
  id: number;
  text: string;
}

/**
 * The sentence a released pick raises.
 *
 * Takes the week's LABEL rather than its number, so a practice release reads
 * "Preseason 2" rather than "Week 2" — `weekLabel` already knows the difference
 * and there is no second place here to get it wrong.
 */
export function releaseMessage(teamName: string, weekLabel: string): string {
  return `${teamName} deselected as ${weekLabel} pick.`;
}

/**
 * The next toast state for a raised message.
 *
 * A monotonic id rather than a random one: it is only ever compared for
 * inequality, and `Math.random()` in a render path is a hydration mismatch
 * waiting to happen.
 */
export function raiseToast(previous: ToastMessage | null, text: string): ToastMessage {
  return { id: (previous?.id ?? 0) + 1, text };
}
