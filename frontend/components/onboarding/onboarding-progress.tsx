import { Activity, ShieldCheck, Target } from "lucide-react";

export const onboardingSteps = [
  {
    label: "Safety",
    icon: ShieldCheck,
    title: "Start with awareness.",
    description: "Read the guidance that applies across Open Ascent training.",
  },
  {
    label: "Training context",
    icon: Target,
    title: "Shape your training context.",
    description: "A few details help us tailor your athlete workspace.",
  },
  {
    label: "Starting point",
    icon: Activity,
    title: "Mark your starting point.",
    description: "Self-reported answers give your profile a provisional baseline.",
  },
] as const;

export function OnboardingProgress({ step }: { step: number }) {
  return (
    <nav aria-label="Onboarding progress" className="mb-7">
      <div className="mb-4 flex items-center justify-between gap-4 border-b border-border pb-4">
        <span className="font-mono text-[0.62rem] font-semibold tracking-[0.16em] text-primary uppercase">
          Athlete profile / Setup
        </span>
        <span className="font-mono text-[0.62rem] text-foreground-faint">
          0{step + 1} / 03
        </span>
      </div>
      <ol className="grid grid-cols-3 gap-2">
        {onboardingSteps.map((item, index) => (
          <li
            key={item.label}
            className={`border-t-2 pt-2 font-mono text-[0.55rem] leading-4 tracking-wide uppercase sm:text-[0.62rem] ${index <= step ? "border-primary text-primary" : "border-border text-foreground-faint"}`}
            aria-current={index === step ? "step" : undefined}
          >
            {item.label}
          </li>
        ))}
      </ol>
    </nav>
  );
}
