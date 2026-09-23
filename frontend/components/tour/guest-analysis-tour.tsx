"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spotlight } from "./spotlight";

const KEY = "open-ascent:guest-analysis-tour:v1";
const steps = [
  { target: "guest-movement", title: "Choose your movement", description: "Select the movement shown in your clip so the analysis uses the right target and guidance." },
  { target: "guest-upload", title: "Add a short video", description: "Upload an MP4 clip or record one here. Check the duration and safety guidance before starting analysis." },
  { target: "guest-processing", title: "Analysis in progress", description: "Open Ascent is processing the uploaded clip and evaluating detected repetitions. You can let it continue while this guide waits for the result." },
  { target: "guest-result-summary", title: "Your result at a glance", description: "These values summarize confirmed counts, recording evidence, and timing when available." },
  { target: "guest-result-reps", title: "Rep by rep", description: "Each attempt has an outcome and recorded evidence. Uncertain means the evidence was insufficient to judge that attempt." },
  { target: "guest-result-findings", title: "Analysis findings", description: "This section groups the strongest issues and shows their supporting observations, when any were found." },
  { target: "guest-result-safety", title: "Movement guidance", description: "Review the published movement guidance alongside your result. The analysis does not replace your own judgment about readiness." },
] as const;

type State = { stage: number; mode: "offer" | "explain" | "waiting" | "done" | "dismissed" };

function readState(): State {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) {
      const value = JSON.parse(raw) as State;
      if (Number.isInteger(value.stage) && value.stage >= -1 && value.stage <= steps.length && ["offer", "explain", "waiting", "done", "dismissed"].includes(value.mode)) return value;
    }
  } catch { /* Continue without browser persistence. */ }
  return { stage: 0, mode: "offer" };
}

export function GuestAnalysisTour() {
  const [state, setState] = useState<State | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setState(readState()), 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!state) return;
    try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch { /* Still works for this render. */ }
  }, [state]);

  useEffect(() => {
    if (!state || state.mode === "done" || state.mode === "dismissed" || state.mode === "offer") return;
    const update = () => {
      if (state.stage === -1) {
        const initial = document.querySelector('[data-tour="guest-result-summary"]') ? 3
          : document.querySelector('[data-tour="guest-processing"]') ? 2
          : document.querySelector('[data-tour="guest-upload"]') ? 1
          : document.querySelector('[data-tour="guest-movement"]') ? 0 : null;
        if (initial !== null) setState({ stage: initial, mode: "explain" });
        return;
      }
      // A fast analysis may go from upload straight to a mounted result.
      if (state.stage < 3 && document.querySelector('[data-tour="guest-result-summary"]')) {
        setState({ stage: 3, mode: "explain" });
        return;
      }
      if (state.mode === "waiting" && document.querySelector(`[data-tour="${steps[state.stage]?.target}"]`)) {
        setState({ ...state, mode: "explain" });
      }
    };
    const observer = new MutationObserver(update);
    observer.observe(document.body, { subtree: true, childList: true });
    update();
    return () => observer.disconnect();
  }, [state]);

  if (!state || state.mode === "done" || state.mode === "dismissed") return null;
  if (state.mode === "offer") return <div className="fixed bottom-4 right-4 z-50 w-[min(340px,calc(100vw-32px))] rounded-2xl border border-border bg-card p-5 text-foreground shadow-xl" role="dialog" aria-label="Guest analysis guide invitation">
    <h2 className="text-base font-semibold">New to movement analysis?</h2>
    <p className="mt-2 text-sm leading-5 text-foreground-soft">Follow a short guide through your video and results.</p>
    <div className="mt-4 flex gap-2">
      <Button type="button" variant="brand" onClick={() => {
        const initial = document.querySelector('[data-tour="guest-result-summary"]') ? 3
          : document.querySelector('[data-tour="guest-processing"]') ? 2
          : document.querySelector('[data-tour="guest-upload"]') ? 1
          : document.querySelector('[data-tour="guest-movement"]') ? 0 : -1;
        setState({ stage: initial, mode: initial === -1 ? "waiting" : "explain" });
      }}>Start guide</Button>
      <Button type="button" variant="outline" onClick={() => setState({ stage: 0, mode: "dismissed" })}>Skip</Button>
    </div>
  </div>;
  if (state.mode !== "explain" || !steps[state.stage]) return null;
  const current = steps[state.stage];
  return <Spotlight
    key={state.stage}
    {...current}
    progress={`${state.stage + 1} of ${steps.length}`}
    onBack={state.stage > 3 ? () => setState({ stage: state.stage - 1, mode: "explain" }) : undefined}
    onNext={() => setState(state.stage === steps.length - 1 ? { stage: steps.length, mode: "done" } : { stage: state.stage + 1, mode: "waiting" })}
    onExit={() => setState({ stage: state.stage, mode: "dismissed" })}
    onMissing={() => setState({ stage: state.stage, mode: "waiting" })}
    nextLabel={state.stage === steps.length - 1 ? "Finish" : state.stage < 3 ? "Got it" : "Next"}
  />;
}
