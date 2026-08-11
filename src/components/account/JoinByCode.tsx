"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { InfoIcon } from "@/components/icons";
import { joinGroup } from "@/app/app/actions";
import { isStaleDeploymentError, reloadOnce } from "@/lib/deploy-skew";

const ERROR_COPY: Record<string, string> = {
  invalid_code: "That code doesn't match a league. Check it and try again.",
  entry_closed: "Entry for that league has closed — it locks at the first Week 1 kickoff.",
  join_failed: "Couldn't join that league. Give it another try.",
  not_authenticated: "Your session expired — sign in again.",
  unexpected_error: "Something went wrong on our end. Try again in a moment.",
};

/**
 * Join-a-league-by-code, for a signed-in member (the invite-LINK path is handled
 * separately by the login/callback flow). Calls the join_by_invite RPC and, on
 * success, refreshes so the new membership shows up.
 */
export function JoinByCode({ onJoined }: { onJoined?: () => void }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    const trimmed = code.trim();
    if (!trimmed || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await joinGroup(trimmed);
        if (!res.ok) {
          setError(ERROR_COPY[res.error] ?? "Couldn't join that league. Give it another try.");
          return;
        }
        setCode("");
        onJoined?.();
        router.refresh();
        router.push("/app/standings");
      } catch (err) {
        // A deploy landed while this tab was open — reload onto the new build.
        if (isStaleDeploymentError(err) && reloadOnce()) return;
        setError("Couldn't join that league. Give it another try.");
      }
    });
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <input
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase());
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="Enter invite code"
          className="min-w-0 flex-1 rounded-control border border-line bg-white px-3 py-2.5 font-mono text-sm uppercase text-ink placeholder:font-sans placeholder:text-ink-mute/60 focus-visible:border-brand-strong"
          aria-label="Invite code"
        />
        <Button variant="soft" disabled={code.trim().length === 0 || pending} onClick={submit}>
          {pending ? "Joining…" : "Join"}
        </Button>
      </div>
      {error ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-[#8A2C2C]">
          <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
