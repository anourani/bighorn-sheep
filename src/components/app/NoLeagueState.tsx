"use client";

import { useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { MonoLabel } from "@/components/ui/MonoLabel";
import { Button } from "@/components/ui/Button";
import { PlusIcon, UsersIcon } from "@/components/icons";
import { CreateGroupModal } from "@/components/account/CreateGroupModal";
import { JoinByCode } from "@/components/account/JoinByCode";

/**
 * Shown on My Picks / Standings when the signed-in player belongs to no league
 * yet (the "start empty" first run). Two ways forward: spin up a league as its
 * admin, or join a friend's with an invite code.
 */
export function NoLeagueState() {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="stagger mx-auto max-w-md space-y-4 py-6">
      <Panel className="p-card text-center">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-brand-sheen text-white">
          <UsersIcon className="h-6 w-6" />
        </div>
        <MonoLabel className="text-onsurface-mute">No league yet</MonoLabel>
        <h1 className="mt-1 text-display-sm font-medium tracking-tight text-onsurface">
          Get in the game
        </h1>
        <p className="mx-auto mt-2 max-w-[34ch] text-sm leading-relaxed text-onsurface-soft">
          Create your own survival league and invite friends, or join one you were invited to with its code.
        </p>
      </Panel>

      <Panel tone="light" className="space-y-4 p-card">
        <Button variant="primary" block onClick={() => setCreateOpen(true)}>
          <PlusIcon />
          Create a group
        </Button>

        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-line" />
          <MonoLabel className="text-ink-mute">or join by code</MonoLabel>
          <span className="h-px flex-1 bg-line" />
        </div>

        <JoinByCode />
      </Panel>

      <CreateGroupModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
