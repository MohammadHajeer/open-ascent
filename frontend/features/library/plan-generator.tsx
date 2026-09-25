"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PlanPreviewCard } from "@/features/coach/plan-preview";
import { getConversation, streamGeneration } from "@/features/coach/api";
import { getGenerationOptions, startLibraryPlan, type PlanMode } from "./api";

const modes: { id: PlanMode; title: string; description: string }[] = [
  { id: "profile", title: "Start from my profile", description: "A conservative start from your onboarding, equipment and schedule." },
  { id: "goal", title: "Build toward a goal", description: "Work toward a skill or capability through appropriate prerequisites." },
  { id: "progress", title: "Adapt to my progress", description: "Use recent workouts and comparable progress trends." },
];

export function PlanGenerator() {
  const queryClient = useQueryClient();
  const options = useQuery({ queryKey: ["library", "generation-options"], queryFn: getGenerationOptions });
  const [mode, setMode] = useState<PlanMode | null>(null);
  const [goal, setGoal] = useState("");
  const [note, setNote] = useState("");
  const [active, setActive] = useState<{ conversationId: string; generationId: string } | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);
  const requestId = useRef<string | null>(null);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    streamGeneration(active.conversationId, active.generationId, async snapshot => {
      setStatus(snapshot.status);
      if (snapshot.status === "failed" || snapshot.status === "interrupted") {
        setError(snapshot.content || "The plan request could not be completed.");
        if (snapshot.status === "failed") requestId.current = null;
        void queryClient.invalidateQueries({ queryKey: ["library", "generation-options"] });
        setActive(null);
      } else if (snapshot.status === "completed") {
        try {
          const conversation = await getConversation(active.conversationId);
          const reply = conversation.messages.find(message => message.generation_id === active.generationId);
          if (!reply?.plan_preview_id) {
            requestId.current = null;
            throw new Error(reply?.content || "The preview could not be found. Open AI Coach to review this request.");
          }
          setPreviewId(reply.plan_preview_id);
          setActive(null);
          requestId.current = null;
          void queryClient.invalidateQueries({ queryKey: ["library", "generation-options"] });
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Could not load the preview.");
          setActive(null);
        }
      }
    }, controller.signal).catch(cause => {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "Could not follow generation status.");
        setActive(null);
      }
    });
    return () => controller.abort();
  }, [active, queryClient]);

  function reset() {
    setMode(null); setGoal(""); setNote(""); setPreviewId(null); setError(null); setStatus(""); requestId.current = null;
  }

  async function generate() {
    if (!mode || sending || active || (mode === "goal" && !goal)) return;
    setSending(true); setError(null); setPreviewId(null);
    requestId.current ??= crypto.randomUUID();
    try {
      const result = await startLibraryPlan({
        client_request_id: requestId.current,
        mode,
        ...(mode === "goal" ? goal === "general_pulling_strength" ? { goal_focus: "general_pulling_strength" } : { goal_movement_id: goal } : {}),
        note: note.trim() || undefined,
      });
      setActive({ conversationId: result.conversation_id, generationId: result.generation_id });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start plan generation.");
    } finally { setSending(false); }
  }

  return <div className="p-5 sm:p-7">
    {previewId ? <>
      <div className="flex items-center justify-between gap-3"><p className="text-sm text-foreground-soft">Review the structured plan before saving it.</p><Button variant="outline" onClick={reset}>New plan</Button></div>
      <PlanPreviewCard previewId={previewId} onSaved={() => void queryClient.invalidateQueries({ queryKey: ["library", "plans"] })} />
    </> : !mode ? <>
      <h3 className="text-lg font-medium tracking-tight">How should Open Ascent build this plan?</h3>
      {options.data && <p className="mt-1 text-xs text-foreground-faint">{options.data.plan_remaining === null ? "Plan generation is available under your current plan." : `${options.data.plan_remaining} of ${options.data.plan_allowance} plan generations remaining this month.`}</p>}
      <div className="mt-4 grid gap-3 lg:grid-cols-3">{modes.map(item => <button key={item.id} type="button" onClick={() => { setMode(item.id); setError(null); }} className="group rounded-xl border border-border/80 bg-background/50 p-4 text-left transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-primary">
        <span className="flex items-center justify-between gap-3 text-sm font-semibold text-foreground">{item.title}<ArrowRight className="size-4 text-primary" aria-hidden="true" /></span>
        <span className="mt-2 block text-xs leading-5 text-foreground-soft">{item.description}</span>
        {item.id === "progress" && options.data && !options.data.progress_available && <span className="mt-2 block text-xs text-foreground-faint">Needs at least two logged workouts.</span>}
      </button>)}</div>
    </> : <>
      <button type="button" onClick={reset} disabled={Boolean(active) || sending} className="inline-flex items-center gap-1 text-xs text-foreground-soft hover:text-foreground"><ArrowLeft className="size-3" />Change mode</button>
      <h3 className="mt-3 text-lg font-medium tracking-tight">{modes.find(item => item.id === mode)?.title}</h3>
      <p className="mt-1 text-sm text-foreground-soft">{modes.find(item => item.id === mode)?.description}</p>
      {mode === "goal" && <label className="mt-5 block max-w-md text-sm font-medium">Your goal
        <select value={goal} onChange={event => { setGoal(event.target.value); requestId.current = null; }} className="mt-2 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
          <option value="">Select a goal</option>
          <option value="general_pulling_strength">General pulling strength</option>
          {options.data?.goals.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>}
      {mode === "progress" && options.data && !options.data.progress_available && <p role="status" className="mt-4 rounded-lg border border-border bg-background-alt/40 p-3 text-sm text-foreground-soft">Log at least two workouts to use progress adaptation. You can start from your profile or build toward a goal now.</p>}
      <label className="mt-5 block max-w-lg text-sm font-medium">Optional preference
        <textarea value={note} onChange={event => { setNote(event.target.value); requestId.current = null; }} maxLength={280} rows={2} placeholder="Anything the plan should account for?" className="mt-2 w-full rounded-lg border border-input bg-background p-3 text-sm" />
      </label>
      <p className="mt-3 text-xs text-foreground-faint">One generation uses one monthly plan allowance. Preview and Save use no extra allowance.</p>
      {options.data && <p className="mt-1 text-xs text-foreground-faint">{options.data.plan_remaining === null ? "Available under your current plan." : `${options.data.plan_remaining} of ${options.data.plan_allowance} remaining this month.`}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      {active && <p role="status" className="mt-3 flex items-center gap-2 text-sm text-foreground-soft"><LoaderCircle className="size-4 animate-spin" />Generating and validating your plan… {status}</p>}
      <Button className="mt-5" onClick={() => void generate()} disabled={sending || Boolean(active) || (mode === "goal" && !goal) || (mode === "progress" && options.data?.progress_available === false) || options.data?.plan_remaining === 0}>{sending ? "Starting…" : "Generate plan"}</Button>
    </>}
  </div>;
}
