"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { Field, FieldRow } from "@/components/ui/Field";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Label } from "@/components/ui/Label";
import { EditProfileModal } from "@/components/account/EditProfileModal";
import { JoinByCode } from "@/components/account/JoinByCode";
import { CheckIcon, ChevronDownIcon, InfoIcon, LogOutIcon } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";
import { selectLeague, updateAvatar, updateFavoriteAnimal } from "@/app/app/actions";
import { isStaleDeploymentError, reloadOnce } from "@/lib/deploy-skew";
import { FAVORITE_ANIMALS, isFavoriteAnimal } from "@/lib/profile/animals";
import type { AccountData, LeagueSummary, Viewer } from "@/lib/league/load";

const ACCEPT = "image/png,image/jpeg,image/webp";
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

/** An inline error line — the app's standard treatment, hex and all. */
function ErrorLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-xs leading-relaxed text-[#8A2C2C]">
      <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {children}
    </p>
  );
}

/**
 * The page's title block: the player's portrait over "Your Account".
 *
 * The portrait is the avatar upload — tapping it opens the file picker, with no
 * separate edit mode to enter first. Bytes go straight to Supabase Storage from
 * the browser; only the resulting URL is persisted through a server action, so
 * the caches revalidate and the header picks the new image up.
 */
function AccountHeader({ viewer }: { viewer: Viewer }) {
  const router = useRouter();
  const [avatarUrl, setAvatarUrl] = useState(viewer.avatarUrl);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        setError("Couldn't save your photo.");
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

  return (
    <header className="flex flex-col items-center gap-2 border-b border-line pb-4 pt-1">
      <label
        className="tap-target group relative cursor-pointer rounded-control focus-within:ring-2 focus-within:ring-brand-strong/70 focus-within:ring-offset-2"
        title="Change your photo"
      >
        <Avatar
          firstName={viewer.firstName}
          lastName={viewer.lastName}
          avatarUrl={avatarUrl}
          size={60}
          shape="square"
        />
        <span className="absolute inset-0 grid place-items-center rounded-control bg-ink/45 text-[10px] font-semibold uppercase tracking-wide text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          {uploading ? "…" : "Edit"}
        </span>
        <input
          type="file"
          accept={ACCEPT}
          onChange={handleFile}
          disabled={uploading}
          className="sr-only"
          aria-label="Upload a profile photo"
        />
      </label>

      <h1 className="text-center text-[1.75rem] font-bold leading-[1.4] text-black">Your Account</h1>
      {error ? <ErrorLine>{error}</ErrorLine> : null}
    </header>
  );
}

/**
 * The favorite-animal picker: a native <select> painted to read as the field's
 * value with a chevron, not as a form control. Native keeps the iOS wheel and
 * the platform keyboard behaviour, which no hand-rolled dropdown would.
 *
 * Saves on change — there is no Save button on this page — and rolls the
 * displayed value back if the write fails.
 */
function FavoriteAnimalField({ value }: { value: string | null }) {
  const router = useRouter();
  // An unrecognised stored value (list changed, or edited by hand in SQL) reads
  // as unset rather than rendering an option that isn't there.
  const initial = isFavoriteAnimal(value) ? value : "";
  const [animal, setAnimal] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function change(next: string) {
    const previous = animal;
    setAnimal(next);
    setError(null);
    startTransition(async () => {
      try {
        const res = await updateFavoriteAnimal(next === "" ? null : next);
        if (!res.ok) {
          setAnimal(previous);
          setError("Couldn't save that. Try again.");
          return;
        }
        router.refresh();
      } catch (err) {
        // A deploy landed while this tab was open — reload onto the new build.
        if (isStaleDeploymentError(err) && reloadOnce()) return;
        setAnimal(previous);
        setError("Couldn't save that. Try again.");
      }
    });
  }

  return (
    <Field label="Favorite animal">
      <span className="relative inline-flex items-center self-start">
        <select
          value={animal}
          disabled={pending}
          onChange={(e) => change(e.target.value)}
          aria-label="Favorite animal"
          className={
            animal
              ? "cursor-pointer appearance-none rounded bg-transparent pr-6 text-lg font-semibold leading-[1.2] text-ink disabled:opacity-60"
              : "cursor-pointer appearance-none rounded bg-transparent pr-6 text-lg font-medium leading-[1.2] text-link disabled:opacity-60"
          }
        >
          <option value="">Choose one</option>
          {FAVORITE_ANIMALS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <ChevronDownIcon
          className={`pointer-events-none absolute right-0 h-4 w-4 ${animal ? "text-ink" : "text-link"}`}
        />
      </span>
      {error ? <ErrorLine>{error}</ErrorLine> : null}
    </Field>
  );
}

/** Plain-language standing, from the member's status and the season's phase. */
function statusLabel({ status, phase }: Pick<LeagueSummary, "status" | "phase">): string {
  if (status === "eliminated") return "Eliminated";
  if (phase === "preseason") return "Pre-season";
  if (phase === "ended") return "Season over";
  return "In Season";
}

/**
 * One membership. "Select League" is the app's league switcher: it writes the
 * active-league cookie, so My Picks, Standings and the header survivor strip all
 * follow. The card for the league already active says so instead.
 */
function LeagueCard({ league, active }: { league: LeagueSummary; active: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function select() {
    if (active || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await selectLeague(league.group.id);
        if (!res.ok) {
          setError(
            res.error === "not_a_member"
              ? "You're no longer in that league."
              : "Couldn't switch leagues. Try again.",
          );
          return;
        }
        router.refresh();
      } catch (err) {
        // A deploy landed while this tab was open — reload onto the new build.
        if (isStaleDeploymentError(err) && reloadOnce()) return;
        setError("Couldn't switch leagues. Try again.");
      }
    });
  }

  return (
    <div className="rounded-control border border-line bg-fill-soft p-4">
      <div className="grid items-center gap-4 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
        <Field label="League name" value={league.group.name} />
        <Field label="Your role" value={league.role === "admin" ? "Admin" : "Player"} />
        <Field label="Your status" value={statusLabel(league)} />
        <Button
          variant="outline"
          size="lg"
          block
          disabled={active || pending}
          onClick={select}
          className="bg-white"
        >
          {active ? <CheckIcon /> : null}
          {active ? "Selected" : pending ? "Switching…" : "Select League"}
        </Button>
      </div>
      {error ? <div className="mt-3">
        <ErrorLine>{error}</ErrorLine>
      </div> : null}
    </div>
  );
}

/** One row of the Preferences card. */
function PreferenceRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
      <span className="text-lg font-semibold leading-[1.2] text-ink">{label}</span>
      {children}
    </div>
  );
}

export function AccountClient({ account }: { account: AccountData }) {
  const { viewer, leagues, activeGroupId } = account;
  const [editOpen, setEditOpen] = useState(false);

  const activeLeague = leagues.find((l) => l.group.id === activeGroupId) ?? null;
  const hasName = viewer.firstName.trim().length > 0;

  async function handleLogout() {
    try {
      await createClient().auth.signOut();
    } catch {
      // Supabase not configured — just return to the sign-in screen.
    }
    window.location.href = "/login";
  }

  return (
    <div className="stagger space-y-6">
      {/* Identity */}
      <section>
        <AccountHeader viewer={viewer} />

        <FieldRow>
          <Field
            label="Name"
            value={hasName ? viewer.name : null}
            emptyLabel="Add"
            onEdit={() => setEditOpen(true)}
          />
          <Field label="Email" value={viewer.email} />
          <Field
            label="Number (optional)"
            value={account.phone}
            emptyLabel="Add"
            onEdit={() => setEditOpen(true)}
          />
        </FieldRow>

        <FieldRow>
          <FavoriteAnimalField value={viewer.favoriteAnimal} />
          {activeLeague ? (
            <Field
              label="Did you pay the buy in?"
              value={activeLeague.buyInPaid ? "Yes!" : "Not yet"}
            />
          ) : (
            <div />
          )}
          {/* Third cell keeps the row on the same three-column rhythm as the one
              above it. The design spec carries a hidden field here too. */}
          <div />
        </FieldRow>

        {activeLeague ? (
          <p className="pt-3 text-xs leading-relaxed text-ink-mute">
            Buy-in is tracked per league and set by your admin — nothing for you to do here.
          </p>
        ) : null}
      </section>

      {/* Leagues */}
      <section>
        <SectionHeader
          title="Your Leagues"
          right={
            <Label>
              {leagues.length} {leagues.length === 1 ? "league" : "leagues"}
            </Label>
          }
        />

        <div className="mt-3 space-y-3">
          {leagues.map((league) => (
            <LeagueCard
              key={league.group.id}
              league={league}
              active={league.group.id === activeGroupId}
            />
          ))}

          {leagues.length === 0 ? (
            <p className="text-sm text-ink-mute">
              You&apos;re not in a league yet. Join with an invite code.
            </p>
          ) : null}

          {/* Joining is the only way into a league — the inaugural season runs a
              single league, so there is no "create" path in the product. */}
          <div className="flex justify-center py-3">
            <div className="w-full min-w-[260px] max-w-[390px]">
              <JoinByCode />
            </div>
          </div>
        </div>
      </section>

      {/* Preferences — placeholder surface. Nothing here is wired up yet; the
          rows exist so the shape of the settings is visible and reviewable. */}
      <section>
        <SectionHeader title="Preferences" />
        <Panel tone="light" className="mt-3 divide-y divide-line bg-fill-raised p-0">
          <PreferenceRow label="Notifications">
            <span className="text-sm text-ink-mute">Coming soon</span>
          </PreferenceRow>
          <PreferenceRow label="Timezone">
            <span className="text-sm text-ink-mute">Coming soon</span>
          </PreferenceRow>
          <PreferenceRow label="Add to Home Screen">
            <Button variant="soft" disabled>
              Install App
            </Button>
          </PreferenceRow>
        </Panel>
        <p className="mt-2 px-1 text-xs leading-relaxed text-ink-mute">
          Times are shown in your device timezone. To install, use{" "}
          <b className="font-semibold text-ink-soft">Add to Home Screen</b> in your browser&apos;s share
          menu — the in-app button is coming soon.
        </p>
      </section>

      <Button variant="outline" block onClick={handleLogout}>
        <LogOutIcon />
        Log out
      </Button>

      <EditProfileModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        viewer={viewer}
        currentPhone={account.phone}
      />
    </div>
  );
}
