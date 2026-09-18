import { Badge } from "@/components/ui/badge";

export function Principle() {
  return (
    <section
      className="border-y border-border bg-background-alt"
      aria-labelledby="principle-title"
    >
      <div className="mx-auto grid w-full max-w-360 gap-12 px-4 py-20 sm:px-5 sm:py-28 lg:grid-cols-[0.72fr_1.28fr] lg:items-end lg:gap-20 lg:py-36">
        <div>
          <Badge variant="outline">The principle</Badge>
          <p className="mt-6 max-w-sm text-sm leading-6 text-foreground-soft">
            Tracking motion is easy. Understanding whether it was the right
            motion is where coaching begins.
          </p>
        </div>
        <div>
          <h2
            id="principle-title"
            className="text-[clamp(2.7rem,6.2vw,6.4rem)] leading-[0.94] font-medium tracking-[-0.065em] text-foreground"
          >
            A counter knows
            <span className="block text-foreground-faint">that you moved.</span>
            <span className="mt-3 block text-primary">A coach knows how.</span>
          </h2>
        </div>
      </div>
    </section>
  );
}
