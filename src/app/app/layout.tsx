import { AppHeader } from "@/components/shell/AppHeader";
import { TabBar } from "@/components/shell/TabBar";

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
      <main className="flex-1 px-4 pb-28 pt-5">{children}</main>
      <TabBar />
    </div>
  );
}
