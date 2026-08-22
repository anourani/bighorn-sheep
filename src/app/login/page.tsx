import Link from "next/link";
import { LoginFlow } from "@/components/auth/LoginFlow";
import { ArrowRightIcon } from "@/components/icons";

/**
 * The standalone sign-in route.
 *
 * The landing header no longer links here — it opens `LoginFlow` in a modal over
 * `/` instead, so a visitor who clicks Log In never leaves the page they were
 * reading. This route is not vestigial though: invite links pasted into group
 * chats are `${appUrl}/login?invite=CODE`, and /auth/callback bounces failures to
 * `/login?error=`. Both arrive cold, with no page behind them to overlay, so they
 * get the hero.
 *
 * Those two are now the ONLY things that reach it. Nothing in the app links or
 * redirects to a bare `/login` any more: closing an account and the account
 * page's signed-out guard both land on `/` instead, which is where middleware
 * already sends a signed-out visitor who touches `/app`. So the parameterless
 * form of this route is a typed URL or an old bookmark, and its hero says
 * "Welcome to" rather than pretending an invitation exists.
 *
 * A server component: `searchParams` is read here rather than with
 * `useSearchParams()` inside `LoginFlow`, which keeps the flow a pure function of
 * its props and lets the landing page render it without dragging a Suspense/CSR
 * bailout onto its static shell.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const invite = typeof params.invite === "string" ? params.invite : null;
  const errorReason = typeof params.error === "string" ? params.error : null;

  return (
    /* 600px, not `max-w-app`'s 480, and no horizontal gutter of its own. The
       design runs the 64px headline wider than the card stack beneath it — 523px
       of glyphs against a 480px column — so the page holds the WIDER of the two
       measures and each block below claims its own: the hero pads itself by 16px,
       and `LoginFlow` re-narrows the cards to `max-w-app`. Putting `px-5` back
       here would inset the hero twice and cost it the width it was widened for. */
    <main className="mx-auto flex min-h-dvh max-w-[600px] flex-col justify-center py-10">
      {/* The hero belongs to `LoginFlow`, not to this page: its eyebrow follows
          the invite, and the surrounding card follows `step` — state the page
          can't see without going client. */}
      <LoginFlow variant="page" invite={invite} errorReason={errorReason} />

      {/* Footer */}
      <div className="mt-6 px-5 text-center">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-strong hover:underline"
        >
          What is Last Man Standing?
          <ArrowRightIcon className="h-4 w-4" />
        </Link>
        <p className="mt-4 text-xs text-ink-mute">Private &amp; invite-only. No stakes, no app store.</p>
      </div>
    </main>
  );
}
