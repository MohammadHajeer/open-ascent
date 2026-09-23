"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { authApiFetch } from "@/lib/auth-api";
import { Spotlight } from "./spotlight";

type Status = "not_started" | "completed" | "dismissed";
const steps = [
  { route: "/dashboard", target: "dashboard-overview", title: "Your overview", description: "Start here to find your movement record and a direct path to analysis." },
  { route: "/dashboard/train", target: "workout-log", title: "Record your training", description: "Log sets and holds to build a reliable history of your practice." },
  { route: "/dashboard/train/live-coach", target: "live-coach", title: "Live Coach", description: "Use the browser camera for local pull-up rep counting and focused cues when you choose to start it." },
  { route: "/dashboard/analyses", target: "analysis-history", title: "Saved analyses", description: "Review completed movement analyses and open a new recorded-video analysis." },
  { route: "/dashboard/progress", target: "progress-view", title: "Track progress", description: "Compare logged performance and weekly consistency for a movement over time." },
  { route: "/dashboard/coach", target: "ai-coach", title: "AI Coach", description: "Ask focused training questions and review coaching guidance in this workspace." },
] as const;

export function DashboardTour() {
  const pathname = usePathname();
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [step, setStep] = useState<number | null>(null);
  const [replay, setReplay] = useState(false);
  const [handledHere, setHandledHere] = useState(false);

  useEffect(() => {
    let alive = true;
    authApiFetch<{ status: Status }>("/profiles/me/dashboard-tour")
      .then((state) => { if (alive) setStatus(state.status); })
      .catch(() => { /* A missing session must not show an invitation. */ });
    return () => { alive = false; };
  }, []);

  const prompt = pathname === "/dashboard" && status === "not_started" && step === null && !handledHere;

  useEffect(() => {
    const startReplay = () => {
      setReplay(true);
      setHandledHere(true);
      setStep(0);
      router.push(steps[0].route);
    };
    window.addEventListener("dashboard-tour:replay", startReplay);
    return () => window.removeEventListener("dashboard-tour:replay", startReplay);
  }, [router]);

  const saveDecision = useCallback((decision: "completed" | "dismissed") => {
    if (replay || status !== "not_started") return;
    // Hide immediately. A failed write remains eligible for the invitation later.
    authApiFetch<{ status: Status }>("/profiles/me/dashboard-tour", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: decision }),
    }).then((state) => setStatus(state.status)).catch(() => setStatus("not_started"));
  }, [replay, status]);

  const exit = useCallback(() => {
    setHandledHere(true);
    setStep(null);
    saveDecision("dismissed");
  }, [saveDecision]);
  const missing = useCallback(() => exit(), [exit]);
  const move = (index: number) => {
    setStep(index);
    router.push(steps[index].route);
  };

  return <>
    {prompt && step === null && <div className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] right-4 z-50 max-h-[calc(100dvh-8rem-env(safe-area-inset-bottom))] w-[min(340px,calc(100vw-32px))] overflow-y-auto rounded-2xl border border-border bg-card p-5 text-foreground shadow-xl lg:bottom-6 lg:right-6 lg:max-h-[calc(100dvh-3rem)]" role="dialog" aria-label="Dashboard tour invitation">
      <h2 className="text-base font-semibold">Want a quick tour of Open Ascent?</h2>
      <p className="mt-2 text-sm text-foreground-soft">A short walkthrough of your training workspace.</p>
      <div className="mt-4 flex gap-2">
        <Button type="button" variant="brand" onClick={() => { setHandledHere(true); setReplay(false); setStep(0); }}>Start tour</Button>
        <Button type="button" variant="outline" onClick={exit}>Skip</Button>
      </div>
    </div>}
    {step !== null && <Spotlight
      key={step}
      {...steps[step]}
      progress={`${step + 1} of ${steps.length}`}
      onBack={step > 0 ? () => move(step - 1) : undefined}
      onNext={() => {
        if (step === steps.length - 1) { setStep(null); saveDecision("completed"); }
        else move(step + 1);
      }}
      onExit={exit}
      onMissing={missing}
      nextLabel={step === steps.length - 1 ? "Finish" : "Next"}
    />}
  </>;
}
