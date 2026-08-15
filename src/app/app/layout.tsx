import { AppHeader } from "@/components/shell/AppHeader";

/**
 * The authenticated shell is per-user (it reads the Supabase session from
 * cookies), so it must always render on request — never be statically
 * prerendered. This cascades to every /app route.
 */
export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative mx-auto flex min-h-dvh max-w-shell flex-col">
      <AppHeader />
      {/* pb-12, not the pb-28 this had while a fixed bottom tab bar sat over the
          page. All navigation is in the header now, so the only job left for the
          bottom padding is to keep the last row off the viewport edge. */}
      <main className="flex-1 px-4 pb-12 pt-5">{children}</main>
    </div>
  );
}
