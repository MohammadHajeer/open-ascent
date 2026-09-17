import Link from "next/link";
import { ArrowLeft, SearchX } from "lucide-react";

import { Footer } from "@/components/shared/footer";
import { Navbar } from "@/components/shared/navbar";
import { buttonVariants } from "@/components/ui/button";

export default function MovementNotFound() {
  return (
    <main className="min-h-dvh bg-background">
      <Navbar activePage="movements" />

      <section className="mx-auto flex min-h-[65dvh] w-full max-w-360 items-center px-4 py-20 sm:px-5">
        <div className="max-w-2xl">
          <SearchX className="size-7 text-primary" aria-hidden="true" />
          <p className="mt-6 font-mono text-[0.58rem] font-semibold tracking-widest text-primary uppercase">
            Movement not found
          </p>
          <h1 className="mt-3 text-[clamp(3rem,7vw,6.5rem)] leading-[0.9] font-medium tracking-[-0.07em] text-foreground">
            That guide is not available.
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-foreground-soft">
            The movement may not exist, or it may not have a published guide yet.
          </p>
          <Link
            href="/movements"
            className={`${buttonVariants({ variant: "brand", size: "lg" })} mt-8`}
          >
            <ArrowLeft className="size-4" />
            Back to movement library
          </Link>
        </div>
      </section>

      <Footer />
    </main>
  );
}
