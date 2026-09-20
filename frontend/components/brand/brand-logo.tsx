import Image from "next/image";

import { assets } from "@/lib/assets";
import { cn } from "@/lib/utils";

type BrandLogoProps = {
  alt?: string;
  className?: string;
  sizes?: string;
  variant?: "default" | "dashboard";
};

export function BrandLogo({
  alt = "Open Ascent",
  className,
  sizes = "64px",
  variant = "default",
}: BrandLogoProps) {
  const isDecorative = alt.length === 0;

  return (
    <span
      data-slot="brand-logo"
      className={cn(
        "relative inline-grid shrink-0 place-items-center overflow-hidden",
        className,
      )}
      role={isDecorative ? undefined : "img"}
      aria-label={isDecorative ? undefined : alt}
      aria-hidden={isDecorative || undefined}
    >
      <Image
        src={
          variant === "dashboard"
            ? assets.brand.symbol.lightOlive
            : assets.brand.symbol.light
        }
        alt=""
        fill
        sizes={sizes}
        className="object-contain dark:hidden"
      />

      <Image
        src={assets.brand.symbol.dark}
        alt=""
        fill
        sizes={sizes}
        className="hidden object-contain dark:block"
      />
    </span>
  );
}
