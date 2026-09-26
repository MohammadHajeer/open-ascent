import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowUpRight, BookOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  MovementsCatalog,
  MovementsCatalogSkeleton,
} from "./_components/movements-catalog";

export const metadata: Metadata = {
  title: "Movement Library — Open Ascent",
  description:
    "Explore published calisthenics movement guides, difficulty levels, safety guidance, prerequisites, and technique information.",
};

export default function MovementsPage() {
  return (
    <>
      <header className="border-b border-border">
        <div className="mx-auto grid w-full max-w-360 gap-10 px-4 py-16 sm:px-5 sm:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.42fr)] lg:items-end lg:gap-20 lg:py-24">
          <div>
            <Badge variant="secondary">
              <BookOpen aria-hidden="true" />
              Movement reference
            </Badge>

            <h1 className="mt-6 max-w-4xl text-[clamp(3.6rem,8vw,7rem)] leading-[0.88] font-medium tracking-[-0.072em] text-foreground">
              Movement
              <span className="block text-primary">library.</span>
            </h1>
          </div>

          <div className="border-l border-border pl-5 sm:pl-7">
            <p className="text-base leading-7 text-foreground-soft sm:text-lg sm:leading-8">
              Explore published calisthenics movements and learn their
              difficulty, prerequisites, safety guidance, and technique before
              training.
            </p>
          </div>
        </div>
      </header>

      <Suspense fallback={<MovementsCatalogSkeleton />}>
        <MovementsCatalog />
      </Suspense>

      <section className="border-y border-border bg-background">
        <div className="mx-auto grid w-full max-w-360 gap-8 px-4 py-20 sm:px-5 sm:py-24 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <span className="font-mono text-[0.58rem] font-semibold tracking-widest text-primary uppercase">
              From reference to feedback
            </span>

            <h2 className="mt-4 max-w-3xl text-[clamp(2.8rem,5vw,5.2rem)] leading-[0.92] font-medium tracking-[-0.062em] text-foreground">
              Learn the movement. Then analyze yours.
            </h2>
          </div>

          <Link
            href="/analyze"
            className={buttonVariants({
              variant: "brand",
              size: "lg",
            })}
          >
            Analyze a video
            <ArrowUpRight className="size-4" />
          </Link>
        </div>
      </section>
    </>
  );
}
