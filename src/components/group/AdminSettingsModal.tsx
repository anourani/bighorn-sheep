"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Label } from "@/components/ui/Label";
import { Pill } from "@/components/ui/Badge";
import { Switch } from "@/components/ui/Switch";
import { Tabs, TabPanel } from "@/components/ui/Tabs";
import { CopyIcon, CheckIcon, LockIcon, InfoIcon } from "@/components/icons";
import {
  getFeedStatus,
  setGroupBuyIn,
  setGroupName,
  setGroupRules,
  setMemberBuyIn,
  setMemberPreseason,
} from "@/app/app/actions";
import { formatMoney } from "@/lib/money";
import { formatMonthDay } from "@/lib/time";
import { describeFeed, mapFeedStatus, type FeedDescription } from "@/lib/league/feed";
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
  name_required: "Give the league a name.",
  name_too_long: "That name is too long — 60 characters max.",
  settings_locked: "The season has started, so the rules are frozen.",
  preseason_closed: "Preseason is over — that can't be changed now.",
  bad_elimination_type: "Pick one of the two elimination types.",
  bad_tie_rule: "Pick one of the two tie rules.",
  bad_amount: "Enter an amount of zero or more.",
  // Each of these means the RPC itself is missing, which almost always means
  // 0011 (or 0010) has not been applied to this database by hand — nothing in
  // this repo applies migrations. The detail is in the Netlify function log.
  name_update_failed: "Couldn't save that. Try again.",
  rules_update_failed: "Couldn't save that. Try again.",
  preseason_update_failed: "Couldn't save that. Try again.",
  buy_in_update_failed: "Couldn't save that. Try again.",
  feed_status_unavailable: "Couldn't read the feed status.",
  unexpected_error: "Something went wrong on our end. Try again in a moment.",
};

function copyFor(code: string): string {
  return ADMIN_ERROR_COPY[code] ?? "Couldn't save that. Try again.";
}

const INPUT_CLASS =
  "w-full rounded-control border border-line bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-mute/60 focus-visible:border-brand-strong";

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
      {children}
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
 * Sits ABOVE the tab bar rather than inside a tab: it names the thing all three
 * tabs are about, and burying it in one of them would make "rename any time"
 * mean "rename any time you're on the right tab". It also replaces the `Modal`'s
 * static `description`, which is where the name used to be printed, unchangeably.
 *
 * Writes through `set_group_name` (0011), which has no lock check — 0001's RLS
 * policy refuses every `groups` update once the season starts, and a typo in a
 * league name is exactly the thing you notice after kickoff.
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
    <div className="space-y-5">
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
          The season has started, so the rules are frozen — a league can&apos;t change what counts
          as elimination halfway through. The name above is still editable.
        </HintLine>
      ) : (
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" disabled={!dirty || pending} onClick={save}>
            {pending ? "Saving…" : saved ? "Saved" : "Save rules"}
          </Button>
          <p className="text-xs text-ink-mute">Locks when the season starts.</p>
        </div>
      )}
      {error ? <ErrorLine>{error}</ErrorLine> : null}
    </div>
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
 * What the pot costs — the other half of the account page's buy-in card, whose
 * paid/unpaid badge is set by {@link MembersSection} below. They share the
 * Members tab for that reason: the amount and who has paid it are two halves of
 * one fact.
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
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <SectionHeading>Buy-in</SectionHeading>
        <span className="text-xs font-medium text-ink-mute tabular-nums">
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
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" disabled={!dirty || pending} onClick={save}>
          {pending ? "Saving…" : saved ? "Saved" : "Save"}
        </Button>
        <p className="text-xs text-ink-mute">Shown on everyone&apos;s account page.</p>
      </div>
      {!valid ? <ErrorLine>Enter a dollar amount of zero or more.</ErrorLine> : null}
      {error ? <ErrorLine>{error}</ErrorLine> : null}
    </section>
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
type PendingKey = `${string}:${"paid" | "preseason"}`;

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
}: {
  groupId: string;
  members: Member[];
  phase: SeasonPhase;
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
  const paidCount = members.filter(paidFor).length;
  // Matches set_member_preseason's own condition, so the UI and the database
  // close the window at the same moment.
  const preseasonOpen = phase === "preseason";

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
        inside a tab is the exact thing this layout exists to remove: `Modal`'s
        panel is the one scroller, so a long list scrolls the whole modal rather
        than trapping a scrollbar inside a tab that is itself inside a scroller.
        A taller two-switch row is precisely what tempts a `max-h-64` in here.
      */}
      <ul className="divide-y divide-line rounded-control border border-line">
        {members.map((m) => {
          const paid = paidFor(m);
          const preseason = preseasonFor(m);
          const paidStamp = m.buyInPaidAt ? formatMonthDay(m.buyInPaidAt) : "";
          return (
            <li key={m.id} className="space-y-2 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="min-w-0 flex-1">
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
                {m.status === "eliminated" ? (
                  <Pill variant="out">Out</Pill>
                ) : (
                  <Pill variant="alive">Alive</Pill>
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
                    ? "Preseason is over"
                    : preseason
                      ? "Can see and pick preseason"
                      : "Regular season only"
                }
                checked={preseasonOpen && preseason}
                disabled={!preseasonOpen || pending.has(`${m.id}:preseason`)}
                onChange={(next) => toggle(m, "preseason", next)}
                a11y={`Show preseason weeks — ${m.name}`}
              />
            </li>
          );
        })}
      </ul>
      <HintLine>
        Buy-in is yours to track by hand — flip a switch as the money lands. Members see their own
        status on their account page and can&apos;t change it.
      </HintLine>
      <HintLine>
        {preseasonOpen ? (
          <>
            Preseason is practice: picks are real for the practice table, but nothing carries into
            the season — nobody is eliminated by a preseason loss. Switch it on for whoever wants to
            play those weeks; switching it off hides them from that member and stops them picking,
            keeping any picks they already made.
          </>
        ) : (
          <>
            Preseason ended at the first Week 1 kickoff and these switches are closed for the
            season. Practice never carried into the standings, so nothing was lost when it went.
          </>
        )}
      </HintLine>
      {error ? <ErrorLine>{error}</ErrorLine> : null}
    </section>
  );
}

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
    <div className="flex items-center justify-between gap-3 pl-0.5">
      <span className="min-w-0">
        <span className="block text-xs font-medium text-ink-soft">{label}</span>
        <span className="block text-xs text-ink-mute">{sub}</span>
      </span>
      <Switch checked={checked} disabled={disabled} onChange={onChange} label={a11y} />
    </div>
  );
}

/** Sharing the invite is membership admin, so it lives with the roster. */
function InviteSection({ group, appUrl }: { group: Group; appUrl: string }) {
  const [copied, setCopied] = useState(false);
  // `appUrl` is inlined at build time and may simply be absent; falling back to
  // the current origin matches /app/account. Safe from a hydration mismatch
  // because this modal never renders on the server — `open` starts false.
  const origin = appUrl || (typeof window !== "undefined" ? window.location.origin : "");
  const inviteLink = `${origin}/login?invite=${group.inviteCode}`;
  const entryClosed = new Date(group.entryClosesAt).getTime() <= Date.now();

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
      {entryClosed ? (
        <HintLine>
          Entry closed at the first Week 1 kickoff — new members can no longer join this season.
        </HintLine>
      ) : null}
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
 * Is the score feed actually running?
 *
 * This replaces a hardcoded `ESPN · healthy` Pill and a permanently disabled
 * "Enter a result manually" button — a status that was true by assertion and a
 * control that never worked. The button is gone rather than carried over:
 * game-result override is its own feature with its own audit-trail requirements,
 * and a dead control reads as a broken app.
 *
 * Fetched on mount rather than in `loadLeague`, because only admins can open
 * this modal and most of them never open this tab — putting it in the loader
 * would buy every Standings render a query for a number nobody is reading.
 * Rendering only the active panel is what makes "on mount" mean "when the tab is
 * opened".
 */
function DataFeedSection({ groupId }: { groupId: string }) {
  const [description, setDescription] = useState<FeedDescription | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
    setDescription(describeFeed(mapFeedStatus(res.data)));
    setLoading(false);
  }, [groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="space-y-2">
      <SectionHeading>Score feed</SectionHeading>
      <div className="rounded-control border border-line bg-[#FAFAFB] p-3">
        {loading ? (
          <p className="text-sm text-ink-mute">Checking…</p>
        ) : error ? (
          <>
            <p className="text-sm font-medium text-ink">Feed status unavailable</p>
            <p className="mt-2 text-xs leading-relaxed text-ink-mute">{error}</p>
          </>
        ) : description ? (
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
          </>
        ) : null}
        <Button variant="outline" size="sm" className="mt-3" disabled={loading} onClick={load}>
          Refresh
        </Button>
      </div>
      <HintLine>
        The scorer runs on its own every five minutes; it locks picks at kickoff and updates
        standings. This only reads its last run — it doesn&apos;t trigger one.
      </HintLine>
    </section>
  );
}

type TabValue = "members" | "rules" | "feed";

const TABS: { value: TabValue; label: string }[] = [
  { value: "members", label: "Members" },
  { value: "rules", label: "Rules" },
  { value: "feed", label: "Data Feed" },
];

/**
 * The league admin's one surface, in three tabs.
 *
 * Why tabs: five stacked sections made the modal taller than a phone, so
 * `Modal`'s own `max-h-[92vh]` panel scroll engaged and the thing had to be
 * scrolled one-handed mid-week. Splitting membership, rules and feed health —
 * three genuinely unrelated concerns — is both the organising fix and the scroll
 * fix.
 *
 * NOTHING IN HERE MAY SCROLL ON ITS OWN. The tab bar is a plain flow child, not
 * sticky; no panel carries `max-h` or `overflow`. So a short tab doesn't scroll
 * at all and a long one scrolls the whole modal, which is the rule: never a
 * scrollbar nested inside a tab.
 *
 * The active tab is plain `useState` and survives close/reopen for the session:
 * `Modal` returns null when closed, so only its subtree unmounts — this
 * component stays mounted in `StandingsClient`. No `localStorage`, which would
 * cost a paint flash to render a default first.
 */
export function AdminSettingsModal({
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
  const locked = Boolean(group.settingsLockedAt) || new Date(group.entryClosesAt).getTime() <= Date.now();

  return (
    <Modal open={open} onClose={onClose} eyebrow="Admin" title="Group Settings">
      <div className="space-y-5">
        <GroupNameSection group={group} />

        <div className="space-y-4">
          <Tabs
            options={TABS.map((t) => ({
              value: t.value,
              label:
                t.value === "rules" && locked ? (
                  <span className="inline-flex items-center gap-1">
                    {t.label}
                    <LockIcon className="h-3 w-3" />
                  </span>
                ) : (
                  t.label
                ),
            }))}
            value={tab}
            onChange={setTab}
            idBase="admin-settings"
            label="Group settings sections"
          />

          {tab === "members" ? (
            <TabPanel idBase="admin-settings" value="members" className="space-y-6">
              <MembersSection groupId={group.id} members={members} phase={phase} />
              <InviteSection group={group} appUrl={appUrl} />
              {/* The buy-in amount and the per-member paid flag are the two
                  halves of what the account page prints, so they share a tab. */}
              <BuyInAmountSection group={group} />
            </TabPanel>
          ) : null}

          {tab === "rules" ? (
            <TabPanel idBase="admin-settings" value="rules">
              <RulesSection group={group} />
            </TabPanel>
          ) : null}

          {tab === "feed" ? (
            <TabPanel idBase="admin-settings" value="feed">
              <DataFeedSection groupId={group.id} />
            </TabPanel>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
