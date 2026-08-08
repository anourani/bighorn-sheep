"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { Segmented } from "@/components/ui/Segmented";
import { InfoIcon } from "@/components/icons";
import { createGroup } from "@/app/app/actions";
import { isStaleDeploymentError, reloadOnce } from "@/lib/deploy-skew";
import type { EliminationType, TieRule } from "@/lib/league/types";

const ERROR_COPY: Record<string, string> = {
  name_required: "Give your league a name.",
  not_authenticated: "Your session expired — sign in again.",
  create_failed: "Couldn't create the group. Try again.",
  unexpected_error: "Something went wrong on our end. Try again in a moment.",
};

/**
 * Group creation — a modal, not a page (a brand-new admin creates their league
 * here). Posts to the `create_group` RPC, which atomically creates the league
 * and enrolls the creator as admin, then drops them into the new league.
 */
export function CreateGroupModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [elimination, setElimination] = useState<EliminationType>("single");
  const [tieRule, setTieRule] = useState<TieRule>("push");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (name.trim().length === 0 || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await createGroup({ name, eliminationType: elimination, tieRule });
        if (!res.ok) {
          setError(ERROR_COPY[res.error] ?? "Couldn't create the group. Try again.");
          return;
        }
        onClose();
        router.refresh();
        router.push("/app/standings");
      } catch (err) {
        // A deploy landed while this tab was open — reload onto the new build.
        if (isStaleDeploymentError(err) && reloadOnce()) return;
        setError("Couldn't create the group. Try again.");
      }
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="New league"
      title="Create a group"
      description="You'll be the admin. Invite friends after."
      footer={
        <Button variant="primary" block disabled={name.trim().length === 0 || pending} onClick={submit}>
          {pending ? "Creating…" : "Create group"}
        </Button>
      }
    >
      <div className="space-y-5">
        <div>
          <label htmlFor="group-name" className="mb-1.5 block">
            <MonoLabel className="text-ink-mute">Group name</MonoLabel>
          </label>
          <input
            id="group-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Bighorn Survivors"
            className="w-full rounded-control border border-line bg-white px-3 py-2.5 text-sm text-ink placeholder:text-ink-mute/60 focus-visible:border-brand-strong"
          />
        </div>

        <div>
          <MonoLabel className="mb-1.5 block text-ink-mute">Elimination</MonoLabel>
          <Segmented
            value={elimination}
            onChange={setElimination}
            options={[
              { value: "single", label: "Single · 1 loss" },
              { value: "two_time", label: "Two-time · 2 losses" },
            ]}
            className="w-full"
          />
        </div>

        <div>
          <MonoLabel className="mb-1.5 block text-ink-mute">Tie rule</MonoLabel>
          <Segmented
            value={tieRule}
            onChange={setTieRule}
            options={[
              { value: "push", label: "Push · survive" },
              { value: "loss", label: "Loss" },
            ]}
            className="w-full"
          />
          <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-ink-mute">
            <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            A tie means your team didn&apos;t win. <b className="font-semibold text-ink-soft">Push</b> lets the
            player survive; <b className="font-semibold text-ink-soft">Loss</b> treats it like a losing pick (one
            strike in a two-time league).
          </p>
        </div>

        {error ? (
          <p className="flex items-start gap-1.5 text-xs leading-relaxed text-[#8A2C2C]">
            <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
