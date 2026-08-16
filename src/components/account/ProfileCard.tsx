"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Label";
import { ChevronDownIcon, InfoIcon } from "@/components/icons";
import { updateFavoriteAnimal } from "@/app/app/actions";
import { isStaleDeploymentError, reloadOnce } from "@/lib/deploy-skew";
import { FAVORITE_ANIMALS, isFavoriteAnimal } from "@/lib/profile/animals";
import type { Viewer } from "@/lib/league/load";

/**
 * The design's white-on-white control: 40px tall, 16px semibold, a `#D9D9D9`
 * hairline. Shared with the Preferences card's "Install App", which is the same
 * button at a different size in name only.
 *
 * Overrides rather than a new `Button` size: 40px sits between `sm` (36) and
 * `md` (44) and exists on exactly two controls, so a sixth size axis on a
 * primitive every screen uses would be the more expensive answer. Each class
 * here lands in the same tailwind-merge group as the one it replaces, and
 * `className` is applied last in `Button`, so all five take effect.
 */
export const SPEC_BUTTON = "h-10 border-shell-line px-3 text-base font-semibold text-shell-ink";

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
 * One row of the profile card: an uppercase label and its value over a hairline.
 *
 * The two layouts are the design's, not a fitting constraint — the column is
 * 420px at every width the app renders (361px inside `main`'s padding on a
 * phone, capped at 420 on a desktop), so the side-by-side form would fit on a
 * phone too. There is no intrinsic signal to key off, which is why this is one
 * of the very few places in `src/` reaching for a breakpoint prefix rather than
 * the house auto-fit grid.
 */
function ProfileRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-shell-line px-1 pb-2.5 pt-3">
      {/* `items-start`, matching the spec: the 12px label's line box tops out
          level with the 18px value's, so it reads a few pixels high rather than
          centred against it. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-5">
        {/* No colour class: `Label` is already the spec's 12px/#757575, and
            passing one would drag its docblock's tailwind-merge trap in. */}
        <Label className="sm:w-[110px] sm:shrink-0">{label}</Label>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

/** A row's read-only value, or an em dash when there's nothing to show. */
function RowValue({ value }: { value: string | null }) {
  const filled = Boolean(value && value.length > 0);
  return (
    <span
      className={
        filled
          ? "block truncate text-lg font-semibold leading-[1.2] text-shell-ink"
          : "block text-lg font-semibold leading-[1.2] text-shell-mute"
      }
    >
      {filled ? value : "—"}
    </span>
  );
}

/**
 * The favorite-animal picker: a native <select> painted to read as the row's
 * value with a chevron, not as a form control. Native keeps the iOS wheel and
 * the platform keyboard behaviour, which no hand-rolled dropdown would — the
 * same disguise `WeekPicker` wears.
 *
 * This is also the app's avatar picker — the selection is what the portrait
 * above and every avatar elsewhere render — so the value is owned by
 * {@link ProfileCard} and shared with the portrait rather than kept local.
 *
 * Saves on change — there is no Save button on this card — and rolls the
 * displayed value back if the write fails, which rolls the portrait back too.
 */
function FavoriteAnimalValue({
  animal,
  setAnimal,
}: {
  animal: string;
  setAnimal: (next: string) => void;
}) {
  const router = useRouter();
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
    <>
      {/* inline-flex so the wrapper hugs the text and the absolute chevron lands
          right after it, as the design shows — in either row orientation. */}
      <span className="relative inline-flex items-center">
        <select
          value={animal}
          disabled={pending}
          onChange={(e) => change(e.target.value)}
          aria-label="Favorite animal"
          className={
            animal
              ? "cursor-pointer appearance-none rounded bg-transparent pr-6 text-lg font-semibold leading-[1.2] text-shell-ink disabled:opacity-60"
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
          className={`pointer-events-none absolute right-0 h-4 w-4 ${animal ? "text-shell-ink" : "text-link"}`}
        />
      </span>
      {error ? <div className="pt-2">
        <ErrorLine>{error}</ErrorLine>
      </div> : null}
    </>
  );
}

/**
 * The account's identity surface: the player's portrait overlapping a card of
 * their details.
 *
 * The portrait is not editable in itself — it renders whatever the Favorite
 * animal row below is showing, which is the only way to change an avatar. This
 * component therefore owns the selected animal and hands it to both, so the
 * portrait turns over the instant the row does instead of waiting on the server
 * round-trip, and reverts with it when a write fails.
 *
 * Everything else on the card is read-only here: `onEdit` opens the name/phone
 * sheet, and the favorite animal saves itself.
 */
export function ProfileCard({
  viewer,
  phone,
  onEdit,
}: {
  viewer: Viewer;
  /** Private data, loaded only for this page — see `AccountData.phone`. */
  phone: string | null;
  onEdit: () => void;
}) {
  // An unrecognised stored value (list changed, or edited by hand in SQL) reads
  // as unset rather than rendering an option that isn't there.
  const [animal, setAnimal] = useState(
    isFavoriteAnimal(viewer.favoriteAnimal) ? viewer.favoriteAnimal : "",
  );

  const hasName = viewer.firstName.trim().length > 0;

  return (
    <section className="isolate flex flex-col items-center">
      {/* `ring-1 ring-black` is applied after Avatar's own `ring-2
          ring-white/20` and lands in the same tailwind-merge groups, so it
          wins — the design's hairline, with no change to the primitive. The
          initials fallback stays: the mock's blank white disc is a placeholder
          for this slot, not a better empty state than "AN" on the brand fill,
          and it is what a player without an animal still sees. */}
      <div className="relative z-10 -mb-6 sm:-mb-20">
        <Avatar
          firstName={viewer.firstName}
          lastName={viewer.lastName}
          favoriteAnimal={animal || null}
          size={160}
          shape="circle"
          className="ring-1 ring-black"
        />
      </div>

      {/*
        The top padding clears the portrait, which hangs 24px into the card on a
        phone and 80px on a desktop. Figma reserves that space with a fixed
        380px height and `justify-end`; transcribing its declared 40px padding
        literally would put the NAME row under the portrait on desktop. Height
        is content-driven here instead — a long email wraps, and a fixed height
        would clip it.
      */}
      <div className="w-full rounded-[20px] border border-shell-line bg-white px-4 pb-4 pt-10 sm:pt-24">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <ProfileRow label="Name">
              <RowValue value={hasName ? viewer.name : null} />
            </ProfileRow>
            <ProfileRow label="Email">
              <RowValue value={viewer.email} />
            </ProfileRow>
            <ProfileRow label="Number">
              <RowValue value={phone} />
            </ProfileRow>
            <ProfileRow label="Favorite animal">
              <FavoriteAnimalValue animal={animal} setAnimal={setAnimal} />
            </ProfileRow>
          </div>

          {/* A wrapper so the inline-flex button hugs its text instead of
              stretching to the column's width. */}
          <div>
            <Button variant="outline" size="sm" className={SPEC_BUTTON} onClick={onEdit}>
              Edit
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
