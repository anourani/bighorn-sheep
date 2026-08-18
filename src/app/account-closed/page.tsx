import { BrandMark } from "@/components/shell/BrandMark";
import { Label } from "@/components/ui/Label";
import { SignOutButton } from "@/components/account/SignOutButton";
import { APP_NAME } from "@/lib/app";

export const metadata = { title: "Account closed" };

/**
 * Where a closed account lands.
 *
 * Deliberately outside `/app`: that layout is what redirects here, so putting
 * this page inside it would loop. `middleware.ts` only bounces signed-in
 * visitors off `/` and `/login`, so this route stays reachable while their
 * session is still live — which it is, right up until they use the button
 * below.
 *
 * The copy is the whole point of the page. "Deleted" would be a lie: nothing is
 * erased, and their name, picks and strikes are still on the board, which is
 * exactly what someone re-reading this screen a week later needs to know.
 */
export default function AccountClosedPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-app flex-col items-center justify-center px-6 text-center">
      <BrandMark size="lg" />
      <Label className="mt-6 text-ink-mute">Account closed</Label>
      <h1 className="mt-2 text-display-sm font-medium tracking-tight text-ink">
        You&apos;ve left the league
      </h1>
      <p className="mt-2 max-w-[38ch] text-sm leading-relaxed text-ink-soft">
        Your {APP_NAME} account is closed, so this is as far as it goes. Nothing was
        deleted — your name, your picks and your strikes are all still on the standings
        board, where the season&apos;s record keeps them.
      </p>
      <p className="mt-3 max-w-[38ch] text-sm leading-relaxed text-ink-soft">
        Changed your mind? Ask your commissioner — reopening an account is theirs to do,
        not yours.
      </p>
      <SignOutButton className="mt-6" />
    </main>
  );
}
