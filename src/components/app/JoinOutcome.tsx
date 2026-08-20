"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { joinGroup, selectLeague } from "@/app/app/actions";
import { isStaleDeploymentError, reloadOnce } from "@/lib/deploy-skew";
import { JOIN_NOTICE_FALLBACK, joinNoticeCopy } from "@/lib/league/join";
import { CheckIcon, InfoIcon } from "@/components/icons";

/**
 * What happened to the invite you just followed — the /app end of both invite
 * paths that do not go through the login screen.
 *
 * Two params land here and they are two halves of one story:
 *
 *   ?invite=CODE   a signed-in visitor followed an invite link. `middleware.ts`
 *                  bounces them off /login before the page renders, so nothing
 *                  in the sign-in flow ever sees the code — this is the only
 *                  place left that can act on it. Previously it was dropped and
 *                  the link silently did nothing.
 *
 *   ?notice=REASON /auth/callback signed them in and THEN failed to join them.
 *                  It cannot report that on /login, because the session it just
 *                  created gets them redirected straight back off it. See
 *                  `failAfterSignIn` there.
 *
 * Both end in the same banner, because from the reader's side they are the same
 * event: "I followed an invite; where am I?" Renders null when neither param is
 * present, which is almost every load of this page.
 */
export function JoinOutcome({
  invite,
  notice,
}: {
  invite: string | null;
  notice: string | null;
}) {
  const router = useRouter();

  // Derived from props in the initializer rather than an effect: both values
  // come from the server, so the first client render matches the server's and
  // there is no hydration mismatch — and a notice that only appeared after an
  // effect would flash the page without it first.
  const [outcome, setOutcome] = useState<Outcome | null>(() =>
    invite
      ? { kind: "joining" }
      : notice
        ? { kind: "failed", message: joinNoticeCopy(notice) }
        : null,
  );

  // Strip both params on mount. Neither survives a reload as anything but a
  // replay: `?invite=` would re-run the join (harmless — join_by_invite is
  // idempotent — but the banner would reappear days later), and `?notice=`
  // would re-report a failure that is over. `replaceState` rather than
  // router.replace: this is cosmetic, and a real navigation would remount the
  // tree mid-join.
  useEffect(() => {
    if (!invite && !notice) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("invite");
    url.searchParams.delete("notice");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, [invite, notice]);

  // The join itself. `ran` guards it, not the dependency array: React re-invokes
  // effects in StrictMode, and `router.refresh()` below re-renders this subtree
  // with the same props — either would otherwise fire a second join.
  const ran = useRef(false);
  useEffect(() => {
    if (!invite || ran.current) return;
    ran.current = true;

    (async () => {
      try {
        const res = await joinGroup(invite);
        if (!res.ok) {
          // Notice copy, not the code-box copy: this reader is already signed
          // in and is not looking at a field to correct.
          setOutcome({ kind: "failed", message: joinNoticeCopy(res.error) });
          return;
        }
        setOutcome({ kind: "joined", name: res.data?.groupName ?? "" });

        // Land them in the league they followed a link for. Without this a
        // member of another league joins the new one and keeps looking at the
        // old one, because the active league is a cookie that nothing has
        // touched. A no-op while there is only one league; not a no-op the day
        // there are two.
        if (res.data) await selectLeague(res.data.groupId);
        router.refresh();
      } catch (err) {
        // A deploy landed while this tab was open — reload onto the new build.
        if (isStaleDeploymentError(err) && reloadOnce()) return;
        setOutcome({ kind: "failed", message: JOIN_NOTICE_FALLBACK });
      }
    })();
  }, [invite, router]);

  if (!outcome) return null;

  if (outcome.kind === "joining") {
    return (
      <Banner tone="neutral" icon={<InfoIcon className="mt-0.5 h-4 w-4 shrink-0" />}>
        Adding you to the league…
      </Banner>
    );
  }

  if (outcome.kind === "joined") {
    return (
      <Banner tone="good" icon={<CheckIcon className="mt-0.5 h-4 w-4 shrink-0" />}>
        {outcome.name ? (
          <>
            You&apos;ve joined <span className="font-semibold">{outcome.name}</span>.
          </>
        ) : (
          "You're in — welcome to the league."
        )}
      </Banner>
    );
  }

  return (
    <Banner tone="bad" icon={<InfoIcon className="mt-0.5 h-4 w-4 shrink-0" />}>
      {outcome.message}
    </Banner>
  );
}

type Outcome =
  | { kind: "joining" }
  | { kind: "joined"; name: string }
  | { kind: "failed"; message: string };

/**
 * `mb-4` and no top margin: `main` in app/layout.tsx owns the page rhythm and
 * this is the first block on the page, so it inherits the 40/64px above and only
 * has to hold its own seam below. `role="status"` because it appears after the
 * page has settled — a screen reader should hear the outcome without the focus
 * grab an alert would cause.
 */
function Banner({
  tone,
  icon,
  children,
}: {
  tone: "good" | "bad" | "neutral";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const skin =
    tone === "good"
      ? "border-alive/40 bg-alive-wash text-[#2C7A52]"
      : tone === "bad"
        ? "border-out/30 bg-out-wash text-[#8A2C2C]"
        : "border-line bg-fill-raised text-ink-soft";
  return (
    <div
      role="status"
      className={`mb-4 flex items-start gap-2.5 rounded-card border px-4 py-3 text-sm leading-relaxed ${skin}`}
    >
      {icon}
      <span>{children}</span>
    </div>
  );
}
