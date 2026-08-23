"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Drawer } from "@/components/ui/Drawer";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Label";
import { Pill } from "@/components/ui/Badge";
import { Switch } from "@/components/ui/Switch";
import { Tabs, TabPanel } from "@/components/ui/Tabs";
import { LocalTime } from "@/components/ui/LocalTime";
import { CopyIcon, CheckIcon, LockIcon, InfoIcon } from "@/components/icons";
import {
  getFeedStatus,
  runFeedCheck,
  setGroupBuyIn,
  setGroupName,
  setGroupRules,
  setMemberBuyIn,
  setMemberPreseason,
  removeMember,
} from "@/app/app/actions";
import { isEntryOpen } from "@/lib/game/season";
import { formatMoney } from "@/lib/money";
import { formatMonthDayClock } from "@/lib/time";
import {
  agoLabel,
  describeFeed,
  describeFeedDetail,
  mapFeedStatus,
  providerLabel,
  type FeedSnapshot,
} from "@/lib/league/feed";
import { isStaleDeploymentError, reloadOnce } from "@/lib/deploy-skew";
import type { SeasonPhase } from "@/lib/game/season";
import type { EliminationType, Group, Member, TieRule } from "@/lib/league/types";

/**
 * One dictionary for every code the five admin actions can return.
 *
 * Shared rather than one map per section because the codes overlap heavily
 * (`not_admin`, `not_authenticated` and `unexpected_error` come back from all of
 * them) and because the repo's documented failure mode is raw Postgres text
 * arriving one `?? res.error` from the UI. A single lookup with a fallback is
 * what keeps a constraint name off the screen.
 */
const ADMIN_ERROR_COPY: Record<string, string> = {
  not_admin: "Only an admin can change that.",
  not_authenticated: "Your session expired — sign in again.",
  member_not_found: "That member is no longer in the league.",
  group_not_found: "That league is gone.",
  entry_closed: "Entry has closed — the roster is locked for the season.",
  cannot_remove_self: "You can't remove yourself.",
  cannot_remove_admin: "Admins can't be removed.",
  remove_failed: "Couldn't remove that member. Try again.",
  name_required: "Give the league a name.",
  name_too_long: "That name is too long — 60 characters max.",
  settings_locked: "The season has started, so the rules are frozen.",
  preseason_closed: "Preseason is over — that can't be changed now.",
  bad_elimination_type: "Pick one of the two elimination types.",
  bad_tie_rule: "Pick one of the two tie rules.",
  bad_amount: "Enter an amount of zero or more.",
  // The one that used to be a mystery. Every ladder in actions.ts ends in a
  // catch-all, and a database missing its migration landed there — so "the
  // admin panel needs a migration applied" rendered as "try again", which is an
  // invitation to click Save forever. `rpcErrorCode` now names it.
  migration_missing:
    "This needs a database update that hasn't been applied to Supabase yet.",
  // Reached only when the RPC failed for some OTHER reason; the detail is in the
  // Netlify function log.
  name_update_failed: "Couldn't save that. Try again.",
  rules_update_failed: "Couldn't save that. Try again.",
  preseason_update_failed: "Couldn't save that. Try again.",
  buy_in_update_failed: "Couldn't save that. Try again.",
  feed_status_unavailable: "Couldn't read the feed status.",
  poll_too_soon: "Just checked — give it a minute.",
  feed_poll_unavailable: "Manual checks aren't configured on this deployment.",
  poll_failed: "The check ran, but reading the result back failed.",
  unexpected_error: "Something went wrong on our end. Try again in a moment.",
};

function copyFor(code: string): string {
  return ADMIN_ERROR_COPY[code] ?? "Couldn't save that. Try again.";
}

const INPUT_CLASS =
  "w-full rounded-control border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-mute/60 focus-visible:border-brand-strong";

/**
 * One bordered card with a heading and a status pill on the right.
 *
 * Introduced for the Rules tab, where the two cards it holds lock on DIFFERENT
 * conditions — the game rules freeze at the first Week 1 kickoff, the entry fee
 * never freezes at all. Stating that per card is the entire reason this tab is
 * two cards instead of one column: a single lock affordance covering both would
 * be wrong about one of them whichever way it read.
 */
function SettingsCard({
  heading,
  pill,
  children,
}: {
  heading: React.ReactNode;
  pill?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-control border border-line bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <SectionHeading>{heading}</SectionHeading>
        {pill ?? null}
      </div>
      {children}
    </section>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <Label>{children}</Label>;
}

function ErrorLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-xs leading-relaxed text-[#8A2C2C]">
      <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {children}
    </p>
  );
}

function HintLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-xs leading-relaxed text-ink-mute">
      <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {/* The whole hint is ONE flex item, and the span is what makes it one. A
          flex container builds an item out of every child ELEMENT and every run
          of bare text between them — so a caller embedding a <LocalTime> mid
          sentence would, without this, have its sentence broken into three
          items with the icon's gap-1.5 opened up inside the prose. Every hint
          was plain text until the entry deadline started being printed, which
          is why nothing caught it earlier. */}
      <span>{children}</span>
    </p>
  );
}

/**
 * Run a server action, mapping its result to an error string and handling the
 * one failure mode every call site in this app shares.
 *
 * Server Action IDs are build hashes, so a tab left open across a deploy posts
 * an ID the running server has never heard of. `reloadOnce` swaps the tab onto
 * the new build instead of showing a meaningless error.
 */
async function runAction(
  call: () => Promise<{ ok: true } | { ok: false; error: string }>,
): Promise<string | null> {
  try {
    const res = await call();
    return res.ok ? null : copyFor(res.error);
  } catch (err) {
    if (isStaleDeploymentError(err) && reloadOnce()) return null;
    return copyFor("unexpected_error");
  }
}

/**
 * The league's name — always editable, which is the whole point.
 *
 * Lives on the Name tab beside the invite. It used to sit ABOVE the tab bar, in
 * `Drawer`'s `aside` slot, on the argument that it names the thing all the tabs
 * are about and burying it would make "rename any time" mean "rename any time
 * you're on the right tab". What changed is that it now shares a tab with the
 * invite link rather than being buried in one about something else: the name and
 * the invite are both the league's identity, where the other three tabs are the
 * roster, the game's rules and the scorer's health. The header is back to the
 * one thing it was always good at — saying which panel you are in.
 *
 * Writes through `set_group_name` (0011), which has no lock check — 0001's RLS
 * policy refuses every `groups` update once the season starts, and a typo in a
 * league name is exactly the thing you notice after kickoff.
 *
 * `id="group-name"` is hardcoded and paired with the `htmlFor` above it, so this
 * must render exactly once. A tab branch guarantees that: only the active tab is
 * mounted.
 */
function GroupNameSection({ group }: { group: Group }) {
  const router = useRouter();
  const [name, setName] = useState(group.name);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const trimmed = name.trim();
  const dirty = trimmed !== group.name && trimmed.length > 0;

  function save() {
    if (!dirty) return;
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const err = await runAction(() => setGroupName({ groupId: group.id, name: trimmed }));
      if (err) {
        setError(err);
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
      router.refresh();
    });
  }

  return (
    <section className="space-y-2">
      <label htmlFor="group-name" className="block">
        <SectionHeading>League name</SectionHeading>
      </label>
      <div className="flex items-center gap-2">
        <input
          id="group-name"
          value={name}
          maxLength={60}
          disabled={pending}
          onChange={(e) => setName(e.target.value)}
          // Enter saves: this is a one-field form and there is no surrounding
          // <form> to submit.
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
          }}
          className={INPUT_CLASS}
        />
        <Button variant="secondary" size="md" disabled={!dirty || pending} onClick={save}>
          {pending ? "Saving…" : saved ? "Saved" : "Save"}
        </Button>
      </div>
      {error ? <ErrorLine>{error}</ErrorLine> : null}
    </section>
  );
}

/**
 * Elimination type and tie rule — the two things that decide how the game is
 * played, and the two that must stop changing once it is being played.
 *
 * Native radios inside a `<fieldset disabled>`: disabling propagates to every
 * control for free, and the `<legend>` names the group to a screen reader.
 * Nothing here is a `Segmented`, deliberately — a second `role="tablist"` inside
 * a dialog that already has one would be a genuine a11y bug.
 *
 * The lock tests TWO facts, matching `set_group_rules` exactly: the
 * `settings_locked_at` column 0001 declared for the job, and `entryClosesAt` in
 * the past. It has to test both because NOTHING IN THIS PROJECT HAS EVER WRITTEN
 * the column — on its own it would never lock, and the rules would stay editable
 * in Week 12.
 */
function RulesSection({ group }: { group: Group }) {
  const router = useRouter();
  const entryClosed = new Date(group.entryClosesAt).getTime() <= Date.now();
  const locked = Boolean(group.settingsLockedAt) || entryClosed;

  const [eliminationType, setEliminationType] = useState<EliminationType>(
    group.rules.eliminationType,
  );
  const [tieRule, setTieRule] = useState<TieRule>(group.rules.tieRule);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const dirty =
    eliminationType !== group.rules.eliminationType || tieRule !== group.rules.tieRule;

  function save() {
    if (!dirty || locked) return;
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const err = await runAction(() =>
        setGroupRules({ groupId: group.id, eliminationType, tieRule }),
      );
      if (err) {
        setError(err);
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
      router.refresh();
    });
  }

  return (
    <SettingsCard
      heading="Game rules"
      pill={
        locked ? (
          <Pill variant="hidden" icon={<LockIcon />}>
            Frozen
          </Pill>
        ) : (
          <Pill variant="neutral">Editable</Pill>
        )
      }
    >
      {/* THE FIELDSET STOPS HERE — it wraps the two radio groups and nothing
          else. The buy-in card beside this one writes through
          `set_group_buy_in`, which has no lock check of any kind, so sweeping it
          into this fieldset would grey out a control the database would have
          accepted and tell an admin their entry fee is frozen when it is not.
          That is the exact confusion this tab was split in two to prevent. */}
      <fieldset disabled={locked || pending} className="space-y-5">
        <RadioGroup
          legend="Elimination"
          name="elimination-type"
          value={eliminationType}
          onChange={(v) => setEliminationType(v as EliminationType)}
          options={[
            { value: "single", label: "Single", hint: "One loss and you're out." },
            { value: "two_time", label: "Two-time", hint: "Two losses before you're out." },
          ]}
        />
        <RadioGroup
          legend="Tie rule"
          name="tie-rule"
          value={tieRule}
          onChange={(v) => setTieRule(v as TieRule)}
          options={[
            { value: "push", label: "Push", hint: "A tie is neither a win nor a loss." },
            { value: "loss", label: "Loss", hint: "A tie counts against you." },
          ]}
        />
      </fieldset>

      {locked ? (
        <HintLine>
          The season has started, so the elimination and tie rules are frozen. The buy-in and the
          league name are still editable.
        </HintLine>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" disabled={!dirty || pending} onClick={save}>
            {pending ? "Saving…" : saved ? "Saved" : "Save rules"}
          </Button>
          <p className="text-xs text-ink-mute">Locks at the first Week 1 kickoff.</p>
        </div>
      )}

      {/* The date, not just the phrase. `entry_closes_at` is literally what
          `set_group_rules` tests, and an admin deciding whether to change a rule
          wants to know how long they have, not that a deadline exists. */}
      <p className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-ink-mute">
        <span>Entry closes</span>
        <LocalTime iso={group.entryClosesAt} mode="full" className="font-medium text-ink-soft" />
      </p>

      {error ? <ErrorLine>{error}</ErrorLine> : null}
    </SettingsCard>
  );
}

function RadioGroup({
  legend,
  name,
  value,
  onChange,
  options,
}: {
  legend: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; hint: string }[];
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2">
        <SectionHeading>{legend}</SectionHeading>
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => {
          const id = `${name}-${o.value}`;
          const selected = value === o.value;
          return (
            <label
              key={o.value}
              htmlFor={id}
              className={[
                "flex cursor-pointer items-start gap-2.5 rounded-control border p-3 transition-colors",
                selected ? "border-brand-strong bg-[#F7F9FF]" : "border-line bg-[#FAFAFB]",
                // The whole tile is the hit target, so it has to look inert too
                // when the surrounding fieldset is disabled.
                "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60",
              ].join(" ")}
            >
              <input
                id={id}
                type="radio"
                name={name}
                value={o.value}
                checked={selected}
                onChange={() => onChange(o.value)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-brand-strong"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">{o.label}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-ink-mute">{o.hint}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * What the pot costs — a rule, and the one rule that is mandatory: paying it is
 * what it takes to be in the league.
 *
 * It lives on the RULES tab, beside elimination and ties, rather than beside the
 * per-member paid switches in {@link MembersSection}. The two are related but
 * they are not the same kind of thing: the amount is a condition of entry that
 * applies to everyone, and who has handed it over is bookkeeping about people.
 * Splitting them costs one cross-reference in each direction — the hint below,
 * and one in the Members rail — and buys a Rules tab that holds every term of
 * the deal.
 *
 * Dollars in the inputs, cents in the database (`groups.buy_in_cents`,
 * `groups.site_fee_cents` — migration 0010). The conversion happens here, at the
 * one boundary, so nothing downstream has to wonder which unit it is holding.
 *
 * Writes through the `set_group_buy_in` RPC. `groups` DOES have an admin UPDATE
 * policy, unlike `group_members`, so this could have been a plain `.update()` —
 * but RLS cannot restrict which columns an update writes, so that would have
 * handed the browser `invite_code` and the rules columns too. The RPC writes
 * these two and nothing else.
 *
 * Deliberately still editable after the rules lock: locking freezes how the game
 * is played, and correcting what it costs is money admin. Getting the number
 * wrong is also exactly the sort of thing you discover after kickoff.
 * `set_group_buy_in` (0010) accordingly has no lock check and no entry-close
 * check — which is why this card sits OUTSIDE the fieldset next door and carries
 * its own "Always editable" pill. Sharing a tab with a control that freezes is
 * the one hazard of putting it here, and those two things are the answer to it.
 */
function BuyInAmountSection({ group }: { group: Group }) {
  const router = useRouter();
  const [buyIn, setBuyIn] = useState(dollars(group.buyInCents));
  const [fee, setFee] = useState(dollars(group.siteFeeCents));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const buyInCents = toCents(buyIn);
  const feeCents = toCents(fee);
  const valid = buyInCents !== null && feeCents !== null;
  const dirty =
    valid && (buyInCents !== group.buyInCents || feeCents !== group.siteFeeCents);

  function save() {
    if (!valid || !dirty) return;
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const err = await runAction(() =>
        setGroupBuyIn({ groupId: group.id, buyInCents, siteFeeCents: feeCents }),
      );
      if (err) {
        setError(err);
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
      router.refresh();
    });
  }

  return (
    <SettingsCard heading="Buy-in" pill={<Pill variant="neutral">Always editable</Pill>}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs text-ink-mute">What it costs to be in the league.</p>
        <span className="text-sm font-semibold text-ink tabular-nums">
          {valid ? `${formatMoney(buyInCents + feeCents)} total` : "—"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="group-buy-in" className="mb-1.5 block">
            <Label className="text-ink-mute">Buy in ($)</Label>
          </label>
          <input
            id="group-buy-in"
            inputMode="decimal"
            value={buyIn}
            disabled={pending}
            onChange={(e) => setBuyIn(e.target.value)}
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <label htmlFor="group-site-fee" className="mb-1.5 block">
            <Label className="text-ink-mute">Site fee ($)</Label>
          </label>
          <input
            id="group-site-fee"
            inputMode="decimal"
            value={fee}
            disabled={pending}
            onChange={(e) => setFee(e.target.value)}
            className={INPUT_CLASS}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" disabled={!dirty || pending} onClick={save}>
          {pending ? "Saving…" : saved ? "Saved" : "Save"}
        </Button>
        <p className="text-xs text-ink-mute">Shown on everyone&apos;s account page.</p>
      </div>
      <HintLine>
        Money admin never locks, so you can correct the amount after kickoff. Changing it
        doesn&apos;t touch anyone&apos;s paid switch. Those are on the Members tab.
      </HintLine>
      {!valid ? <ErrorLine>Enter a dollar amount of zero or more.</ErrorLine> : null}
      {error ? <ErrorLine>{error}</ErrorLine> : null}
    </SettingsCard>
  );
}

/** Cents to the editable dollar string — "2000" becomes "20", "2150" "21.50". */
function dollars(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/**
 * The dollar string back to cents, or null when it isn't a number.
 *
 * `Number("")` is 0 and `Number(" ")` is 0, which would turn an emptied field
 * into a silent "free league" rather than an error — hence the explicit blank
 * check before the parse.
 */
function toCents(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/** Which switch on which row is mid-flight. */
type PendingKey = `${string}:${"paid" | "preseason" | "remove"}`;

/**
 * Drop the overrides the server has caught up with, keeping the rest.
 *
 * Returns the SAME object when nothing changed, so the caller's `setState` bails
 * out instead of re-rendering on every refresh.
 */
function pruneAgreed(
  overrides: Record<string, boolean>,
  members: Member[],
  serverValue: (m: Member) => boolean,
): Record<string, boolean> {
  const keys = Object.keys(overrides);
  if (keys.length === 0) return overrides;

  const next: Record<string, boolean> = {};
  for (const m of members) {
    const override = overrides[m.id];
    if (override !== undefined && override !== serverValue(m)) next[m.id] = override;
  }
  return Object.keys(next).length === keys.length ? overrides : next;
}

/**
 * The roster, and the two things an admin can change per member: who has paid,
 * and who gets the preseason practice round.
 *
 * Both toggles write through RPCs, not table updates — `group_members` has no
 * UPDATE policy, so a direct write reports success and changes nothing. Each RPC
 * re-checks `is_group_admin` in Postgres, which is the real gate; rendering this
 * section to an admin is only a convenience.
 *
 * Pending state is keyed per (member, field) rather than one global id. With one
 * switch per row a single flag was merely coarse; with two it would grey out all
 * sixteen controls every time anyone flipped one.
 *
 * The preseason switch is live during preseason ONLY. Practice ends at the first
 * Week 1 kickoff and never returns, so after that the switch is disabled and
 * `set_member_preseason` refuses the write as well — there is no Week 11 in
 * which anyone's preseason can be turned back on. Disabled rather than hidden:
 * a control that vanishes reads as a bug, and the state is still worth seeing.
 */
function MembersSection({
  groupId,
  members,
  phase,
  entryClosesAt,
}: {
  groupId: string;
  members: Member[];
  phase: SeasonPhase;
  entryClosesAt: string;
}) {
  const router = useRouter();
  // Optimistic overlay, keyed by user id: only members whose switch has been
  // touched this session appear here, so a refresh from the server still wins
  // for everyone else.
  const [paidOverrides, setPaidOverrides] = useState<Record<string, boolean>>({});
  const [preseasonOverrides, setPreseasonOverrides] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<ReadonlySet<PendingKey>>(() => new Set());
  const [, startTransition] = useTransition();

  const paidFor = (m: Member) => paidOverrides[m.id] ?? m.buyInPaid;
  const preseasonFor = (m: Member) => preseasonOverrides[m.id] ?? m.showPreseason;

  /*
   * Retire each override once the server agrees with it.
   *
   * The overlay above exists to cover the gap between the tap and the refresh,
   * and nothing was ever clearing it — so an override outlived the write that
   * justified it and shadowed the server for the life of the mounted drawer. A
   * value changed by ANOTHER admin, or a write that silently landed differently
   * from what was optimistically shown, would never appear.
   *
   * Pruning on agreement rather than on write-success is what makes this safe:
   * an entry whose write is still in flight disagrees with the prop it has not
   * arrived in yet, so it survives and the switch does not flicker back.
   * `members` gets a fresh array identity from every server render, so this runs
   * on each refresh; dropping to the same object short-circuits the state update.
   */
  useEffect(() => {
    setPaidOverrides((o) => pruneAgreed(o, members, (m) => m.buyInPaid));
    setPreseasonOverrides((o) => pruneAgreed(o, members, (m) => m.showPreseason));
  }, [members]);
  const paidCount = members.filter(paidFor).length;
  // Matches set_member_preseason's own condition, so the UI and the database
  // close the window at the same moment.
  const preseasonOpen = phase === "preseason";
  // WHEN the window shut, not why. All this component knows is that
  // `entry_closes_at` is in the past — "the first Week 1 kickoff" is an
  // inference from it, and a deadline left on create_group's `now() + 7 days`
  // default makes that inference a false claim no one can check from here.
  // Printing the moment is the same trade the Rules tab already makes beside
  // "Entry closes", in the same format as the paid stamp one column over.
  const preseasonClosedStamp = formatMonthDayClock(entryClosesAt);
  // remove_member (0013) refuses after entry_closes_at, for the same reason
  // set_member_preseason does: the window in which a player can be un-joined is
  // exactly the window in which they could have joined. Read from the same
  // helper every other consumer uses, so the button and the database close
  // together. Derived separately from `preseasonOpen` above even though the two
  // almost always agree — `seasonPhase` has a third answer ("ended") that this
  // question does not, and collapsing them would make that coincidence load-bearing.
  //
  // `new Date()` in a render body is a hydration mismatch anywhere else in this
  // app; it is safe here because the drawer never renders on the server (`open`
  // starts false), which is the same licence `formatMonthDayClock` takes below.
  const removalOpen = isEntryOpen(new Date(entryClosesAt), new Date());

  // Which row is mid-"are you sure?". One at a time: a roster full of armed
  // delete buttons is how the wrong one gets pressed. Cleared on every success,
  // failure and cancel.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  function remove(m: Member) {
    const key: PendingKey = `${m.id}:remove`;
    if (pending.has(key)) return;
    setError(null);
    setPending((p) => new Set(p).add(key));
    startTransition(async () => {
      const err = await runAction(() => removeMember({ groupId, userId: m.id }));
      // No optimistic override here, unlike the two switches. Those overlay a
      // boolean on a row that stays put; this one removes the row, and a list
      // that drops an entry before the server has agreed has nothing to restore
      // it from if the write fails. The refresh is the update.
      if (err) setError(err);
      else router.refresh();
      setConfirmingId(null);
      setPending((p) => {
        const nextSet = new Set(p);
        nextSet.delete(key);
        return nextSet;
      });
    });
  }

  function toggle(m: Member, field: "paid" | "preseason", next: boolean) {
    const key: PendingKey = `${m.id}:${field}`;
    // Only this control is barred, and only while its own write is in flight.
    // The writes are genuinely independent — different rows, or different
    // columns of one row — so serialising them would buy nothing and cost an
    // admin the ability to work down the roster at speed.
    if (pending.has(key)) return;
    const setOverride = field === "paid" ? setPaidOverrides : setPreseasonOverrides;
    setError(null);
    setPending((p) => new Set(p).add(key));
    setOverride((o) => ({ ...o, [m.id]: next }));
    startTransition(async () => {
      const err = await runAction(() =>
        field === "paid"
          ? setMemberBuyIn({ groupId, userId: m.id, paid: next })
          : setMemberPreseason({ groupId, userId: m.id, show: next }),
      );
      if (err) {
        setOverride((o) => ({ ...o, [m.id]: !next }));
        setError(err);
      } else {
        router.refresh();
      }
      setPending((p) => {
        const nextSet = new Set(p);
        nextSet.delete(key);
        return nextSet;
      });
    });
  }

  return (
    <section className="space-y-2">
      <SectionHeading>
        Members · {members.length} · {paidCount} paid
      </SectionHeading>
      {/*
        NO max-h / overflow here, however long the roster gets. A scroll region
        inside a tab is the exact thing this layout exists to remove: the
        `Drawer` panel is the one scroller, so a long list scrolls the whole
        drawer rather than trapping a scrollbar inside a tab that is itself
        inside a scroller. A taller row is precisely what tempts a `max-h-64`.
      */}

      {/* The two switch tracks are 168 and 200 rather than the 112 and 140 they
          were in the rail's shadow, and that is what the reclaimed width was
          for. At the old widths "Paid · 8/21, 6:47 PM" and "Can see and pick
          preseason" each wrapped to two lines under their switch, which set the
          height of every row in the roster. Only the MEMBER track is `1fr`, so
          widening these takes the space out of a name column that had ~900px
          for "Jane D." and gives it to the two sub-lines that were short of it.

          aria-hidden below, and that is not an oversight. Every Switch below already
          carries its member's name in its own accessible label ("Buy-in paid —
          Jane D."), so these four words are decoration for sighted readers; left
          exposed, a screen reader would announce four orphan headings before
          every roster. Hidden below `lg`, where each row still labels itself. */}
      <div
        aria-hidden
        className="hidden gap-x-4 px-3 pb-1.5 lg:grid lg:grid-cols-[minmax(0,1fr)_72px_168px_200px_88px]"
      >
        <Label className="text-ink-mute">Member</Label>
        <span />
        <Label className="text-ink-mute">Paid</Label>
        <Label className="text-ink-mute">Preseason</Label>
        <span />
      </div>

      <ul className="divide-y divide-line rounded-control border border-line">
        {members.map((m) => {
          const paid = paidFor(m);
          const preseason = preseasonFor(m);
          // With the time, not just the date: an admin correcting a mistake
          // toggles this twice in a minute, and a bare "8/19" cannot show that
          // the second write landed. Called directly rather than through
          // `LocalTime` because the drawer never renders on the server, so there
          // is no hydration mismatch to design around.
          const paidStamp = m.buyInPaidAt ? formatMonthDayClock(m.buyInPaidAt) : "";
          return (
            <li
              key={m.id}
              className="space-y-2 px-3 py-2.5 lg:grid lg:grid-cols-[minmax(0,1fr)_72px_168px_200px_88px] lg:items-center lg:gap-x-4 lg:space-y-0"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 lg:contents">
                <span className="min-w-0 flex-1 lg:min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-ink">{m.name}</span>
                    {m.role === "admin" ? (
                      <Label className="rounded bg-[#EEF1F6] px-1 text-ink-mute">Admin</Label>
                    ) : null}
                  </span>
                  {/* Phone arrives only when RLS let this viewer read it (their own
                      row, or any member's row for a league admin). Null renders
                      nothing: absent and withheld should not look the same as a
                      placeholder would make them. */}
                  {m.phone ? (
                    <span className="mt-0.5 block truncate font-mono text-xs text-ink-mute">
                      {m.phone}
                    </span>
                  ) : null}
                </span>
                {/* `justify-self-start` matters only from `lg`, where the
                    wrapper above goes `display: contents` and this pill becomes
                    a grid item in its own right — a grid item stretches to its
                    column by default, which would leave "ALIVE" adrift in a 72px
                    box rather than sized to its text. */}
                {m.status === "eliminated" ? (
                  <Pill variant="out" className="lg:justify-self-start">
                    Out
                  </Pill>
                ) : (
                  <Pill variant="alive" className="lg:justify-self-start">
                    Alive
                  </Pill>
                )}
              </div>

              <MemberToggle
                label="Buy-in paid"
                // 0010 stamps buy_in_paid_at on every change, both directions —
                // 0007's `else null` cleared it on unpaid, which made this line
                // unrenderable.
                sub={paidStamp ? `${paid ? "Paid" : "Unpaid"} · ${paidStamp}` : paid ? "Paid" : "Unpaid"}
                checked={paid}
                disabled={pending.has(`${m.id}:paid`)}
                onChange={(next) => toggle(m, "paid", next)}
                a11y={`Buy-in paid — ${m.name}`}
              />
              <MemberToggle
                label="Show preseason weeks"
                sub={
                  !preseasonOpen
                    ? preseasonClosedStamp
                      ? `Preseason closed ${preseasonClosedStamp}`
                      : "Preseason is over"
                    : preseason
                      ? "Can see and pick preseason"
                      : "Regular season only"
                }
                checked={preseasonOpen && preseason}
                disabled={!preseasonOpen || pending.has(`${m.id}:preseason`)}
                onChange={(next) => toggle(m, "preseason", next)}
                a11y={`Show preseason weeks — ${m.name}`}
              />
              <RemoveControl
                member={m}
                open={removalOpen}
                confirming={confirmingId === m.id}
                pending={pending.has(`${m.id}:remove`)}
                onArm={() => {
                  setError(null);
                  setConfirmingId(m.id);
                }}
                onCancel={() => setConfirmingId(null)}
                onConfirm={() => remove(m)}
              />
            </li>
          );
        })}
      </ul>
      {error ? <ErrorLine>{error}</ErrorLine> : null}
    </section>
  );
}

/**
 * The per-row Remove button, and its "are you sure?".
 *
 * The confirmation is a label swap in place rather than a dialog, which is the
 * same trade `MoreSection` makes for Delete Account's first step. A `Modal`
 * inside `Drawer` would be two focus traps and two `body { overflow: hidden }`
 * owners racing each other on close — and the thing being confirmed is one row
 * of a list that is already on screen, so a panel that covers the list would
 * hide the very fact the admin is checking.
 *
 * ADMINS RENDER NOTHING, and that is deliberately different from the disabled
 * state below. `remove_member` refuses an admin outright and there is no demote
 * control to make it possible later, so this is a category and not a phase — a
 * greyed button would imply a condition that could change. Entry closing IS a
 * phase, so that one greys out and says when, exactly as the preseason switch
 * one column over does.
 */
function RemoveControl({
  member,
  open,
  confirming,
  pending,
  onArm,
  onCancel,
  onConfirm,
}: {
  member: Member;
  open: boolean;
  confirming: boolean;
  pending: boolean;
  onArm: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (member.role === "admin") return <span className="hidden lg:block" />;

  if (confirming) {
    return (
      <div className="flex items-center gap-1.5 lg:justify-self-start">
        <Button
          variant="danger"
          size="sm"
          disabled={pending}
          onClick={onConfirm}
          aria-label={`Confirm removing ${member.name} from the league`}
        >
          {pending ? "…" : "Remove"}
        </Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="lg:justify-self-start">
      <Button
        variant="ghost"
        size="sm"
        disabled={!open}
        onClick={onArm}
        className={open ? "text-[#8A2C2C]" : undefined}
        aria-label={`Remove ${member.name} from the league`}
      >
        Remove
      </Button>
    </div>
  );
}

/**
 * The paragraphs that explain the two switches, and the pointer to where the
 * buy-in AMOUNT went.
 *
 * THREE COLUMNS, not a stack, and that is the same argument the 312px rail used
 * to make. Across the drawer's full 968px a stacked hint runs to a
 * ~130-character measure, which is past the point anyone reads it; in a third of
 * that width it is about 45, which is what the rail gave them. The rail is gone
 * because the roster wanted the width back, so the measure has to be bought
 * here instead.
 *
 * The removal paragraph is NOT here any more. It moved to the Name tab, beside
 * the invite: `remove_member` closes at `entry_closes_at`, exactly as
 * `join_by_invite` does, so removal is the undo for a join and belongs with the
 * link that caused it. What is left is the two switches directly above these
 * lines, and the pointer to the amount.
 */
function MembersHints({
  preseasonOpen,
  entryClosesAt,
}: {
  preseasonOpen: boolean;
  entryClosesAt: string;
}) {
  return (
    <div className="grid gap-x-8 gap-y-3 lg:grid-cols-3">
      <HintLine>
        Track the buy-in by hand. Flip a switch as the money lands. Members see their own status on
        their account page but can&apos;t change it.
      </HintLine>
      <HintLine>
        {preseasonOpen ? (
          <>
            Preseason is practice. Picks count on the practice table only, and nobody is eliminated
            by a preseason loss. Switching it off hides those weeks from that member and stops them
            picking, but keeps the picks they already made.
          </>
        ) : (
          <>
            Preseason ended when entry closed on <LocalTime iso={entryClosesAt} mode="full" />, so
            these switches are shut for the season. Practice never counted toward the standings.
          </>
        )}
      </HintLine>
      {/* The other half of the split. Someone marking people paid is one thought
          away from wanting to change what they owe, and the Rules tab is not
          where they would look for it unaided. */}
      <HintLine>Set what the buy-in costs on the Rules tab.</HintLine>
    </div>
  );
}

/**
 * One switch with its label and current state, in two layouts and one element.
 *
 * Below `lg` it is a full-width row: label over state on the left, switch on the
 * right. From `lg` it becomes a cell in the roster grid — switch on top, state
 * underneath — and the label is suppressed, because the column header above the
 * list says it once instead of once per member.
 *
 * The `sub` line survives at BOTH widths, and it is the reason hiding the label
 * is safe: "Paid · 10/21" reads on its own under a switch in a column called
 * Paid. `a11y` is unaffected either way — it carries the member's name into the
 * Switch's accessible label, which is what a screen reader gets regardless of
 * which of these two shapes is on screen.
 */
function MemberToggle({
  label,
  sub,
  checked,
  disabled,
  onChange,
  a11y,
}: {
  label: string;
  sub: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
  a11y: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 pl-0.5 lg:flex-col lg:items-start lg:justify-start lg:gap-1 lg:pl-0">
      <span className="min-w-0 lg:order-2">
        <span className="block text-xs font-medium text-ink-soft lg:hidden">{label}</span>
        <span className="block text-xs leading-tight text-ink-mute">{sub}</span>
      </span>
      <Switch
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        label={a11y}
        className="lg:order-1"
      />
    </div>
  );
}

/**
 * The invite link, the code, and what the window they open and close on means.
 *
 * It used to sit in the Members rail, on the argument that sharing an invite is
 * membership admin. It is on the Name tab now with the league's name, because
 * the roster wanted the rail's width back and these two are the pair a member
 * actually sees: the league is called X and here is how you get into it.
 *
 * ONE boolean for the whole section, and it comes from `isEntryOpen` rather than
 * the local `new Date(...) <= Date.now()` this used to compute for itself.
 * `join_by_invite` and `remove_member` both refuse after `entry_closes_at`, so
 * the link going dead and removal going away are the same fact, and reading it
 * through the helper every other consumer uses is what keeps the copy and the
 * database closing together.
 */
function InviteSection({ group, appUrl }: { group: Group; appUrl: string }) {
  const [copied, setCopied] = useState(false);
  // `appUrl` is inlined at build time and may simply be absent; falling back to
  // the current origin matches /app/account. Safe from a hydration mismatch
  // because this drawer never renders on the server — `open` starts false.
  const origin = appUrl || (typeof window !== "undefined" ? window.location.origin : "");
  const inviteLink = `${origin}/login?invite=${group.inviteCode}`;
  // `new Date()` in a render body is a hydration mismatch anywhere else in this
  // app; safe here for the same reason as above.
  const entryOpen = isEntryOpen(new Date(group.entryClosesAt), new Date());

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked; the field is selectable as a fallback */
    }
  }

  return (
    <section className="space-y-2">
      <SectionHeading>Invite</SectionHeading>
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={inviteLink}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 truncate rounded-control border border-line bg-white px-3 py-2 font-mono text-xs text-ink-soft"
          aria-label="Invite link"
        />
        <Button variant="secondary" size="md" onClick={copyInvite} aria-label="Copy invite link">
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Label>Code</Label>
        <span className="font-mono text-sm font-semibold text-ink">{group.inviteCode}</span>
      </div>
      <HintLine>
        {entryOpen ? (
          <>
            Remove takes a player out of the league along with their picks. It&apos;s the undo for
            a wrong join, and it closes when entry does, on{" "}
            <LocalTime iso={group.entryClosesAt} mode="full" />. Admins can&apos;t be removed.
          </>
        ) : (
          <>
            Entry closed <LocalTime iso={group.entryClosesAt} mode="full" />. New members
            can&apos;t join and the roster is the season&apos;s record now, so an eliminated player
            still shows as Out.
          </>
        )}
      </HintLine>
    </section>
  );
}

const FEED_TONE_VARIANT = {
  healthy: "alive",
  failing: "out",
  stale: "pending",
  unknown: "neutral",
} as const;

/**
 * Is the score feed actually running, and can I make it run now?
 *
 * This replaced a hardcoded `ESPN · healthy` Pill and a permanently disabled
 * "Enter a result manually" button — a status that was true by assertion and a
 * control that never worked. It now also replaces its own earlier admission
 * that it "only reads its last run": "Check now" runs the same body the cron
 * runs, in process.
 *
 * Fetched on mount rather than in `loadLeague`, because only admins can open
 * this drawer and most of them never open this tab — putting it in the loader
 * would buy every Standings render a query for a number nobody is reading.
 * Rendering only the active panel is what makes "on mount" mean "when the tab is
 * opened".
 *
 * Holds the SNAPSHOT, not just the description. `describeFeed` reduces a run to
 * one sentence, which is the right headline and throws away the six facts under
 * it — when it last succeeded, which provider, how many games moved. Those are
 * what an admin actually came here for, so the reduction happens in render and
 * the raw shape stays in state.
 *
 * Two buttons, deliberately, because they answer different questions. "Check
 * now" polls the provider; "Refresh" re-reads what the last poll recorded. One
 * button doing both would make a read cost an ESPN call.
 */
function DataFeedSection({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<FeedSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getFeedStatus({ groupId }).catch((err) => {
      if (isStaleDeploymentError(err) && reloadOnce()) return null;
      return { ok: false as const, error: "unexpected_error" };
    });
    if (!res) return;
    if (!res.ok) {
      setError(copyFor(res.error));
      setLoading(false);
      return;
    }
    setSnapshot(mapFeedStatus(res.data));
    setLoading(false);
  }, [groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * Run the scorer, then show what it recorded.
   *
   * A FAILED poll still comes back `ok`, carrying the fresh status — the action
   * records every verdict to `feed_status` before returning, so the panel below
   * can say "the score feed is failing" and name the stage, which beats a toast
   * saying something went wrong. Only a refusal before the poll (not an admin,
   * inside the cooldown, no service key) surfaces as an error line.
   */
  const check = useCallback(async () => {
    setChecking(true);
    setError(null);
    const res = await runFeedCheck({ groupId }).catch((err) => {
      if (isStaleDeploymentError(err) && reloadOnce()) return null;
      return { ok: false as const, error: "unexpected_error" };
    });
    if (!res) return;
    if (!res.ok) {
      setError(copyFor(res.error));
      setChecking(false);
      return;
    }
    setSnapshot(mapFeedStatus(res.data));
    setChecking(false);
    // A poll locks picks at kickoff and can eliminate people, so the board
    // behind this drawer may be out of date the moment it returns.
    router.refresh();
  }, [groupId, router]);

  const description = describeFeed(snapshot);
  const sync = snapshot?.sync ?? null;
  // Lifted out so the JSX below doesn't have to re-narrow `snapshot` on every
  // use. Every age on screen is measured against the DATABASE's clock, which is
  // why `feed_status_for_admin` returns one at all — a Netlify container stamped
  // `checked_at`, and two machines' clocks are how "checked -3 minutes ago" gets
  // printed. `agoLabel` degrades to "at an unknown time" if it is ever empty.
  const now = snapshot?.now ?? "";
  const busy = loading || checking;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-8">
      <section className="space-y-2">
        <SectionHeading>Score feed</SectionHeading>
        <div className="rounded-control border border-line bg-[#FAFAFB] p-3">
          {loading && !sync ? (
            <p className="text-sm text-ink-mute">Checking…</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-ink">{description.headline}</span>
                <Pill
                  variant={FEED_TONE_VARIANT[description.tone]}
                  live={description.tone === "healthy"}
                >
                  {description.provider ?? "No data"}
                </Pill>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-ink-mute">{description.detail}</p>

              {sync ? (
                <>
                  {/* Two across on a phone, four across only where the column is
                      genuinely wide enough for "Sun, Sep 13 · 4:00 PM" — which is
                      the full-bleed `md` rail and NOT the narrower `lg` left
                      column beside the action rail. The count follows the column
                      width, not the viewport. */}
                  <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-3 md:grid-cols-4 lg:grid-cols-2">
                    <FeedFact term="Last checked">
                      <LocalTime iso={sync.checkedAt} mode="full" />
                      <span className="mt-0.5 block text-xs text-ink-mute">
                        {agoLabel(sync.checkedAt, now)}
                      </span>
                    </FeedFact>
                    <FeedFact term="Last success">
                      {sync.lastOkAt ? (
                        <>
                          <LocalTime iso={sync.lastOkAt} mode="full" />
                          <span className="mt-0.5 block text-xs text-ink-mute">
                            {agoLabel(sync.lastOkAt, now)}
                          </span>
                        </>
                      ) : (
                        "Never"
                      )}
                    </FeedFact>
                    <FeedFact term="Provider">{providerLabel(sync.provider)}</FeedFact>
                    <FeedFact term="Season">{sync.season ?? "—"}</FeedFact>
                    <FeedFact term="Last run">{describeFeedDetail(sync.detail) || "—"}</FeedFact>
                    <FeedFact term="Games / players updated">
                      <span className="tabular-nums">
                        {sync.gamesUpserted} / {sync.membersUpdated}
                      </span>
                    </FeedFact>
                  </dl>

                  {sync.error ? (
                    <p className="mt-3 break-words rounded border border-line bg-white p-2 font-mono text-xs leading-relaxed text-[#8A2C2C]">
                      {sync.error}
                    </p>
                  ) : null}
                </>
              ) : null}
            </>
          )}
        </div>

        <HintLine>
          Last checked is stamped on every run, success or not. Last success only moves when a run
          works, so a fresh check beside a stale success means the scorer is running and failing.
        </HintLine>
      </section>

      <div className="space-y-3">
        <Button variant="primary" size="md" block disabled={busy} onClick={check}>
          {checking ? "Checking…" : "Check now"}
        </Button>
        <Button variant="outline" size="md" block disabled={busy} onClick={load}>
          {loading ? "Reading…" : "Refresh"}
        </Button>
        <HintLine>
          Check now runs the scorer immediately: it polls the provider, locks picks at kickoff and
          updates standings. Refresh only re-reads the last run. The scorer also runs on its own
          every five minutes.
        </HintLine>
        {error ? <ErrorLine>{error}</ErrorLine> : null}
      </div>
    </div>
  );
}

/** One term/value pair in the feed's fact grid. */
function FeedFact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div>
      <dt>
        <Label className="text-ink-mute">{term}</Label>
      </dt>
      <dd className="mt-1 text-sm text-ink">{children}</dd>
    </div>
  );
}

type TabValue = "members" | "rules" | "name" | "feed";

const TABS: { value: TabValue; label: string }[] = [
  { value: "members", label: "Members" },
  { value: "rules", label: "Rules" },
  { value: "name", label: "Name" },
  { value: "feed", label: "Data Feed" },
];

/**
 * The league admin's one surface: four tabs in a full-width bottom drawer.
 *
 * Why tabs: five stacked sections made the panel taller than a phone, so it had
 * to be scrolled one-handed mid-week. Splitting membership, rules, identity and
 * feed health — four genuinely unrelated concerns — is both the organising fix
 * and the scroll fix.
 *
 * Why a drawer and not `Modal`: at 480px every one of these tabs was a single
 * narrow column, and the roster in particular stacked two full-width switch rows
 * under each member so a sixteen-player league ran to about three screens. The
 * width was the constraint on the design rather than a choice, and the page it
 * covers is 1000px wide. `Drawer` is full-bleed with its content on the same
 * rail as `main`, so the columns here line up with the Standings page still
 * visible behind them.
 *
 * NOTHING IN HERE MAY SCROLL ON ITS OWN — unchanged, and it matters more now. No
 * panel carries `max-h` or `overflow`; the `Drawer` panel is the one scroller,
 * so a short tab doesn't scroll at all and a long one scrolls the whole drawer.
 * A sixteen-row roster is exactly what tempts a `max-h` in here.
 *
 * The tab bar IS now pinned, which reverses what this comment used to say — but
 * NOT with `sticky`, which is what it used to say next. `Drawer`'s header is a
 * `shrink-0` flex sibling of a `h-[90dvh]` panel, so it is structurally fixed and
 * there is nothing for a `sticky` to pin against. The reason it needed pinning at
 * all still holds: in a 480px modal the bar was never more than a short scroll
 * from the top of the viewport, so pinning bought nothing; at 90dvh with a long
 * roster it would scroll out of sight and the other tabs become unreachable.
 *
 * THE NAME TAB IS WHY THE MEMBERS TAB IS FULL WIDTH. The league name used to
 * ride above the bar in `Drawer`'s `aside` slot, and the invite link, the code
 * and four paragraphs of hint copy sat in a ~300px rail beside the roster. That
 * rail cost the roster a third of 968px on the one tab that needs the width — a
 * sixteen-player league with phone numbers under the names — to hold two things
 * that are not membership admin at all. They are the league's identity, so they
 * are a tab: name and invite together, third in the bar, and Members runs the
 * full rail.
 *
 * The removal copy went with the invite rather than staying with the button it
 * describes, because `remove_member` closes at `entry_closes_at` exactly as
 * `join_by_invite` does — removal is the undo for a join. The copy for the two
 * switches stayed on Members, under the roster, in three columns to keep its
 * measure readable.
 *
 * The active tab is plain `useState` and survives close/reopen for the session:
 * `Drawer` returns null when closed, so only its subtree unmounts — this
 * component stays mounted in `StandingsClient`. No `localStorage`, which would
 * cost a paint flash to render a default first.
 *
 * NO LOCK GLYPH ON THE TAB BAR, deliberately. It used to sit beside "Rules" once
 * the season started. That was honest when the whole tab froze together; now
 * that the always-editable buy-in shares the tab it would be a claim about the
 * tab that is false for half of it. Each card on the Rules tab states its own
 * lock instead, which is the only place the distinction can be made accurately.
 */
export function AdminSettingsDrawer({
  open,
  onClose,
  group,
  members,
  appUrl,
  phase,
}: {
  open: boolean;
  onClose: () => void;
  group: Group;
  members: Member[];
  appUrl: string;
  phase: SeasonPhase;
}) {
  const [tab, setTab] = useState<TabValue>("members");

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow="Admin"
      title="Control Center"
      subheader={
        <Tabs
          options={TABS}
          value={tab}
          onChange={setTab}
          idBase="admin-settings"
          label="Group settings sections"
          // Left-aligned and capped rather than stretched: tabs spread across
          // 968px read as a navigation bar for the page rather than a control
          // for the panel under them. 440 was the cap for three; a fourth at the
          // same per-tab width wants ~587, and 560 keeps "Data Feed" on one line
          // without reaching for the whole rail.
          className="lg:max-w-[560px]"
        />
      }
    >
      {/* No rail on Members, and therefore no grid: the roster is the tab.
          `space-y-6` is safe here in a way it is not on a page root — two
          children, one seam, and neither owns its own spacing. */}
      {tab === "members" ? (
        <TabPanel idBase="admin-settings" value="members" className="space-y-6">
          <MembersSection
            groupId={group.id}
            members={members}
            phase={phase}
            entryClosesAt={group.entryClosesAt}
          />
          <MembersHints
            preseasonOpen={phase === "preseason"}
            entryClosesAt={group.entryClosesAt}
          />
        </TabPanel>
      ) : null}

      {tab === "rules" ? (
        <TabPanel
          idBase="admin-settings"
          value="rules"
          className="grid gap-5 lg:grid-cols-2 lg:items-start lg:gap-6"
        >
          {/* Two cards, side by side, because they lock on different conditions
              and the point is that you can see both states at once. */}
          <RulesSection group={group} />
          <BuyInAmountSection group={group} />
        </TabPanel>
      ) : null}

      {tab === "name" ? (
        <TabPanel
          idBase="admin-settings"
          value="name"
          className="grid gap-5 lg:grid-cols-2 lg:items-start lg:gap-6"
        >
          {/* Two plain sections, not `SettingsCard`s. That card exists for the
              Rules tab, where its `pill` states a per-card lock and the two
              cards lock on DIFFERENT conditions; neither of these locks at all,
              so a card here would carry an affordance with nothing to say. It
              would also break the real `<label htmlFor="group-name">` wrapper
              below, since `SettingsCard` puts its heading inside a `<Label>`
              span. The roster's `<ul>` and the feed's sections are bare too. */}
          <GroupNameSection group={group} />
          <InviteSection group={group} appUrl={appUrl} />
        </TabPanel>
      ) : null}

      {tab === "feed" ? (
        <TabPanel idBase="admin-settings" value="feed">
          <DataFeedSection groupId={group.id} />
        </TabPanel>
      ) : null}
    </Drawer>
  );
}
