import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, ScanLine } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { formatDifficulty, formatFamilyLabel } from "../_lib/formatters";
import type { MovementGuide } from "../_lib/types";

export function MovementHero({ movement }: { movement: MovementGuide }) {
  const { content } = movement.documentation;

  return (
    <header className="border-b border-border">
      <div className="mx-auto grid w-full max-w-360 gap-10 px-4 py-12 sm:px-5 sm:py-16 lg:grid-cols-[minmax(0,0.9fr)_minmax(420px,1.1fr)] lg:items-center lg:gap-16 lg:py-20 xl:gap-24">
        <div>
          <Link
            href="/movements"
            className="inline-flex items-center gap-2 text-xs font-semibold text-foreground-soft transition-colors hover:text-primary"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Movement library
          </Link>

          <Badge variant="secondary" className="mt-8 flex w-max">
            <ScanLine aria-hidden="true" />
            {formatFamilyLabel(movement.family_key)}
          </Badge>

          <h1 className="mt-5 text-[clamp(4rem,9vw,8.6rem)] leading-[0.82] font-medium tracking-[-0.078em] text-foreground">
            {movement.name}
          </h1>

          <p className="mt-7 font-mono text-[0.62rem] font-semibold tracking-widest text-primary uppercase">
            {formatDifficulty(content.difficulty)} · Published guide v
            {movement.documentation.version}
          </p>

          <p className="mt-5 max-w-xl text-base leading-7 text-foreground-soft sm:text-lg sm:leading-8">
            {content.notice}
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            {movement.upload_analysis_supported ? (
              <Link
                href={`/analyze?movement=${encodeURIComponent(movement.slug)}`}
                className={buttonVariants({ variant: "brand", size: "lg" })}
              >
                Analyze {movement.name.toLowerCase()}
                <ArrowUpRight className="size-4" />
              </Link>
            ) : null}

            <Link
              href="/movements"
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
              )}
            >
              Browse all movements
            </Link>
          </div>
        </div>

        <figure className="relative isolate min-h-107.5 overflow-hidden rounded-[3px_34px_3px_3px] border border-border bg-background-alt sm:min-h-140">
          <div
            className="cv-grid absolute inset-0 -z-10 opacity-25"
            aria-hidden="true"
          />
          <span
            className="absolute top-[13%] left-[18%] aspect-square w-[64%] rounded-full bg-primary-light"
            aria-hidden="true"
          />

          {movement.illustration_url ? (
            <div className="absolute inset-[3%_1%_4%]">
              <Image
                src={movement.illustration_url}
                alt={`${movement.name} movement illustration`}
                fill
                priority
                sizes="(max-width: 1024px) 100vw, 52vw"
                className="object-contain drop-shadow-[0_28px_34px_rgba(28,28,26,0.12)]"
              />
            </div>
          ) : (
            <div className="absolute inset-0 grid place-items-center">
              <span className="font-mono text-[0.58rem] tracking-widest text-foreground-faint uppercase">
                Illustration unavailable
              </span>
            </div>
          )}

          <figcaption className="absolute right-4 bottom-4 left-4 flex items-center justify-between gap-4 rounded-sm border border-border bg-card/90 px-4 py-3 backdrop-blur-sm sm:right-6 sm:bottom-6 sm:left-6">
            <span className="font-mono text-[0.56rem] tracking-widest text-foreground-faint uppercase">
              Movement plate / {movement.slug.replaceAll("-", " ")}
            </span>
            <span className="text-xs font-semibold text-primary">
              {formatDifficulty(content.difficulty)}
            </span>
          </figcaption>
        </figure>
      </div>
    </header>
  );
}
