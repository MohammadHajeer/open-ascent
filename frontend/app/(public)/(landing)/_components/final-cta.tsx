import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

type MovementListItem = {
  id: string;
  slug: string;
  name: string;
  family_key: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  illustration_url: string | null;
  upload_analysis_supported: boolean;
  live_coach_supported: boolean;
};

export async function FinalCTA() {
  const movements = await apiFetch<MovementListItem[]>("/movements", {
    cache: "no-store",
  });

  const featuredMovement =
    movements.find((movement) => movement.upload_analysis_supported) ??
    movements.find((movement) => movement.slug === "pull-up");

  return (
    <section
      className="bg-background px-4 pb-4 sm:px-5 sm:pb-5"
      aria-labelledby="final-cta-title"
    >
      <div className="relative mx-auto min-h-155 w-full max-w-360 overflow-hidden rounded-[3px_3px_44px_3px] bg-primary px-6 py-14 text-primary-foreground sm:px-10 sm:py-20 lg:min-h-170 lg:px-16">
        <div
          className="cv-grid absolute inset-0 opacity-[0.08]"
          aria-hidden="true"
        />

        <div className="relative z-10 max-w-215">
          <span className="font-mono text-[0.62rem] font-semibold tracking-[0.11em] text-primary-foreground/70 uppercase">
            Feedback for every phase
          </span>

          <h2
            id="final-cta-title"
            className="mt-6 text-[clamp(3.5rem,7.8vw,8.2rem)] leading-[0.86] font-medium tracking-[-0.075em]"
          >
            Train with feedback,
            <span className="block text-primary-foreground/60">
              not guesswork.
            </span>
          </h2>

          <div className="mt-10 flex flex-wrap gap-3">
            <Link
              href="/analyze"
              className={cn(
                buttonVariants({
                  size: "lg",
                }),
                "bg-primary-foreground text-primary hover:bg-primary-foreground/90",
              )}
            >
              Analyze a video
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </Link>

            <Link
              href="/movements"
              className={cn(
                buttonVariants({
                  variant: "outline",
                  size: "lg",
                }),
                "border-primary-foreground/30 bg-transparent text-primary-foreground hover:border-primary-foreground/50 hover:bg-primary-foreground/10 hover:text-primary-foreground",
              )}
            >
              Explore movements
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
        </div>

        {featuredMovement?.illustration_url && (
          <div
            className="pointer-events-none absolute right-[-20%] bottom-[-10%] h-[52%] w-[96%] opacity-45 sm:right-[-10%] sm:h-[62%] sm:w-[80%] lg:right-[-6%] lg:bottom-[-18%] lg:h-[82%] lg:w-[62%] lg:opacity-55"
            aria-hidden="true"
          >
            <Image
              className="object-contain object-bottom-right drop-shadow-[0_24px_34px_rgba(28,28,26,0.18)]"
              src={featuredMovement.illustration_url}
              alt=""
              fill
              sizes="(max-width: 1024px) 90vw, 60vw"
            />
          </div>
        )}
      </div>
    </section>
  );
}
