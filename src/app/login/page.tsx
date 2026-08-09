"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/errors";
import { formatDisplayName } from "@/lib/league/name";
import { BrandMark } from "@/components/shell/BrandMark";
import { Panel } from "@/components/ui/Panel";
import { Label } from "@/components/ui/Label";
import { Button } from "@/components/ui/Button";
import { MailIcon, InfoIcon, CheckIcon, ArrowRightIcon, UsersIcon } from "@/components/icons";

/** One email field drives everything; the step reflects what we learned about it. */
type Step = "email" | "name" | "needs_invite" | "sent";

/**
 * Outcome of a magic-link send. `signup_disabled` means the address has no
 * account and this call wasn't permitted to create one — the caller routes to
 * the invite explainer rather than surfacing an error.
 */
type SendResult = { ok: true } | { ok: false; reason: "signup_disabled" | "other" };

const ENTRY_CLOSED_COPY =
  "Entry for this league has closed — it locks at the first Week 1 kickoff.";

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

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  // Which "check your inbox" copy to show: true = returning, false = brand new,
  // null = we couldn't tell (Supabase not configured in this environment).
  const [returning, setReturning] = useState<boolean | null>(null);
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
  const firstValid = firstName.trim().length >= 1;
  const entryClosed = preview.status === "found" && !preview.entryOpen;

  /** Does this email already have a confirmed account? null if we can't tell. */
  async function checkAccountExists(): Promise<boolean | null> {
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("account_exists", { p_email: email.trim() });
      if (error) return null;
      return data === true;
    } catch {
      return null;
    }
  }

  /**
   * Send the magic link. Carries the invite (if any) and optional signup name.
   *
   * `allowCreate` gates whether this send may bring a brand-new account into
   * existence. Callers that haven't established the player is entitled to one
   * pass false, so Supabase signs in an existing user but refuses to provision
   * a stranger.
   */
  async function sendMagicLink(
    data?: { first_name: string; last_name: string },
    allowCreate = true,
  ): Promise<SendResult> {
    try {
      const supabase = createClient();
      const redirect = new URL("/auth/callback", window.location.origin);
      redirect.searchParams.set("next", "/app");
      if (invite) redirect.searchParams.set("invite", invite);

      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: redirect.toString(),
          shouldCreateUser: allowCreate,
          // first_name/last_name are read by the handle_new_user trigger.
          ...(data ? { data } : {}),
        },
      });
      if (error) {
        // "No such account, and I'm not allowed to make one" is a routing
        // signal, not a failure to report — the caller sends them to the
        // invite explainer instead of showing a scary message.
        const signupDisabled =
          (error as { code?: string }).code === "otp_disabled" ||
          /signups? not allowed/i.test(error.message ?? "");
        if (!signupDisabled) {
          setFormError(errorMessage(error, "Couldn't send the link. Try again."));
        }
        return { ok: false, reason: signupDisabled ? "signup_disabled" : "other" };
      }
      return { ok: true };
    } catch {
      setFormError("Sign-in isn't configured in this environment yet.");
      return { ok: false, reason: "other" };
    }
  }

  // Step 1 — the single email entry. Detect the account, then branch.
  async function handleEmailContinue(e: React.FormEvent) {
    e.preventDefault();
    if (!emailValid || submitting) return;
    setSubmitting(true);
    setFormError(null);

    const exists = await checkAccountExists();
    if (exists === true) {
      // Returning player — send a plain login link.
      if ((await sendMagicLink()).ok) {
        setReturning(true);
        setStep("sent");
      }
    } else if (exists === false) {
      // Brand new — they need an invite to join a league before we create them.
      if (!invite) setStep("needs_invite");
      else if (entryClosed) setFormError(ENTRY_CLOSED_COPY);
      else setStep("name");
    } else {
      // Couldn't detect — account_exists is unavailable. With an invite, collect
      // a name as usual. Without one, still try to sign them in, but withhold
      // permission to CREATE: otherwise an unknown address could self-provision
      // into an invite-only league for as long as the check happens to be down.
      if (invite) {
        if (entryClosed) setFormError(ENTRY_CLOSED_COPY);
        else setStep("name");
      } else {
        const res = await sendMagicLink(undefined, false);
        if (res.ok) {
          setReturning(null);
          setStep("sent");
        } else if (res.reason === "signup_disabled") {
          // No account to sign in to, and no invite to create one with.
          setStep("needs_invite");
        }
      }
    }
    setSubmitting(false);
  }

  // Step 2 — collect the new player's real name, then create + join on sign-in.
  async function handleCreateAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!firstValid || submitting) return;
    setSubmitting(true);
    setFormError(null);
    if ((await sendMagicLink({ first_name: firstName.trim(), last_name: lastName.trim() })).ok) {
      setReturning(false);
      setStep("sent");
    }
    setSubmitting(false);
  }

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
        {step === "sent" ? (
          <SentState
            email={email}
            returning={returning}
            onReset={() => {
              setStep("email");
              setFormError(null);
            }}
          />
        ) : step === "needs_invite" ? (
          <NeedsInviteState
            email={email}
            onReset={() => {
              setEmail("");
              setStep("email");
              setFormError(null);
            }}
          />
        ) : step === "name" ? (
          <form onSubmit={handleCreateAccount}>
            <Label className="mb-1 block text-ink-mute">Almost in</Label>
            <p className="mb-4 text-sm text-ink-soft">
              New here — tell us your name so teammates know who&apos;s on the board. You&apos;ll show as
              &quot;{formatDisplayName(firstName, lastName, "First L.")}&quot;
            </p>

            <div className="flex gap-2">
              <div className="flex-1">
                <label htmlFor="first" className="mb-1.5 block">
                  <Label className="text-ink-mute">First name</Label>
                </label>
                <input
                  id="first"
                  type="text"
                  autoComplete="given-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Alex"
                  className="w-full rounded-control border border-line bg-white px-3 py-3 text-base text-ink placeholder:text-ink-mute/60 focus-visible:border-brand-strong"
                />
              </div>
              <div className="flex-1">
                <label htmlFor="last" className="mb-1.5 block">
                  <Label className="text-ink-mute">Last name</Label>
                </label>
                <input
                  id="last"
                  type="text"
                  autoComplete="family-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Nourani"
                  className="w-full rounded-control border border-line bg-white px-3 py-3 text-base text-ink placeholder:text-ink-mute/60 focus-visible:border-brand-strong"
                />
              </div>
            </div>

            {formError ? (
              <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-[#8A2C2C]">
                <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {formError}
              </p>
            ) : null}

            <Button type="submit" variant="primary" block size="lg" className="mt-4" disabled={!firstValid || submitting}>
              <MailIcon />
              {submitting ? "Sending…" : "Create my account"}
            </Button>

            <button
              type="button"
              onClick={() => {
                setStep("email");
                setFormError(null);
              }}
              className="mt-3 w-full text-center text-sm font-medium text-brand-strong hover:underline"
            >
              Use a different email
            </button>
          </form>
        ) : (
          <form onSubmit={handleEmailContinue}>
            <label htmlFor="email" className="mb-1.5 block">
              <Label className="text-ink-mute">Email</Label>
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

            {formError ? (
              <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-[#8A2C2C]">
                <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {formError}
              </p>
            ) : null}

            <Button type="submit" variant="primary" block size="lg" className="mt-4" disabled={!emailValid || submitting}>
              <MailIcon />
              {submitting ? "Checking…" : "Continue"}
            </Button>

            <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-ink-mute">
              <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              No password. Enter your email and we&apos;ll send a one-tap link — we&apos;ll set you up if
              you&apos;re new, or welcome you back if you already play.
            </p>
          </form>
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
            <Label className="text-[#8A2C2C]">Invite not found</Label>
            <p className="text-sm text-ink">
              Code <span className="font-mono font-semibold">{invite}</span> doesn&apos;t match a league.
            </p>
          </>
        ) : preview.status === "found" ? (
          <>
            <Label className="text-[#8A4A24]">You&apos;re invited</Label>
            <p className="text-sm text-ink">
              Joining <span className="font-semibold">{preview.name}</span> ·{" "}
              {preview.memberCount} {preview.memberCount === 1 ? "player" : "players"} ·{" "}
              {preview.entryOpen ? "entry open" : "entry closed"}
            </p>
          </>
        ) : (
          <>
            <Label className="text-[#8A4A24]">You&apos;re invited</Label>
            <p className="text-sm text-ink">
              Joining league <span className="font-mono font-semibold">{invite}</span> after you sign in.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function NeedsInviteState({ email, onReset }: { email: string; onReset: () => void }) {
  return (
    <div>
      <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-brand-wash text-brand-strong">
        <UsersIcon className="h-6 w-6" />
      </div>
      <h2 className="text-center text-lg font-semibold text-ink">No account yet</h2>
      <p className="mt-1 text-center text-sm text-ink-soft">
        We couldn&apos;t find an account for <span className="font-medium text-ink">{email}</span>.
      </p>
      <div className="mt-4 flex items-start gap-2 rounded-control border border-line bg-[#FAFAFB] px-3 py-2.5 text-left text-xs leading-relaxed text-ink-soft">
        <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Last Man Standing is invite-only. Ask a league admin for their invite link — opening it will set up
          your account and drop you straight into their league.
        </span>
      </div>
      <button
        type="button"
        onClick={onReset}
        className="mt-4 w-full text-center text-sm font-medium text-brand-strong hover:underline"
      >
        Try a different email
      </button>
    </div>
  );
}

function SentState({
  email,
  returning,
  onReset,
}: {
  email: string;
  returning: boolean | null;
  onReset: () => void;
}) {
  const heading = returning ? "Welcome back" : "Check your inbox";
  const lead =
    returning === false
      ? "You're almost in — tap the link we sent to finish setting up your account."
      : "We sent a one-tap sign-in link to";
  return (
    <div className="text-center">
      <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-alive-wash text-[#2C7A52]">
        <CheckIcon className="h-6 w-6" />
      </div>
      <h2 className="text-lg font-semibold text-ink">{heading}</h2>
      <p className="mt-1 text-sm text-ink-soft">
        {returning === false ? (
          <>
            {lead} <span className="font-medium text-ink">{email}</span>
          </>
        ) : (
          <>
            {lead} <span className="font-medium text-ink">{email}</span>.
          </>
        )}
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
