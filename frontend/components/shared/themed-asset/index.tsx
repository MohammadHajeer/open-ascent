import Image from "next/image";
import styles from "./ThemedAsset.module.css";
import { AssetTheme, ThemedAssetSource } from "@/lib/assets";

type Props = {
  asset: ThemedAssetSource;
  /** Use an empty string when nearby text already conveys the meaning. */
  alt: string;
  /** Auto follows html.dark or html[data-theme="dark"]; default is light. */
  theme?: AssetTheme | "auto";
  /** Height follows the original aspect ratio. Existing internal padding stays. */
  width?: number;
  className?: string;
};

/** Works in Server and Client Components; no hydration-dependent theme lookup. */
export function ThemedAsset({
  asset,
  alt,
  theme = "auto",
  width = asset.width,
  className,
}: Props) {
  const variants: readonly AssetTheme[] =
    theme === "auto" ? ["light", "dark"] : [theme];

  return (
    <span
      className={[styles.root, theme === "auto" ? styles.auto : "", className]
        .filter(Boolean)
        .join(" ")}
      style={{ width, aspectRatio: `${asset.width} / ${asset.height}` }}
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
    >
      {variants.map((variant) => (
        <Image
          key={variant}
          src={asset[variant]}
          width={asset.width}
          height={asset.height}
          alt=""
          aria-hidden="true"
          className={[styles.image, theme === "auto" ? styles[variant] : ""]
            .filter(Boolean)
            .join(" ")}
          unoptimized
        />
      ))}
    </span>
  );
}
