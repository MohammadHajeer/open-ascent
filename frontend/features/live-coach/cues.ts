import type { LiveCoachCue, PullUpSnapshot } from "./types.ts";

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
  kneeBend: {
    id: "excessive-knee-bend",
    priority: 72,
    tone: "attention",
    title: "Keep your legs straighter",
    detail: "Avoid a sustained deep knee bend while pulling.",
  },
  swing: {
    id: "body-swing",
    priority: 72,
    tone: "attention",
    title: "Reduce the swing",
    detail: "Let your lower body settle before the next pull.",
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
  if (snapshot.formFault === "excessive-knee-bend") candidates.push(cues.kneeBend);
  if (snapshot.formFault === "body-swing") candidates.push(cues.swing);
  const recentRep = snapshot.phase === "bottom" && snapshot.latestRep &&
    timestampMs - snapshot.latestRep.endMs <= 2500;
  if (recentRep && snapshot.latestRep?.outcome === "partial") candidates.push(cues.partial);
  if (recentRep && snapshot.latestRep?.outcome === "valid") candidates.push(cues.complete);
  if (snapshot.phase === "top") candidates.push(cues.top);
  if (snapshot.phase === "lowering") candidates.push(cues.lowering);
  if (snapshot.phase === "rising") candidates.push(cues.rising);
  if (snapshot.phase === "bottom") candidates.push(cues.ready);

  return candidates.sort((left, right) => right.priority - left.priority)[0] ?? cues.noPose;
}
