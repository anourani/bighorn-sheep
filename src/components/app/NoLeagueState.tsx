"use client";

import { Panel } from "@/components/ui/Panel";
import { Label } from "@/components/ui/Label";
import { UsersIcon } from "@/components/icons";
import { JoinByCode } from "@/components/account/JoinByCode";

/**
 * Shown on My Picks / Standings when the signed-in player belongs to no league
 * yet (the "start empty" first run). One way forward: join with an invite code.
 *
 * There is deliberately no "create a league" path. The inaugural season runs a
 * single league, so every player arrives through an invite. The `create_group`
 * RPC still exists in the database (removing it would need another hand-applied
 * migration, and it is harmless with nothing calling it), but nothing in the
 * product reaches it.
 */
export function NoLeagueState() {
  return (
    <div className="stagger mx-auto max-w-md space-y-4 py-6">
      <Panel className="p-card text-center">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-brand-sheen text-white">
          <UsersIcon className="h-6 w-6" />
        </div>
        <Label className="text-onsurface-mute">No league yet</Label>
        <h1 className="mt-1 text-display-sm font-medium tracking-tight text-onsurface">
          Get in the game
        </h1>
        <p className="mx-auto mt-2 max-w-[34ch] text-sm leading-relaxed text-onsurface-soft">
          Join the league you were invited to with its code.
        </p>
      </Panel>

      <Panel tone="light" className="space-y-4 p-card">
        <JoinByCode />
      </Panel>
    </div>
  );
}
