"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, LoaderCircle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PlanPreviewCard } from "@/features/coach/plan-preview";
import { getConversation, streamGeneration } from "@/features/coach/api";
import {
  preflightLibraryPlan, startLibraryPlan, submitReadinessCheck,
  type LibraryPlanRequest, type PlanMode, type ReadinessQuestion,
} from "./api";
import { generationOptionsQuery, libraryKeys } from "./queries";

const modes: { id: PlanMode; title: string; description: string }[] = [
  { id: "profile", title: "Start from my profile", description: "A conservative start from your onboarding, equipment and schedule." },
  { id: "goal", title: "Build toward a goal", description: "Work toward a skill or capability through appropriate prerequisites." },
  { id: "progress", title: "Adapt to my progress", description: "Use recent workouts and comparable progress trends." },
];
type Answer = "able" | "not_yet" | "avoid";

export function PlanGenerator() {
  const queryClient = useQueryClient();
  const options = useQuery(generationOptionsQuery());
  const [mode, setMode] = useState<PlanMode | null>(null);
  const [goal, setGoal] = useState("");
  const [note, setNote] = useState("");
  const [questions, setQuestions] = useState<ReadinessQuestion[] | null>(null);
  const [retryQuestions, setRetryQuestions] = useState<ReadinessQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [active, setActive] = useState<{ conversationId: string; generationId: string } | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [working, setWorking] = useState(false);
  const requestId = useRef<string | null>(null);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    streamGeneration(active.conversationId, active.generationId, async snapshot => {
      setStatus(snapshot.status);
      if (snapshot.status === "failed" || snapshot.status === "interrupted") {
        setError(snapshot.content || "The plan request could not be completed.");
        if (snapshot.status === "failed") requestId.current = null;
        void queryClient.invalidateQueries({ queryKey: libraryKeys.generationOptions });
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
          void queryClient.invalidateQueries({ queryKey: libraryKeys.generationOptions });
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
    setMode(null); setGoal(""); setNote(""); setQuestions(null); setRetryQuestions([]); setAnswers({});
    setPreviewId(null); setError(null); setStatus(""); requestId.current = null;
  }

  function request(): LibraryPlanRequest | null {
    if (!mode || (mode === "goal" && !goal)) return null;
    requestId.current ??= crypto.randomUUID();
    return {
      client_request_id: requestId.current, mode,
      ...(mode === "goal" ? goal === "general_pulling_strength"
        ? { goal_focus: "general_pulling_strength" as const } : { goal_movement_id: goal } : {}),
      note: note.trim() || undefined,
    };
  }

  async function continueGeneration(payload: LibraryPlanRequest) {
    const check = await preflightLibraryPlan(payload);
    if (check.status === "check_required") {
      setQuestions(check.questions);
      setRetryQuestions([]);
      setAnswers({});
      return;
    }
    if (check.status === "unavailable") {
      setQuestions(null);
      setRetryQuestions(check.questions);
      setError(check.message || "No suitable foundation movement passes readiness yet.");
      return;
    }
    const result = await startLibraryPlan(payload);
    setActive({ conversationId: result.conversation_id, generationId: result.generation_id });
  }

  async function generate() {
    const payload = request();
    if (!payload || working || active) return;
    setWorking(true); setError(null); setPreviewId(null);
    try { await continueGeneration(payload); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not start plan generation."); }
    finally { setWorking(false); }
  }

  async function completeCheck() {
    const payload = request();
    if (!payload || !questions || working || questions.some(item => !answers[item.rule_code])) return;
    setWorking(true); setError(null);
    try {
      await submitReadinessCheck(questions.map(item => ({
        movement_id: item.movement_id, documentation_id: item.documentation_id,
        rule_code: item.rule_code, response: answers[item.rule_code],
      })));
      setQuestions(null);
      await continueGeneration(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the readiness check.");
    } finally { setWorking(false); }
  }

  return <div className="p-5 sm:p-7">
    {previewId ? <>
      <div className="flex items-center justify-between gap-3"><p className="text-sm text-foreground-soft">Review the structured plan before saving it.</p><Button variant="outline" onClick={reset}>New plan</Button></div>
      <PlanPreviewCard previewId={previewId} />
    </> : !mode ? <>
      <h3 className="text-lg font-medium tracking-tight">How should Open Ascent build this plan?</h3>
      {options.data && <p className="mt-1 text-xs text-foreground-faint">{options.data.plan_remaining === null ? "Plan generation is available under your current plan." : `${options.data.plan_remaining} of ${options.data.plan_allowance} plan generations remaining this month.`}</p>}
      {options.isError && <Alert variant="destructive" className="mt-3"><AlertTitle>Plan options could not be loaded.</AlertTitle><AlertDescription><Button variant="outline" size="sm" onClick={() => void options.refetch()}>Try again</Button></AlertDescription></Alert>}
      <div className="mt-4 grid gap-3 lg:grid-cols-3">{modes.map(item => <Button key={item.id} type="button" variant="outline" onClick={() => { setMode(item.id); setError(null); }} className="h-auto min-h-30 flex-col items-start justify-start whitespace-normal bg-background/50 p-4 text-left">
        <span className="flex w-full items-center justify-between gap-3 text-sm font-semibold">{item.title}<ArrowRight className="size-4 text-primary" aria-hidden="true" /></span>
        <span className="mt-2 text-xs leading-5 text-foreground-soft">{item.description}</span>
        {item.id === "progress" && options.data && !options.data.progress_available && <span className="mt-2 text-xs text-foreground-faint">Needs at least two logged workouts.</span>}
      </Button>)}</div>
    </> : <>
      <Button variant="ghost" size="sm" onClick={reset} disabled={Boolean(active) || working} className="gap-1 px-0"><ArrowLeft className="size-3" />Change mode</Button>
      <h3 className="mt-3 text-lg font-medium tracking-tight">{questions ? "Quick readiness check" : modes.find(item => item.id === mode)?.title}</h3>
      <p className="mt-1 text-sm text-foreground-soft">{questions ? "A few rule-backed answers help Open Ascent choose safe foundation work. Your answers are provisional and can be updated later." : modes.find(item => item.id === mode)?.description}</p>
      {!questions && mode === "goal" && <div className="mt-5 max-w-md"><Label htmlFor="plan-goal">Your goal</Label>
        <Select value={goal || null} onValueChange={value => { setGoal(value ?? ""); setRetryQuestions([]); setError(null); requestId.current = null; }}>
          <SelectTrigger id="plan-goal" className="mt-2 h-10 w-full"><SelectValue placeholder="Select a goal">{goal === "general_pulling_strength" ? "General pulling strength" : options.data?.goals.find(item => item.id === goal)?.name}</SelectValue></SelectTrigger>
          <SelectContent><SelectItem value="general_pulling_strength">General pulling strength</SelectItem>{options.data?.goals.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>}
      {!questions && mode === "progress" && options.data && !options.data.progress_available && <Alert className="mt-4"><AlertTitle>More training history needed</AlertTitle><AlertDescription>Log at least two workouts to use progress adaptation. You can start from your profile or build toward a goal now.</AlertDescription></Alert>}
      {!questions && <div className="mt-5 max-w-lg"><Label htmlFor="plan-note">Optional preference</Label><Textarea id="plan-note" value={note} onChange={event => { setNote(event.target.value); requestId.current = null; }} maxLength={280} rows={2} placeholder="Anything the plan should account for?" className="mt-2" /></div>}
      {questions && <div className="mt-5 grid gap-3 md:grid-cols-2">{questions.map(item => <Card key={item.rule_code} size="sm"><CardHeader><CardTitle>{item.movement_name}</CardTitle></CardHeader><CardContent>
        <Label htmlFor={`readiness-${item.rule_code}`}>{item.question}</Label>
        <p className="mt-1 text-xs text-foreground-faint">Published requirement: {item.requirement}</p>
        <Select value={answers[item.rule_code] ?? null} onValueChange={value => setAnswers(current => ({ ...current, [item.rule_code]: value as Answer }))}>
          <SelectTrigger id={`readiness-${item.rule_code}`} className="mt-3 h-10 w-full"><SelectValue placeholder="Choose an answer">{{ able: "Yes, with control and no pain", not_yet: "Not yet", avoid: "Pain or prefer to avoid" }[answers[item.rule_code]]}</SelectValue></SelectTrigger>
          <SelectContent><SelectItem value="able">Yes, with control and no pain</SelectItem><SelectItem value="not_yet">Not yet</SelectItem><SelectItem value="avoid">Pain or prefer to avoid</SelectItem></SelectContent>
        </Select>
      </CardContent></Card>)}</div>}
      {questions && <p className="mt-3 text-xs text-foreground-faint">This check does not use a plan-generation allowance.</p>}
      {!questions && <p className="mt-3 text-xs text-foreground-faint">One generation uses one monthly plan allowance. Preview and Save use no extra allowance.</p>}
      {!questions && options.data && <p className="mt-1 text-xs text-foreground-faint">{options.data.plan_remaining === null ? "Available under your current plan." : `${options.data.plan_remaining} of ${options.data.plan_allowance} remaining this month.`}</p>}
      {error && <Alert variant="destructive" className="mt-3"><AlertTitle>Could not continue</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
      {error && retryQuestions.length > 0 && !questions && <Button variant="outline" className="mt-3" onClick={() => { setQuestions(retryQuestions); setAnswers({}); setError(null); }}>Update readiness answers</Button>}
      {active && <p role="status" className="mt-3 flex items-center gap-2 text-sm text-foreground-soft"><LoaderCircle className="size-4 animate-spin" />Generating and validating your plan… {status}</p>}
      <Button className="mt-5" onClick={() => void (questions ? completeCheck() : generate())} disabled={working || Boolean(active) || (questions ? questions.some(item => !answers[item.rule_code]) : (mode === "goal" && !goal) || (mode === "progress" && options.data?.progress_available === false) || options.data?.plan_remaining === 0)}>{working ? "Checking…" : questions ? "Continue to plan" : "Generate plan"}</Button>
    </>}
  </div>;
}
