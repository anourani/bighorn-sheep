/**
 * The league's one-paragraph pitch, in the three-tone treatment the design
 * specifies: primary ink, secondary, secondary-with-the-name-lifted.
 *
 * Two surfaces render it — the landing hero (`app/page.tsx`) and the login hero
 * (`auth/LoginHero.tsx`) — and they render it identically. They did not always:
 * the landing copy omitted the no-repeats rule entirely, the login copy carried
 * it as "You can't pick the same team twice", and the metadata strings had two
 * further phrasings of the same sentence. Four versions of one paragraph, none
 * of them wrong enough to notice. This component is what stops a fifth.
 *
 * **It owns the copy and the colours, and deliberately no geometry** — no size,
 * no measure, no margins. That is the part the two heroes genuinely disagree
 * about (339px stepping 18px→16px on the landing page; 414px stepping 16px→18px
 * and centred on `/login`), so each keeps its own wrapper and this returns a
 * bare fragment into it.
 *
 * `shell-ink` / `shell-mute` are the spec's pure neutrals (#1E1E1E / #757575),
 * not the blue-tinted `ink.*` family every in-app screen takes — both doors are
 * outside `/app` and the two palettes are separate on purpose. See the colors
 * block in `tailwind.config.ts`.
 *
 * "last man standing" is a `shell-ink` SPAN inside a `shell-mute` sentence, not
 * a flat `shell-ink` paragraph. It is the phrase the league is named for and is
 * the only part of that sentence lifted back to primary; painting the whole
 * sentence dark is what `LoginHero` used to do, and it reads as a second
 * heading rather than as the sentence finishing.
 *
 * **TWO paragraphs, not three.** The closing sentence runs on from the rules
 * inline rather than sitting on a line of its own, so the body is one wrapping
 * block under the opening line. It was its own `<p>`, which forced a break
 * before it at every measure, and this docblock used to argue that was the
 * point — "the first and last always sit on lines of their own". The design
 * asked for it inline; only the opening line is held apart now.
 *
 * **The `{" "}` before the span is load-bearing**, and its absence would not
 * look like a whitespace bug. JSX drops a newline that sits between text and a
 * tag, so breaking the line after "The" without it renders "Thelast man
 * standing" — no error, no warning, and nothing to see until someone reads the
 * rendered sentence. The space after `</span>` survives only because it shares
 * a line with the closing tag, which is the same rule seen from the other side.
 *
 * There is still no vertical rhythm between the two: they read as one block of
 * copy, so neither wrapper adds `space-y-*`.
 */
export function LeaguePitch() {
  return (
    <>
      <p className="text-shell-ink">A private NFL survivor league.</p>
      <p className="text-shell-mute">
        Pick one team a week. If your team wins, you advance to the next week. If they lose or
        tie, you&apos;re out. You can only use each team once. The{" "}
        <span className="text-shell-ink">last man standing</span> wins.
      </p>
    </>
  );
}
