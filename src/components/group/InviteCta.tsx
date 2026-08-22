"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { LocalTime } from "@/components/ui/LocalTime";
import { isEntryOpen } from "@/lib/game/season";
import { countNoun } from "@/lib/league/view";
import type { Group } from "@/lib/league/types";

/**
 * Recruitment CTA. Hidden once entry closes at the first Week 1 kickoff — the
 * invite code still exists but `join_by_invite` will refuse it, so offering it
 * would be a dead end.
 *
 * Built to the Figma "Grow-the-League Module": a heading with the headcount
 * beside it, then a card carrying the league's photo, the deadline set large,
 * and one button. It turns over at `lg` like every other module in the app —
 * a 133px photo in a row on a desktop, a full-bleed square above stacked copy
 * on a phone.
 */
export function InviteCta({
  group,
  memberCount,
  appUrl,
  now,
}: {
  group: Group;
  /** `members.length`, NOT `survivorCounts().total` — that one is deliberately
   *  `alive + eliminated` and drops a row with an unrecognised status, which is
   *  right for a survivor tally and wrong for a headcount. */
  memberCount: number;
  appUrl: string;
  now: Date;
}) {
  const [copied, setCopied] = useState(false);
  // The invite code is not on screen any more — the design is a bare "Copy
  // Link" button. So a blocked clipboard would leave a member with no way at
  // all to get the invite, where the old card's `<code>` block was always there
  // to read off. This reveals the code on that failure and only on it.
  const [failed, setFailed] = useState(false);

  async function copy() {
    // `appUrl` is inlined at build time and is deliberately unset outside
    // production, so it is often "" — building the link from it raw produced a
    // relative `/login?invite=...`, which is not a link anyone can paste.
    //
    // Resolved here rather than in render, unlike `AdminSettingsDrawer`: that
    // modal never renders on the server (`open` starts false), but this CTA
    // does, so reading `window` in the render body would break the server pass.
    // A handler only ever runs in the browser, and nothing renders the link
    // itself, so there is no hydration concern either.
    const origin = appUrl || window.location.origin;
    try {
      await navigator.clipboard.writeText(`${origin}/login?invite=${group.inviteCode}`);
      setCopied(true);
      setFailed(false);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setFailed(true);
    }
  }

  if (!isEntryOpen(new Date(group.entryClosesAt), now)) return null;

  return (
    <section className="flex flex-col gap-3">
      {/* A bare `h2` and a sibling span rather than `SectionHeader`: that
          component's `h2` is `flex-1`, which pushes its `right` slot to the far
          edge of the row, and the design sits the count 12px from the title.
          Same call `account/surfaces.tsx` makes, for the same reason.

          The title's four classes are character-for-character that file's
          `HEADING` (the design library's UNIVERSAL H5). Spelled out here rather
          than imported: `surfaces.tsx` is documented as the ACCOUNT page's
          vocabulary, and a `group/ -> account/` import would quietly promote it
          into something shared without saying so.

          Tracking comes off Figma's percent-times-100 — H5's `-4` is -4%, which
          is -0.8px at 20px, and the 18px line's `-1` is -0.18px. Transcribing
          those as pixels is how a headline ends up four times too tight. */}
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-[20px] font-semibold leading-[1.2] tracking-[-0.8px] text-shell-ink">
          Grow the League
        </h2>
        <span className="text-[18px] leading-[1.4] tracking-[-0.18px] text-shell-mute">
          {countNoun(memberCount, "member")}
        </span>
      </div>

      {/* A plain div, NOT `Panel`. Its `light` tone is wrong in three ways at
          once and only two of them are fixable from a call site: `rounded-card`
          is 16px where this is 12, `border-line` is the blue-tinted #D8DADF
          where the design wants #D9D9D9 — and `shadow-panel-sm` CANNOT be taken
          off, because tailwind-merge does not parse `panel-sm` as a shadow size,
          so `shadow-none` never displaces it and the extended utility wins on
          source order. `spec.ts` documents that trap at length. This design has
          no shadow. */}
      <div className="flex flex-col gap-5 rounded-medium border border-shell-line bg-white px-4 pb-6 pt-4 lg:flex-row lg:items-center lg:gap-6 lg:py-2 lg:pl-2 lg:pr-4">
        {/* `shrink-0` is the load-bearing class here, not `max-w-none`. The
            text column beside this is `lg:flex-1`, i.e. `flex-basis: 0` and so
            a scaled shrink weight of zero — without `shrink-0` every pixel of
            overflow would come out of the PHOTO rather than the copy.

            `max-w-none` is prophylaxis and is MEASURED not to bind today: at
            `lg` preflight's `img { max-width: 100% }` resolves against the
            card's 942px content box, nowhere near 133, and below `lg` it equals
            the `w-full` it is capping. Removing it renders identically at both
            widths (checked). It stays because CLAUDE.md's rule is that no call
            site should be able to hit that clamp — the AppHeader mark drew 47x50
            and the PickHero logo 80-at-50 before anyone measured them — but the
            honest reason is "so this can never start binding", not "it does".

            `bg-shell-line` so a missing file degrades to the design's own grey
            square with no layout shift, matching AppHeader and LandingHeader.
            `width`/`height` are the asset's own 644, reserving the 1:1 box
            before the CSS lands. `lazy`/`async` because this is the last block
            on a long page and nothing above it waits on these bytes.

            Under `public/icons/` and not `public/images/` on purpose: the
            service worker's runtime cache accepts only `/_next/static/` and
            `/icons/`, so anywhere else would refetch every load and go missing
            offline. `public/icons/animals/README.md` states the rule, and
            `invite-asset.test.ts` guards both facts. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- no next/image anywhere in this app; a plain img avoids the loader config for one static asset */}
        <img
          src="/icons/grow-the-league.webp"
          alt=""
          width={644}
          height={644}
          loading="lazy"
          decoding="async"
          className="aspect-square max-h-[420px] w-full max-w-none shrink-0 rounded-control bg-shell-line object-cover lg:max-h-none lg:h-[133px] lg:w-[133px] lg:rounded-[4px]"
        />

        <div className="flex flex-col gap-1 lg:min-w-0 lg:flex-1">
          <p className="text-[18px] leading-[1.4] tracking-[-0.18px] text-shell-ink">
            Share the invite link before Week 1 kicks off on
          </p>
          {/* `LocalTime` rather than a formatter called here: this card
              server-renders (Standings is `ƒ`), and a raw `toLocaleString`
              would hydrate to a different string in every timezone but the
              server's. It ships US-Eastern and swaps to the reader's zone after
              mount.

              `weekdayordinal` is a DATE with no clock, which is what the design
              shows. One consequence worth knowing: with the time gone, a reader
              far enough east of the server sees the CALENDAR DAY change at that
              swap rather than just the hour — a Thursday-night kickoff is
              already Friday in Tokyo. `formatDate` behaves the same way and has
              a test pinning it, so this is the codebase's existing bargain
              rather than a new one. */}
          <p className="text-[24px] font-semibold leading-[1.2] tracking-[-0.96px] text-shell-ink">
            <LocalTime iso={group.entryClosesAt} mode="weekdayordinal" />
          </p>
          {/* Inside the text column, not appended to the card: from `lg` the
              card is a flex ROW, so a sibling of the button would become a
              fourth item squeezed beside it. Here it flows under the date at
              both widths, and the row grows to fit — which is the right
              trade for a state that only appears when the copy failed. */}
          {failed ? (
            <p role="status" className="text-[14px]/[1.35] text-shell-mute">
              Couldn&rsquo;t reach the clipboard. Your invite code is{" "}
              <span className="font-mono font-semibold text-shell-ink">{group.inviteCode}</span>.
            </p>
          ) : null}
        </div>

        {/* The `dark` variant, not `ghost` + `SPEC_BUTTON_DARK`: that constant
            is the older workaround for `primary` being unrepaintable, and it
            also hardcodes 16px. `size="lg"` already carries the design's own
            numbers — `h-12` is its 48px height and `rounded-control` its 8px.

            `text-[18px]` and `px-3` displace `text-base`/`px-5` cleanly because
            both are groups tailwind-merge recognises. The height must NOT be
            re-expressed as padding: `p-3` lands in a different group from
            `h-12`, so the height would win and the padding would sit inert.

            Text-only, no icon — the design has none, and `MoreSection` already
            made this call for this exact label: the label swap is the whole
            confirmation. */}
        {/* No `aria-label`. One would OVERRIDE these children, so the
            Copied/Copy Link swap — which is the whole confirmation — would
            never be announced; and "Copy invite link" does not contain the
            visible "Copy Link" as a substring, which fails WCAG 2.5.3 Label in
            Name for anyone driving the page by voice. The visible label under
            an <h2>Grow the League</h2> is name enough. */}
        <Button
          variant="dark"
          size="lg"
          className="w-full px-3 text-[18px] lg:w-auto"
          onClick={copy}
        >
          {copied ? "Copied" : "Copy Link"}
        </Button>
      </div>
    </section>
  );
}
