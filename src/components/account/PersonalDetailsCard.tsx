"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Label";
import { ChevronDownIcon, InfoIcon } from "@/components/icons";
import { updateFavoriteAnimal } from "@/app/app/actions";
import { isStaleDeploymentError, reloadOnce } from "@/lib/deploy-skew";
import { FAVORITE_ANIMALS, isFavoriteAnimal } from "@/lib/profile/animals";
import { cn } from "@/lib/cn";
import { SPEC_BUTTON_DARK } from "./spec";
import { AccountSection, CARD, VALUE } from "./surfaces";
import type { Viewer } from "@/lib/league/load";

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
 * One row of the card: an uppercase label over its value, on a hairline.
 *
 * The label stays *over* the value at every width, unlike the version this
 * replaces. The card itself now runs two rows across at `lg`, but a grid cell is
 * only ~300px there — narrower than the old 322px column was — so there is still
 * no room for the side-by-side label/value form the old card switched to at
 * `sm`. What changed is how many rows sit beside each other, not what a row is.
 *
 * `first` drops the top padding rather than the parent using `first:pt-0`: the
 * rows are siblings in a flex column with its own gap, and a `:first-child`
 * selector here would silently start applying to the wrong row the moment
 * anything is inserted above them.
 *
 * **`first` is a MOBILE-only concept, which is why `lg:pt-2` is unconditional.**
 * At `lg` Name and Email are two cells of the SAME grid row. Suppressing the
 * first cell's top padding there would start its label 8px above its
 * neighbour's inside one row — two labels on one line, not level. The mobile
 * stack is the only place a "first" row exists.
 */
function DetailRow({
  label,
  first = false,
  children,
}: {
  label: string;
  first?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 border-b border-shell-line pb-2.5 lg:pb-2 lg:pt-2",
        !first && "pt-3",
      )}
    >
      {/* No colour class: `Label` is already the spec's 12px/#757575, and
          passing one would drag its docblock's tailwind-merge trap in. */}
      <Label>{label}</Label>
      {children}
    </div>
  );
}

/** A row's read-only value, or an em dash when there's nothing to show. */
function RowValue({ value }: { value: string | null }) {
  const filled = Boolean(value && value.length > 0);
  return (
    <span className={cn(VALUE, "block truncate", !filled && "text-shell-mute")}>
      {filled ? value : "—"}
    </span>
  );
}

/**
 * The favorite-animal picker: a native <select> painted to read as the row's
 * value with a chevron, not as a form control. Native keeps the iOS wheel and
 * the platform keyboard behaviour, which no hand-rolled dropdown would.
 *
 * This is the app's only remaining select-in-disguise. `WeekPicker` wore the
 * same one until the week selector became a scrolling strip; the argument for
 * the technique is written out in `docs/prd-app-navigation.md`.
 *
 * It is also still the app's avatar picker — the selection is what every Avatar
 * elsewhere renders — even though this page no longer shows a portrait of its
 * own. That is the one thing lost in the redesign: the mock-ups have no avatar
 * on this screen, so a player picks their animal here and sees the result on
 * Standings.
 *
 * Saves on change — there is no Save button on this card — and rolls the
 * displayed value back if the write fails.
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
      {/*
        The chevron has to sit 4px after the *selected* word, as the design draws
        it — and a styled <select> cannot do that. A select's box is as wide as
        its widest option ("Choose one" at 127px), not as wide as the option
        showing, so a chevron pinned to its right edge lands 70px past "Koala"
        and reads as a stray glyph at the card's edge. Measured, not guessed.

        So the text and the chevron are drawn as ordinary content, and the real
        <select> lies over them at `opacity-0`. It is still the interactive
        element — still focusable, still the iOS wheel, still the platform
        keyboard behaviour that no hand-rolled dropdown reproduces — it is just
        invisible. `w-max` on the wrapper for the reason CLAUDE.md gives for
        PickHero's logo: `max-content` is a definite width, so a stretched flex
        parent cannot pull it wide.
      */}
      <span className="relative inline-flex w-max items-center gap-1 self-start">
        <span aria-hidden className={cn(VALUE, !animal && "font-medium text-link")}>
          {animal || "Choose one"}
        </span>
        <ChevronDownIcon
          aria-hidden
          className={cn("h-4 w-4 shrink-0", animal ? "text-shell-ink" : "text-link")}
        />
        <select
          value={animal}
          disabled={pending}
          onChange={(e) => change(e.target.value)}
          aria-label="Favorite animal"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
        >
          <option value="">Choose one</option>
          {FAVORITE_ANIMALS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </span>
      {error ? (
        <div className="pt-2">
          <ErrorLine>{error}</ErrorLine>
        </div>
      ) : null}
    </>
  );
}

/**
 * "Personal Details" — the account page's second block, third for an admin: a
 * stacked list on a phone, two rows across at `lg`.
 *
 * Everything on it is read-only except the favorite animal, which saves itself:
 * `onEdit` opens the name/phone sheet, and email is not editable anywhere (it is
 * the identity the magic link is addressed to).
 */
export function PersonalDetailsCard({
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
    <AccountSection title="Personal Details">
      {/* The mock-up's mobile card is 16/20 and its desktop card 20/20. Four
          pixels, and the mock-ups are explicit about both: the desktop card,
          which is the full 656 and carries its rows two-up, breathes a little
          more at the top than the phone's.

          `gap-y-1.5` rather than `gap-1.5` so the two axes are named separately
          and neither `lg:gap-x-6` nor `lg:gap-y-3` has to out-order a shorthand
          to take effect. `flex-col` is simply inert once the container is a
          grid, and `grid-cols-2` is `minmax(0,1fr)`, so `RowValue`'s `truncate`
          keeps the zero min-width it needs. */}
      <div
        className={cn(
          CARD,
          "flex flex-col gap-y-1.5 pb-5 pt-4",
          "lg:grid lg:grid-cols-2 lg:gap-x-6 lg:gap-y-3 lg:pt-5",
        )}
      >
        <DetailRow label="Name" first>
          <RowValue value={hasName ? viewer.name : null} />
        </DetailRow>
        <DetailRow label="Email">
          <RowValue value={viewer.email} />
        </DetailRow>
        <DetailRow label="Number">
          <RowValue value={phone} />
        </DetailRow>
        <DetailRow label="Favorite Animal">
          <FavoriteAnimalValue animal={animal} setAnimal={setAnimal} />
        </DetailRow>

        {/* A wrapper so the inline-flex button hugs its text instead of
            stretching to the card's width. `lg:col-span-2` because the button is
            one full-width row under the grid, not a fifth field beside one. */}
        <div className="pt-5 lg:col-span-2 lg:pt-4">
          <Button
            variant="ghost"
            size="sm"
            className={cn(SPEC_BUTTON_DARK, "h-10 min-w-[100px]")}
            onClick={onEdit}
          >
            Edit
          </Button>
        </div>
      </div>
    </AccountSection>
  );
}
