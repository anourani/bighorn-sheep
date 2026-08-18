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
 * Stacked at every width, unlike the version this replaces — the mock-ups show
 * the same label-over-value on a 393px phone and a 1440px desktop, and the
 * column is only 322px on the desktop anyway, so there was never room for the
 * side-by-side form the old card switched to at `sm`.
 *
 * `first` drops the top padding rather than the parent using `first:pt-0`: the
 * rows are siblings in a flex column with its own gap, and a `:first-child`
 * selector here would silently start applying to the wrong row the moment
 * anything is inserted above them.
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
    <div className={cn("flex flex-col gap-2 border-b border-shell-line pb-2.5", !first && "pt-3")}>
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
 * "Personal Details" — the left column of the account page.
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
          pixels, but they are what keeps the two columns' first hairlines level
          on desktop while the phone card sits a little tighter. */}
      <div className={cn(CARD, "flex flex-col gap-1.5 pb-5 pt-4 lg:pt-5")}>
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
            stretching to the card's width. */}
        <div className="pt-5 lg:pt-6">
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
