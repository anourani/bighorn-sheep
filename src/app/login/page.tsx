"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BrandMark } from "@/components/shell/BrandMark";
import { Panel } from "@/components/ui/Panel";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { MailIcon, InfoIcon, CheckIcon, ArrowRightIcon, UsersIcon } from "@/components/icons";

type Mode = "login" | "signup";

/** Human copy for the `?error=` reasons the auth callback can bounce back with. */
const ERROR_COPY: Record<string, string> = {
  link_expired: "That sign-in link expired or was already used. Request a fresh one below.",
  entry_closed: "Entry for that league has closed — it locks at the first Week 1 kickoff.",
  invalid_code: "That invite code didn't match a league. Double-check it and try again.",
  join_failed: "Something went wrong joining that league. Give it another try.",
};

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

type Preview =
  | { status: "idle" | "loading" | "invalid" | "error" }
  | {
      status: "found";
      name: string;
      memberCount: number;
      entryOpen: boolean;
    };

function LoginInner() {
  const params = useSearchParams();
  const invite = params.get("invite");
  const errorParam = params.get("error");

  const [mode, setMode] = useState<Mode>(invite ? "signup" : "login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview>({ status: invite ? "loading" : "idle" });

  // Validate the invite code up front so we can show "You're joining {League}"
  // (and catch a bad code) before we ever send an email.
  useEffect(() => {
    if (!invite) return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase.rpc("invite_preview", { p_code: invite });
        if (cancelled) return;
        const row = data?.[0];
        if (error || !row) {
          setPreview({ status: "invalid" });
          return;
        }
        setPreview({
          status: "found",
          name: row.name,
          memberCount: row.member_count,
          entryOpen: row.entry_open,
        });
      } catch {
        // Supabase not configured in this environment — degrade quietly.
        if (!cancelled) setPreview({ status: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invite]);

  const emailValid = /.+@.+\..+/.test(email);
  const nameValid = name.trim().length >= 2;
  const needsName = mode === "signup";
  const signupBlockedNoInvite = mode === "signup" && !invite;
  const entryClosed = preview.status === "found" && !preview.entryOpen;
  const canSubmit =
    emailValid &&
    (!needsName || nameValid) &&
    !signupBlockedNoInvite &&
    !(mode === "signup" && entryClosed) &&
    !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const supabase = createClient();
      const redirect = new URL("/auth/callback", window.location.origin);
      redirect.searchParams.set("next", "/app");
      if (invite) redirect.searchParams.set("invite", invite);

      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: redirect.toString(),
          shouldCreateUser: true,
          // display_name is read by the handle_new_user trigger on first sign-in.
          ...(mode === "signup" ? { data: { display_name: name.trim() } } : {}),
        },
      });
      if (error) {
        setFormError(error.message || "Couldn't send the link. Try again.");
      } else {
        setSent(true);
      }
    } catch {
      setFormError("Sign-in isn't configured in this environment yet.");
    } finally {
      setSubmitting(false);
    }
  }

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

      {/* Callback error banner */}
      {errorParam && ERROR_COPY[errorParam] ? (
        <div className="mb-4 flex items-start gap-2.5 rounded-card border border-out/30 bg-out-wash px-4 py-3 text-sm text-[#8A2C2C]">
          <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{ERROR_COPY[errorParam]}</span>
        </div>
      ) : null}

      {/* Invite banner */}
      {invite ? <InviteBanner invite={invite} preview={preview} /> : null}

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

            <form onSubmit={handleSubmit}>
              {needsName ? (
                <div className="mb-3">
                  <label htmlFor="name" className="mb-1.5 block">
                    <MonoLabel className="text-ink-mute">Display name</MonoLabel>
                  </label>
                  <input
                    id="name"
                    type="text"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="How you'll show on the board"
                    className="w-full rounded-control border border-line bg-white px-3 py-3 text-base text-ink placeholder:text-ink-mute/60 focus-visible:border-brand-strong"
                  />
                </div>
              ) : null}

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

              {signupBlockedNoInvite ? (
                <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-ink-mute">
                  <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Sign-up is invite-only. Enter your invite code on the{" "}
                  <Link href="/" className="font-medium text-brand-strong hover:underline">
                    home page
                  </Link>{" "}
                  to get started.
                </p>
              ) : null}

              {mode === "signup" && entryClosed ? (
                <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-[#8A2C2C]">
                  <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Entry for this league has closed. If you already have an account, log in instead.
                </p>
              ) : null}

              {formError ? (
                <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-[#8A2C2C]">
                  <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {formError}
                </p>
              ) : null}

              <Button type="submit" variant="primary" block size="lg" className="mt-4" disabled={!canSubmit}>
                <MailIcon />
                {submitting
                  ? "Sending…"
                  : mode === "signup"
                    ? "Create my account"
                    : "Send magic link"}
              </Button>
            </form>

            <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-ink-mute">
              <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              No password. We email you a one-tap link{" "}
              {mode === "signup"
                ? "and create your account automatically"
                : "— new here? your account is created on first sign-in"}
              .
            </p>
          </>
        )}
      </Panel>

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

function InviteBanner({ invite, preview }: { invite: string; preview: Preview }) {
  const invalid = preview.status === "invalid";
  return (
    <div
      className={
        invalid
          ? "mb-4 flex items-center gap-3 rounded-card border border-out/30 bg-out-wash px-4 py-3"
          : "mb-4 flex items-center gap-3 rounded-card border border-brand/40 bg-brand-wash px-4 py-3"
      }
    >
      <div
        className={
          invalid
            ? "grid h-9 w-9 shrink-0 place-items-center rounded-control bg-out text-white"
            : "grid h-9 w-9 shrink-0 place-items-center rounded-control bg-brand-sheen text-white"
        }
      >
        {invalid ? <InfoIcon className="h-4 w-4" /> : <UsersIcon className="h-4 w-4" />}
      </div>
      <div className="min-w-0">
        {invalid ? (
          <>
            <MonoLabel className="text-[#8A2C2C]">Invite not found</MonoLabel>
            <p className="text-sm text-ink">
              Code <span className="font-mono font-semibold">{invite}</span> doesn&apos;t match a league.
            </p>
          </>
        ) : preview.status === "found" ? (
          <>
            <MonoLabel className="text-[#8A4A24]">You&apos;re invited</MonoLabel>
            <p className="text-sm text-ink">
              Joining <span className="font-semibold">{preview.name}</span> ·{" "}
              {preview.memberCount} {preview.memberCount === 1 ? "player" : "players"} ·{" "}
              {preview.entryOpen ? "entry open" : "entry closed"}
            </p>
          </>
        ) : (
          <>
            <MonoLabel className="text-[#8A4A24]">You&apos;re invited</MonoLabel>
            <p className="text-sm text-ink">
              Joining league <span className="font-mono font-semibold">{invite}</span> after you sign in.
            </p>
          </>
        )}
      </div>
    </div>
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
