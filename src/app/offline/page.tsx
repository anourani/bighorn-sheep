import Link from "next/link";
import { BrandMark } from "@/components/shell/BrandMark";
import { Label } from "@/components/ui/Label";
import { buttonVariants } from "@/components/ui/Button";

export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-app flex-col items-center justify-center px-6 text-center">
      <BrandMark size="lg" />
      <Label className="mt-6 text-ink-mute">No connection</Label>
      <h1 className="mt-2 text-display-sm font-medium tracking-tight text-ink">You&apos;re offline</h1>
      <p className="mt-2 max-w-[34ch] text-sm leading-relaxed text-ink-soft">
        The app shell loaded from cache, but live scores and picks need a connection. Reconnect to see the latest.
      </p>
      <Link href="/app" className={`${buttonVariants({ variant: "primary" })} mt-6`}>
        Try again
      </Link>
    </main>
  );
}
