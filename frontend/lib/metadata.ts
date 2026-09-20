import type { Metadata } from "next";
import { assets } from "./assets";

/** Call from a server layout with the actual public origin of your deployment. */
export function createOpenAscentMetadata(siteUrl: string | URL): Metadata {
  const metadataBase = new URL(siteUrl);
  if (!/^https?:$/.test(metadataBase.protocol)) {
    throw new Error("Open Ascent metadata requires an HTTP(S) site URL.");
  }

  const title = "Open Ascent";
  const description = "Open Ascent. Train with clarity.";
  const og = assets.social.openGraph;

  return {
    metadataBase,
    title: { default: title, template: "%s | Open Ascent" },
    description,
    applicationName: title,
    icons: {
      icon: [
        // General fallback first; themed SVGs scale at any browser tab size.
        {
          url: assets.brand.icons.favicon32.light,
          type: "image/png",
          sizes: "32x32",
        },
        {
          url: assets.brand.icons.favicon48.light,
          type: "image/png",
          sizes: "48x48",
        },
        {
          url: assets.brand.icons.favicon32.dark,
          type: "image/png",
          sizes: "32x32",
          media: "(prefers-color-scheme: dark)",
        },
        {
          url: assets.brand.icons.favicon48.dark,
          type: "image/png",
          sizes: "48x48",
          media: "(prefers-color-scheme: dark)",
        },
        {
          url: assets.brand.symbol.light,
          type: "image/svg+xml",
          sizes: "any",
          media: "(prefers-color-scheme: light)",
        },
        {
          url: assets.brand.symbol.dark,
          type: "image/svg+xml",
          sizes: "any",
          media: "(prefers-color-scheme: dark)",
        },
      ],
      apple: [
        {
          url: assets.brand.icons.appleTouch.src,
          type: "image/png",
          sizes: "180x180",
        },
      ],
    },
    openGraph: {
      type: "website",
      siteName: title,
      title,
      description,
      images: [
        { url: og.src, width: og.width, height: og.height, alt: og.alt },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [{ url: og.src, alt: og.alt }],
    },
  };
}
