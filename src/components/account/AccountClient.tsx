"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import { Label } from "@/components/ui/Label";
import { Pill, StrikePips } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { CreateGroupModal } from "@/components/account/CreateGroupModal";
import { JoinByCode } from "@/components/account/JoinByCode";
import { PlusIcon, LogOutIcon, DownloadIcon, ClockIcon, TrophyIcon, InfoIcon } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";
import { updateProfile, updateAvatar } from "@/app/app/actions";
import { isStaleDeploymentError, reloadOnce } from "@/lib/deploy-skew";
import { strikeAllowance } from "@/lib/league/types";
import { timeZoneLabel } from "@/lib/time";
import type { AccountData, Viewer } from "@/lib/league/load";

function monthYear(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", year: "numeric" });
  } catch {
    return null;
  }
}

function TimeZoneNote() {
  const [tz, setTz] = useState<string>("");
  useEffect(() => {
    try {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const label = timeZoneLabel();
      setTz(label ? `${zone} (${label})` : zone);
    } catch {
      setTz("your device timezone");
    }
  }, []);
  return <span className="font-mono text-xs text-ink-soft">{tz || "…"}</span>;
}

const ACCEPT = "image/png,image/jpeg,image/webp";
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

/**
 * The profile header — now editable. Names live in `first_name`/`last_name` and
 * render as "First L."; the avatar is a sticker the player uploads. Image bytes
 * go straight to Supabase Storage (the browser holds the File); the resulting URL
 * and any name change are persisted via server actions so caches revalidate.
 */
function ProfileCard({ viewer, since }: { viewer: Viewer; since: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState(viewer.firstName);
  const [lastName, setLastName] = useState(viewer.lastName);
  const [avatarUrl, setAvatarUrl] = useState(viewer.avatarUrl);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startSave] = useTransition();

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file after an error
    if (!file) return;
    setError(null);
    if (!ACCEPT.split(",").includes(file.type)) {
      setError("Use a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Image must be under 2 MB.");
      return;
    }
    setUploading(true);
    try {
      const supabase = createClient();
      const path = `${viewer.id}/avatar`; // one avatar per user; upsert overwrites
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true, cacheControl: "3600", contentType: file.type });
      if (upErr) {
        setError("Upload failed. Try again.");
        return;
      }
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      // Fixed path + upsert means an identical URL each time — bust the CDN cache.
      const url = `${data.publicUrl}?v=${Date.now()}`;
      const res = await updateAvatar(url);
      if (!res.ok) {
        setError("Couldn't save your avatar.");
        return;
      }
      setAvatarUrl(url);
      router.refresh();
    } catch (err) {
      // A deploy landed while this tab was open — reload onto the new build.
      if (isStaleDeploymentError(err) && reloadOnce()) return;
      setError("Photo uploads aren't available in this environment.");
    } finally {
      setUploading(false);
    }
  }

  function saveName() {
    if (firstName.trim().length < 1 || pending) return;
    setError(null);
    startSave(async () => {
      try {
        const res = await updateProfile({ firstName, lastName });
        if (!res.ok) {
          setError(res.error === "first_name_required" ? "Enter your first name." : "Couldn't save your name.");
          return;
        }
        setEditing(false);
        router.refresh();
      } catch (err) {
        // A deploy landed while this tab was open — reload onto the new build.
        if (isStaleDeploymentError(err) && reloadOnce()) return;
        setError("Couldn't save your name.");
      }
    });
  }

  function cancel() {
    setFirstName(viewer.firstName);
    setLastName(viewer.lastName);
    setError(null);
    setEditing(false);
  }

  return (
    <Panel className="p-card">
      <div className="flex items-center gap-4">
        <div className="relative shrink-0">
          <Avatar firstName={firstName} lastName={lastName} avatarUrl={avatarUrl} size={64} />
          {editing ? (
            <label className="absolute inset-0 grid cursor-pointer place-items-center rounded-full bg-black/45 text-[10px] font-semibold uppercase tracking-wide text-white">
              {uploading ? "…" : "Edit"}
              <input type="file" accept={ACCEPT} onChange={handleFile} disabled={uploading} className="sr-only" />
            </label>
          ) : null}
        </div>

        {editing ? (
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex gap-2">
              <input
                aria-label="First name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First name"
                className="w-full rounded-control border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-mute/60 focus-visible:border-brand-strong"
              />
              <input
                aria-label="Last name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Last name"
                className="w-full rounded-control border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-mute/60 focus-visible:border-brand-strong"
              />
            </div>
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold text-onsurface">{viewer.name}</h1>
            {viewer.email ? (
              <p className="truncate text-sm text-onsurface-soft">{viewer.email}</p>
            ) : null}
            {since ? (
              <div className="mt-2 flex items-center gap-2">
                <Label className="text-onsurface-mute">Since {since}</Label>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {error ? (
        <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-[#8A2C2C]">
          <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      ) : null}

      {editing ? (
        <div className="mt-4 flex gap-2">
          <Button variant="primary" block disabled={firstName.trim().length < 1 || pending} onClick={saveName}>
            {pending ? "Saving…" : "Save"}
          </Button>
          <Button variant="outline" block onClick={cancel} disabled={pending}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button variant="outline" block className="mt-4" onClick={() => setEditing(true)}>
          Edit profile
        </Button>
      )}
    </Panel>
  );
}

export function AccountClient({ account }: { account: AccountData }) {
  const { viewer, leagues } = account;
  const [createOpen, setCreateOpen] = useState(false);
  const since = monthYear(account.memberSinceIso);

  async function handleLogout() {
    try {
      await createClient().auth.signOut();
    } catch {
      // Supabase not configured — just return to the sign-in screen.
    }
    window.location.href = "/login";
  }

  return (
    <div className="stagger mx-auto max-w-2xl space-y-4">
      {/* Profile */}
      <div>
        <ProfileCard viewer={viewer} since={since} />
      </div>

      {/* Leagues */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Your leagues</h2>
          <Label className="text-ink-mute">
            {leagues.length} {leagues.length === 1 ? "league" : "leagues"}
          </Label>
        </div>
        <Panel tone="light" className="divide-y divide-line p-0">
          {leagues.map(({ group, role, status, strikes }) => {
            const allowance = strikeAllowance(group.rules.eliminationType);
            return (
              <Link
                key={group.id}
                href="/app/standings"
                className="flex items-center gap-3 px-card py-4 transition-colors hover:bg-[#FAFAFB]"
              >
                <div className="grid h-10 w-10 place-items-center rounded-control bg-brand-wash text-brand-strong">
                  <TrophyIcon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold text-ink">{group.name}</span>
                    {role === "admin" ? <Pill variant="brand">Admin</Pill> : null}
                  </div>
                  <Label className="text-ink-mute">
                    {group.rules.eliminationType === "single" ? "Single elim" : "Two-time"} ·{" "}
                    {group.rules.tieRule}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  {status === "alive" ? <Pill variant="alive">Alive</Pill> : <Pill variant="out">Out</Pill>}
                  <StrikePips strikes={strikes} allowance={allowance} tone="light" />
                </div>
              </Link>
            );
          })}

          <div className="space-y-3 px-card py-4">
            {leagues.length === 0 ? (
              <p className="text-sm text-ink-mute">
                You&apos;re not in a league yet. Create one, or join with an invite code.
              </p>
            ) : null}
            <Button variant="outline" block onClick={() => setCreateOpen(true)}>
              <PlusIcon />
              Create a group
            </Button>
            <JoinByCode />
          </div>
        </Panel>
      </div>

      {/* Preferences */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-ink">Preferences</h2>
        <Panel tone="light" className="divide-y divide-line p-0">
          <div className="flex items-center justify-between px-card py-3.5">
            <span className="flex items-center gap-2.5">
              <ClockIcon className="h-5 w-5 text-ink-mute" />
              <span className="text-sm text-ink">Timezone</span>
            </span>
            <TimeZoneNote />
          </div>
          <div className="flex items-center justify-between px-card py-3.5">
            <span className="flex items-center gap-2.5">
              <DownloadIcon className="h-5 w-5 text-ink-mute" />
              <span className="text-sm text-ink">Install app</span>
            </span>
            <span className="text-xs text-ink-mute">Add to Home Screen</span>
          </div>
        </Panel>
        <p className="mt-2 px-1 text-xs text-ink-mute">
          Times shown in your device timezone. Install from your browser&apos;s share menu for a full-screen,
          app-like experience.
        </p>
      </div>

      {/* Logout */}
      <Button variant="outline" block onClick={handleLogout}>
        <LogOutIcon />
        Log out
      </Button>

      <CreateGroupModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
