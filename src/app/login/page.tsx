import Link from "next/link";
import { LoginFlow } from "@/components/auth/LoginFlow";
import { BrandMark } from "@/components/shell/BrandMark";
import { Label } from "@/components/ui/Label";
import { ArrowRightIcon } from "@/components/icons";

/**
 * The standalone sign-in route.
 *
 * The landing header no longer links here — it opens `LoginFlow` in a modal over
 * `/` instead, so a visitor who clicks Log In never leaves the page they were
 * reading. This route is not vestigial though: invite links pasted into group
 * chats are `${appUrl}/login?invite=CODE`, and /auth/callback bounces failures to
 * `/login?error=`. Both arrive cold, with no page behind them to overlay, so they
 * get the full hero.
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
    <main className="mx-auto flex min-h-dvh max-w-app flex-col justify-center px-5 py-10">
      {/* Hero */}
      <div className="mb-8 text-center">
        <div className="mb-5 flex justify-center">
          <BrandMark size="lg" />
        </div>
        <Label className="text-brand-strong">NFL Survival League</Label>
        <h1 className="mt-2 text-display-md font-medium leading-[1.02] tracking-tight text-ink">
          Last Man
          <br />
          Standing
        </h1>
        <p className="mx-auto mt-3 max-w-[32ch] text-sm leading-relaxed text-ink-soft">
          One team a week. Lose once and you&apos;re out. The last survivor takes the season.
        </p>
      </div>

      <LoginFlow variant="page" invite={invite} errorReason={errorReason} />

      {/* Footer */}
      <div className="mt-6 text-center">
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
