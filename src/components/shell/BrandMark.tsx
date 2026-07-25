import { cn } from "@/lib/cn";
import { ShieldIcon } from "@/components/icons";

const sizeMap = {
  sm: "h-8 w-8 rounded-[9px] [&>svg]:h-5 [&>svg]:w-5",
  md: "h-10 w-10 rounded-[11px] [&>svg]:h-6 [&>svg]:w-6",
  lg: "h-14 w-14 rounded-[15px] [&>svg]:h-8 [&>svg]:w-8",
};

/** The orange survival badge. Used in the header and the login hero. */
export function BrandMark({
  size = "sm",
  className,
}: {
  size?: keyof typeof sizeMap;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center bg-brand-sheen text-white shadow-glow ring-1 ring-white/20",
        sizeMap[size],
        className,
      )}
    >
      <ShieldIcon />
    </span>
  );
}
