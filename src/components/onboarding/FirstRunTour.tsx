"use client";

import { useRef, useState } from "react";
import { completeTour } from "@/app/app/actions";
import { isStaleDeploymentError, reloadOnce } from "@/lib/deploy-skew";
import { TourCarousel, type TourExit } from "./TourCarousel";

/**
 * Fires the tour once, for a player who has not seen it.
 *
 * The decision is the SERVER's — `viewerTourCompleted()` reads
 * `profiles.tour_completed_at` and this component only renders what it is told,
 * so a second device does not replay the tour and a reload mid-tour does not
 * count as having seen it. `completed` therefore seeds the open state rather
 * than gating the render: once someone dismisses it the state goes false
 * locally, and the revalidate that follows makes the server agree.
 *
 * Writing on BOTH exits — finished and skipped — is deliberate. Skipping is a
 * decision about the tour, not a deferral of it, and the design says so twice:
 * the last card's Skip reads "Not now", and the account page carries a permanent
 * "Replay the Tour" row precisely so that dismissing this costs nothing. A tour
 * that came back until you sat through it would be the version of this feature
 * people disable.
 *
 * The close is optimistic and the write is not awaited for it. If the write
 * fails the tour returns on the next load, which is the honest failure: the
 * database genuinely does not know they saw it. Nothing is said to the player
 * either way — there is no useful action for them to take, and an error toast
 * over a dismissed tour is noise about the app's own bookkeeping.
 */
export function FirstRunTour({ completed }: { completed: boolean }) {
  const [open, setOpen] = useState(!completed);
  // React 18+ can invoke an event handler's effects twice in development, and a
  // fast double-tap on the CTA is a real second call — neither should send two
  // writes for one decision.
  const wrote = useRef(false);

  async function finish(_reason: TourExit) {
    setOpen(false);
    if (wrote.current) return;
    wrote.current = true;
    try {
      await completeTour();
    } catch (err) {
      // A deploy landed while this tab sat on the tour. Reloading lands them on
      // the new build, where the tour fires again and the write can succeed.
      if (isStaleDeploymentError(err) && reloadOnce()) return;
      console.error("[FirstRunTour] could not record completion", err);
    }
  }

  return (
    <TourCarousel open={open} ctaLabel="Make my pick" onDone={finish} />
  );
}
