import { cn } from "@/lib/cn";

/** Uppercase semibold metadata label (label-md token). */
export function Label({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <span className={cn("text-label-md uppercase", className)}>{children}</span>;
}
