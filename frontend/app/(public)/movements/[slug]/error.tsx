"use client";

import { CircleAlert, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function Error({ reset }: { reset: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-20">
      <div className="max-w-xl text-center">
        <CircleAlert className="mx-auto size-7 text-primary" aria-hidden="true" />
        <p className="mt-6 font-mono text-[0.58rem] font-semibold tracking-widest text-primary uppercase">
          Guide unavailable
        </p>
        <h1 className="mt-3 text-4xl font-medium tracking-tight text-foreground sm:text-5xl">
          We could not load this movement guide.
        </h1>
        <p className="mt-5 text-sm leading-6 text-foreground-soft sm:text-base sm:leading-7">
          The movement service may be temporarily unavailable. Try the request again.
        </p>
        <Button className="mt-8" variant="brand" size="lg" onClick={reset}>
          <RotateCcw className="size-4" />
          Try again
        </Button>
      </div>
    </main>
  );
}
