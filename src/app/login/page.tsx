"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BrandMark } from "@/components/shell/BrandMark";
import { Panel } from "@/components/ui/Panel";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { MailIcon, InfoIcon, CheckIcon, ArrowRightIcon } from "@/components/icons";

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginInner />
    </Suspense>
  );
}

function LoginFallback() {
  return <div className="min-h-dvh" aria-hidden />;
}

function LoginInner() {
  const params = useSearchParams();
  const invite = params.get("invite");
  const [mode, setMode] = useState<"login" | "signup">(invite ? "signup" : "login");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const valid = /.+@.+\..+/.test(email);

  return (
    <main className="mx-auto flex min-h-dvh max-w-app flex-col justify-center px-5 py-10">
      {/* Hero */}
      <div className="mb-8 text-center">
        <div className="mb-5 flex justify-center">
          <BrandMark size="lg" />
        </div>
        <MonoLabel className="text-brand-strong">NFL Survival League</MonoLabel>
        <h1 className="mt-2 text-display-md font-medium leading-[1.02] tracking-tight text-ink">
          Last Man
          <br />
          Standing
        </h1>
        <p className="mx-auto mt-3 max-w-[32ch] text-sm leading-relaxed text-ink-soft">
          One team a week. Lose once and you&apos;re out. The last survivor takes the season.
        </p>
      </div>

      {/* Invite banner */}
      {invite ? (
        <div className="mb-4 flex items-center gap-3 rounded-card border border-brand/40 bg-brand-wash px-4 py-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-brand-sheen text-white">
            <ArrowRightIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <MonoLabel className="text-[#8A4A24]">You&apos;re invited</MonoLabel>
            <p className="text-sm text-ink">
              Joining league <span className="font-mono font-semibold">{invite}</span> after you sign in.
            </p>
          </div>
        </div>
      ) : null}

      {/* Auth card */}
      <Panel tone="light" className="p-card">
        {sent ? (
          <SentState email={email} onReset={() => setSent(false)} />
        ) : (
          <>
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: "login", label: "Log in" },
                { value: "signup", label: "Sign up" },
              ]}
              className="mb-4 w-full"
            />

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (valid) setSent(true);
              }}
            >
              <label htmlFor="email" className="mb-1.5 block">
                <MonoLabel className="text-ink-mute">Email</MonoLabel>
              </label>
              <input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-control border border-line bg-white px-3 py-3 text-base text-ink placeholder:text-ink-mute/60 focus-visible:border-brand-strong"
              />

              <Button type="submit" variant="primary" block size="lg" className="mt-4" disabled={!valid}>
                <MailIcon />
                {mode === "signup" ? "Create my account" : "Send magic link"}
              </Button>
            </form>

            <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-ink-mute">
              <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              No password. We email you a one-tap link{" "}
              {mode === "signup" ? "and create your account automatically" : "— new here? your account is created on first sign-in"}.
            </p>
          </>
        )}
      </Panel>

      {/* Demo shortcut + footer */}
      <div className="mt-6 text-center">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-strong hover:underline"
        >
          Preview the app
          <ArrowRightIcon className="h-4 w-4" />
        </Link>
        <p className="mt-4 text-xs text-ink-mute">Private &amp; invite-only. No stakes, no app store.</p>
      </div>
    </main>
  );
}

function SentState({ email, onReset }: { email: string; onReset: () => void }) {
  return (
    <div className="text-center">
      <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-alive-wash text-[#2C7A52]">
        <CheckIcon className="h-6 w-6" />
      </div>
      <h2 className="text-lg font-semibold text-ink">Check your inbox</h2>
      <p className="mt-1 text-sm text-ink-soft">
        We sent a sign-in link to <span className="font-medium text-ink">{email}</span>.
      </p>

      {/* Spam reminder — a missed email can cost a pick deadline (P0). */}
      <div className="mt-4 flex items-start gap-2 rounded-control border border-strike/40 bg-strike-wash px-3 py-2.5 text-left text-xs leading-relaxed text-[#7A5312]">
        <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          <b className="font-semibold">Check your spam / junk folder</b> if it&apos;s not there in a minute. A
          missed email could cost you a weekly pick deadline.
        </span>
      </div>

      <button
        type="button"
        onClick={onReset}
        className="mt-4 text-sm font-medium text-brand-strong hover:underline"
      >
        Use a different email
      </button>
    </div>
  );
}
