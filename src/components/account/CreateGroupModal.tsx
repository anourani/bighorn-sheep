"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { Segmented } from "@/components/ui/Segmented";
import { InfoIcon } from "@/components/icons";
import type { EliminationType, TieRule } from "@/lib/league/types";

/**
 * Group creation — a modal, not a page (a brand-new admin creates their league
 * here). Wired to local state for the demo; the real version posts to Supabase.
 */
export function CreateGroupModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const [elimination, setElimination] = useState<EliminationType>("single");
  const [tieRule, setTieRule] = useState<TieRule>("push");

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="New league"
      title="Create a group"
      description="You'll be the admin. Invite friends after."
      footer={
        <Button variant="primary" block disabled={name.trim().length === 0} onClick={onClose}>
          Create group
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
      </div>
    </Modal>
  );
}
