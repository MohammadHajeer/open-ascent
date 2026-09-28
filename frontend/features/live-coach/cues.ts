import type { LiveCoachCue, MuscleUpSnapshot, PullUpSnapshot, PushUpSnapshot } from "./types.ts";

const cues = {
  noPose: {
    id: "frame-body",
    priority: 100,
    tone: "attention",
    title: "Frame your full body and bar",
    detail: "Keep both wrists, shoulders, and hips visible before you begin.",
  },
  unusable: {
    id: "tracking-unusable",
    priority: 98,
    tone: "attention",
    title: "Tracking needs a clearer view",
    detail: "Keep both wrists, elbows, shoulders, and hips visible with good light.",
  },
  setup: {
    id: "set-position",
    priority: 90,
    tone: "attention",
    title: "Set a stable hanging position",
    detail: "Keep both hands above the shoulders and your body under the bar.",
  },
  starting: {
    id: "hold-start",
    priority: 60,
    tone: "neutral",
    title: "Hold the start position",
    detail: "Extend your arms in a steady hang before the first rep.",
  },
  extension: {
    id: "extend-at-bottom",
    priority: 75,
    tone: "attention",
    title: "Extend at the bottom",
    detail: "Reach a steady hang with straighter elbows before pulling.",
  },
  swing: {
    id: "body-swing",
    priority: 72,
    tone: "attention",
    title: "Reduce the swing",
    detail: "Let your hips and legs settle under the bar before the next pull.",
  },
  partial: {
    id: "finish-top",
    priority: 70,
    tone: "attention",
    title: "Finish higher before lowering",
    detail: "Bring your face to bar height, then return under control.",
  },
  complete: {
    id: "rep-complete",
    priority: 65,
    tone: "positive",
    title: "Rep complete",
    detail: "Return to a steady hang for the next pull.",
  },
  top: {
    id: "top-confirmed",
    priority: 20,
    tone: "positive",
    title: "Top confirmed",
    detail: "Lower with control to complete the rep.",
  },
  lowering: {
    id: "control-lowering",
    priority: 15,
    tone: "neutral",
    title: "Control the return",
    detail: "Reach a stable bottom before the next rep.",
  },
  rising: {
    id: "keep-pulling",
    priority: 10,
    tone: "neutral",
    title: "Pulling",
    detail: "Keep your body under the bar.",
  },
  ready: {
    id: "ready",
    priority: 5,
    tone: "positive",
    title: "Ready for a controlled rep",
    detail: "Begin from the confirmed bottom position.",
  },
} satisfies Record<string, LiveCoachCue>;

export function selectPrioritizedCue(
  snapshot: PullUpSnapshot,
  timestampMs = snapshot.observation?.timestampMs ?? snapshot.latestRep?.endMs ?? 0,
): LiveCoachCue {
  const candidates: LiveCoachCue[] = [];

  if (!snapshot.personDetected && !snapshot.poseReady) candidates.push(cues.noPose);
  if (snapshot.personDetected && !snapshot.poseReady) candidates.push(cues.unusable);
  if (snapshot.poseReady && !snapshot.setupReady) candidates.push(cues.setup);
  if (snapshot.poseReady && snapshot.setupReady && !snapshot.startingPositionReady) {
    candidates.push(cues.starting);
  }
  if (snapshot.formFault === "extend-at-bottom") candidates.push(cues.extension);
  if (snapshot.formFault === "body-swing") candidates.push(cues.swing);
  const recentRep = snapshot.phase === "bottom" && snapshot.latestRep &&
    timestampMs - snapshot.latestRep.endMs <= 2500;
  if (recentRep && snapshot.latestRep?.outcome === "partial") candidates.push(cues.partial);
  if (recentRep && snapshot.latestRep?.outcome === "valid") candidates.push(cues.complete);
  if (snapshot.phase === "top") candidates.push(cues.top);
  if (snapshot.phase === "lowering") candidates.push(cues.lowering);
  if (snapshot.phase === "rising") candidates.push(cues.rising);
  if (snapshot.phase === "bottom") candidates.push(cues.ready);

  return highestPriority(candidates, cues.noPose);
}

function highestPriority(candidates: LiveCoachCue[], fallback: LiveCoachCue) {
  return candidates.sort((left, right) => right.priority - left.priority)[0] ?? fallback;
}

const pushUpCues = {
  frame: { id: "push-frame-body", priority: 100, tone: "attention", title: "Frame your full body from the side", detail: "Keep shoulder, elbow, wrist, hip, and ankle visible in good light." },
  setup: { id: "push-set-position", priority: 90, tone: "attention", title: "Set a side-view plank position", detail: "Place the camera beside you and keep your hands below your shoulders." },
  start: { id: "push-hold-start", priority: 60, tone: "neutral", title: "Hold the top position", detail: "Begin with extended arms and hold briefly before descending." },
  depth: { id: "go-lower", priority: 75, tone: "attention", title: "Go lower", detail: "Bend your elbows to reach the bottom before pressing back up." },
  extension: { id: "extend-arms", priority: 75, tone: "attention", title: "Extend your arms", detail: "Finish pressing to the top to complete the rep." },
  body: { id: "body-straight", priority: 72, tone: "attention", title: "Keep your body straight", detail: "Keep shoulders, hips, and ankles in a steady line." },
  complete: { id: "push-rep-complete", priority: 65, tone: "positive", title: "Rep complete", detail: "Begin another controlled descent when ready." },
  ready: { id: "push-ready", priority: 5, tone: "positive", title: "Ready for a controlled rep", detail: "Lower, then return to extended arms." },
  bottom: { id: "push-bottom", priority: 20, tone: "positive", title: "Bottom confirmed", detail: "Press back to the top to complete the rep." },
  lowering: { id: "push-lowering", priority: 15, tone: "neutral", title: "Lowering", detail: "Lower with control." },
  rising: { id: "push-rising", priority: 10, tone: "neutral", title: "Pressing up", detail: "Return to extended arms." },
} satisfies Record<string, LiveCoachCue>;

export function selectPushUpCue(snapshot: PushUpSnapshot, timestampMs: number): LiveCoachCue {
  const candidates: LiveCoachCue[] = [];
  if (!snapshot.poseReady) candidates.push(pushUpCues.frame);
  else if (!snapshot.setupReady) candidates.push(pushUpCues.setup);
  else if (!snapshot.startingPositionReady) candidates.push(pushUpCues.start);
  if (snapshot.formFault === "go-lower") candidates.push(pushUpCues.depth);
  if (snapshot.formFault === "extend-arms") candidates.push(pushUpCues.extension);
  if (snapshot.formFault === "body-straight") candidates.push(pushUpCues.body);
  if (snapshot.phase === "top") {
    candidates.push(pushUpCues.ready);
    if (snapshot.latestRep?.outcome === "valid" && timestampMs - snapshot.latestRep.endMs <= 2500) candidates.push(pushUpCues.complete);
  }
  if (snapshot.phase === "bottom") candidates.push(pushUpCues.bottom);
  if (snapshot.phase === "lowering") candidates.push(pushUpCues.lowering);
  if (snapshot.phase === "rising") candidates.push(pushUpCues.rising);
  return highestPriority(candidates, pushUpCues.frame);
}

const muscleUpCues = {
  frame: { id: "muscle-up-frame-body", priority: 100, tone: "attention", title: "Frame your body and the bar from the side", detail: "Keep shoulder, elbow, and wrist visible from the hang to support above the bar." },
  setup: { id: "muscle-up-set-position", priority: 90, tone: "attention", title: "Hang from the bar", detail: "Grip the bar with your hands above your shoulders." },
  start: { id: "muscle-up-hold-start", priority: 60, tone: "neutral", title: "Hold a straight-arm hang", detail: "Extend your arms and hold briefly before the first rep." },
  overBar: { id: "get-over-bar", priority: 75, tone: "attention", title: "Get over the bar", detail: "Turn over into support with straight arms before lowering." },
  complete: { id: "muscle-up-rep-complete", priority: 65, tone: "positive", title: "Rep complete", detail: "Settle in the hang, then begin the next rep." },
  top: { id: "muscle-up-support", priority: 20, tone: "positive", title: "Support confirmed", detail: "Lower back to a straight-arm hang to complete the rep." },
  transition: { id: "muscle-up-transition", priority: 15, tone: "neutral", title: "Transition", detail: "Turn over the bar and press to support." },
  lowering: { id: "muscle-up-lowering", priority: 15, tone: "neutral", title: "Return to the hang", detail: "Lower with control to a straight-arm hang." },
  rising: { id: "muscle-up-pulling", priority: 10, tone: "neutral", title: "Pulling", detail: "Pull toward the bar." },
  ready: { id: "muscle-up-ready", priority: 5, tone: "positive", title: "Ready for a controlled rep", detail: "Pull, turn over to support, then return to the hang." },
} satisfies Record<string, LiveCoachCue>;

export function selectMuscleUpCue(snapshot: MuscleUpSnapshot, timestampMs: number): LiveCoachCue {
  const candidates: LiveCoachCue[] = [];
  if (!snapshot.poseReady) candidates.push(muscleUpCues.frame);
  else if (!snapshot.setupReady) candidates.push(muscleUpCues.setup);
  else if (!snapshot.startingPositionReady) candidates.push(muscleUpCues.start);
  if (snapshot.formFault === "get-over-bar") candidates.push(muscleUpCues.overBar);
  if (snapshot.phase === "bottom") {
    candidates.push(muscleUpCues.ready);
    if (snapshot.latestRep?.outcome === "valid" && timestampMs - snapshot.latestRep.endMs <= 2500) candidates.push(muscleUpCues.complete);
  }
  if (snapshot.phase === "top") candidates.push(muscleUpCues.top);
  if (snapshot.phase === "transition") candidates.push(muscleUpCues.transition);
  if (snapshot.phase === "lowering") candidates.push(muscleUpCues.lowering);
  if (snapshot.phase === "rising") candidates.push(muscleUpCues.rising);
  return highestPriority(candidates, muscleUpCues.frame);
}
