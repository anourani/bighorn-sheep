import type { SVGProps } from "react";
import Link from "next/link";
import { BrandMark } from "@/components/shell/BrandMark";
import { Panel } from "@/components/ui/Panel";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { InviteEntry } from "@/components/landing/InviteEntry";
import { ShieldIcon, UsersIcon, TrophyIcon } from "@/components/icons";

export const metadata = {
  title: "Last Man Standing — NFL Survival League",
  description:
    "A private, invite-only NFL survivor pool. Pick one team a week, win to survive, last one standing takes the season.",
};

/**
 * Public landing page (the canonical root). Signed-in visitors are redirected to
 * /app by middleware; everyone else gets the pitch + an invite-code entry box.
 */
export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-wide flex-col px-5 py-12 sm:py-16">
      {/* Hero + invite entry */}
      <section className="mx-auto flex w-full max-w-app flex-col items-center text-center">
        <BrandMark size="lg" />
        <MonoLabel className="mt-5 text-brand-strong">NFL Survival League</MonoLabel>
        <h1 className="mt-2 text-display-lg font-medium leading-[1.02] tracking-tight text-ink">
          Last Man Standing
        </h1>
        <p className="mx-auto mt-4 max-w-[42ch] text-base leading-relaxed text-ink-soft">
          A private NFL survivor pool with your friends. Pick one team a week — win to survive, lose
          and you&apos;re out. The last one standing takes the season.
        </p>

        <div className="mt-8 w-full">
          <InviteEntry />
        </div>

        <p className="mt-4 text-sm text-ink-mute">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-brand-strong hover:underline">
            Log in
          </Link>
        </p>
      </section>

      {/* How it works */}
      <section className="mx-auto mt-16 w-full max-w-wide sm:mt-24">
        <div className="mb-5 text-center">
          <MonoLabel className="text-ink-mute">How it works</MonoLabel>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <HowStep
            n="01"
            Icon={ShieldIcon}
            title="Get an invite, pick a team"
            body="Join your league with an invite code, then pick one NFL team you think will win this week."
          />
          <HowStep
            n="02"
            Icon={UsersIcon}
            title="Win to survive"
            body="Your team wins, you advance. Lose and you're out — and you can't reuse a team all season."
          />
          <HowStep
            n="03"
            Icon={TrophyIcon}
            title="Last one standing wins"
            body="Survive week after week. The final survivor takes the season. No money, just bragging rights."
          />
        </div>
      </section>

      {/* Footer */}
      <footer className="mx-auto mt-16 max-w-app text-center sm:mt-24">
        <p className="text-xs text-ink-mute">Private &amp; invite-only. No stakes, no app store.</p>
      </footer>
    </main>
  );
}

function HowStep({
  n,
  Icon,
  title,
  body,
}: {
  n: string;
  Icon: (props: SVGProps<SVGSVGElement>) => React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Panel tone="light" className="p-card">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-brand-wash text-brand-strong">
          <Icon className="h-5 w-5" />
        </span>
        <MonoLabel className="text-ink-mute">{n}</MonoLabel>
      </div>
      <h3 className="mt-3 text-base font-semibold text-ink">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-ink-soft">{body}</p>
    </Panel>
  );
}
