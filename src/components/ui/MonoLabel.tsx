import { cn } from "@/lib/cn";

/** Uppercase mono metadata label (label-md token). */
export function MonoLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <span className={cn("font-mono text-label-md uppercase", className)}>{children}</span>;
}
