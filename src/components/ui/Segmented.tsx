"use client";

import { cn } from "@/lib/cn";

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  tone = "light",
  className,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  tone?: "light" | "slate";
  className?: string;
}) {
  const track = tone === "slate" ? "bg-black/25" : "bg-[#EDEFF3]";
  return (
    <div className={cn("inline-flex rounded-control p-1", track, className)} role="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex-1 whitespace-nowrap rounded-[6px] px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? tone === "slate"
                  ? "bg-white/15 text-onsurface shadow-sm"
                  : "bg-white text-ink shadow-sm"
                : tone === "slate"
                  ? "text-onsurface-mute hover:text-onsurface"
                  : "text-ink-mute hover:text-ink",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
