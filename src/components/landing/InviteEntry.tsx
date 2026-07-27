"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { ArrowRightIcon, InfoIcon } from "@/components/icons";

/**
 * The landing page's primary CTA: enter an invite code. We validate it against
 * `invite_preview` (anon RPC) before routing, so a bad code fails here instead of
 * after the user has typed their email. On success we hand off to /login?invite=,
 * which shows "You're joining {League}" and collects name + email.
 */
export function InviteEntry() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = code.trim();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmed) return;
    setChecking(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc("invite_preview", { p_code: trimmed });
      if (rpcError || !data?.[0]) {
        setError("That code doesn't match a league. Check it and try again.");
        setChecking(false);
        return;
      }
      router.push(`/login?invite=${encodeURIComponent(trimmed)}`);
    } catch {
      // Supabase not configured here — proceed to the join screen, which
      // surfaces the same validation.
      router.push(`/login?invite=${encodeURIComponent(trimmed)}`);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="flex items-center gap-2">
        <input
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase());
            setError(null);
          }}
          placeholder="Enter your invite code"
          aria-label="Invite code"
          className="min-w-0 flex-1 rounded-control border border-line bg-white px-4 py-3.5 text-center font-mono text-base uppercase tracking-wider text-ink placeholder:font-sans placeholder:tracking-normal placeholder:text-ink-mute/60 focus-visible:border-brand-strong focus-visible:outline-none"
        />
        <Button type="submit" size="lg" aria-label="Continue" disabled={!trimmed || checking}>
          {checking ? "…" : <ArrowRightIcon />}
        </Button>
      </div>
      {error ? (
        <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-[#8A2C2C]">
          <InfoIcon className="h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      ) : null}
    </form>
  );
}
