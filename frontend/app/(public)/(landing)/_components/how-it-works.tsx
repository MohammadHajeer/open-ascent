import { Badge } from "@/components/ui/badge";

const steps = [
  {
    number: "01",
    title: "Choose",
    description: "Select the calisthenics movement you intend to perform.",
    status: "Exercise context",
  },
  {
    number: "02",
    title: "Perform",
    description: "Use a recorded clip or, later, a live camera session.",
    status: "Body landmarks",
  },
  {
    number: "03",
    title: "Understand",
    description: "Vision maps position, tempo, range, and movement phase.",
    status: "Movement logic",
  },
  {
    number: "04",
    title: "Coach",
    description: "Valid reps are counted and useful form feedback is surfaced.",
    status: "Actionable feedback",
  },
];

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="scroll-mt-20 bg-background"
      aria-labelledby="how-it-works-title"
    >
      <div className="mx-auto w-full max-w-360 px-4 py-24 sm:px-5 sm:py-32 lg:py-40">
        <div className="grid gap-9 lg:grid-cols-[0.72fr_1.28fr] lg:items-end lg:gap-20">
          <div>
            <Badge variant="secondary">How it works</Badge>
            <p className="mt-5 font-mono text-[0.62rem] tracking-[0.12em] text-foreground-faint uppercase">
              Movement → Vision → Understanding → Coaching
            </p>
          </div>
          <div>
            <h2
              id="how-it-works-title"
              className="max-w-3xl text-[clamp(2.8rem,5.8vw,5.8rem)] leading-[0.95] font-medium tracking-[-0.06em] text-foreground"
            >
              From the first frame to useful feedback.
            </h2>
          </div>
        </div>

        <ol className="mt-16 border-t border-border sm:mt-24 lg:grid lg:grid-cols-4">
          {steps.map((step, index) => (
            <li
              className="group relative grid grid-cols-[56px_1fr] gap-3 border-b border-border py-7 sm:grid-cols-[72px_1fr] sm:py-9 lg:block lg:min-h-82.5 lg:border-r lg:border-b-0 lg:px-7 lg:py-9 first:lg:pl-0 last:lg:border-r-0 last:lg:pr-0"
              key={step.number}
            >
              <span className="font-mono text-[0.65rem] tracking-[0.12em] text-primary">
                {step.number}
              </span>
              <div className="lg:mt-16">
                <h3 className="text-[clamp(1.7rem,2.4vw,2.35rem)] font-medium tracking-[-0.045em] text-foreground">
                  {step.title}
                </h3>
                <p className="mt-3 max-w-62.5 text-sm leading-6 text-foreground-soft lg:mt-5">
                  {step.description}
                </p>
                <div className="mt-7 flex items-center gap-2 font-mono text-[0.56rem] tracking-[0.09em] text-foreground-faint uppercase lg:absolute lg:bottom-9">
                  <span className="size-1.5 rounded-full bg-primary transition-transform duration-300 group-hover:scale-150" />
                  {step.status}
                </div>
              </div>
              {index < steps.length - 1 ? (
                <span
                  className="absolute -top-0.75 right-0 translate-x-1/2 hidden size-1.5 rounded-full bg-primary lg:block"
                  aria-hidden="true"
                />
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
