import { AppHeader } from "@/components/shell/AppHeader";
import { TabBar } from "@/components/shell/TabBar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative mx-auto flex min-h-dvh max-w-app flex-col">
      <AppHeader />
      <main className="flex-1 px-4 pb-28 pt-5">{children}</main>
      <TabBar />
    </div>
  );
}
