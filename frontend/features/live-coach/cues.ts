import type { LiveCoachCue, PullUpSnapshot } from "./types.ts";

const cues = {
  noPose: {
    id: "frame-body",
    priority: 100,
    tone: "attention",
    title: "Frame your full body and bar",
    detail: "Keep both wrists, shoulders, and hips visible before you begin.",
  },
  setup: {
    id: "set-position",
    priority: 90,
    tone: "attention",
    title: "Set a stable hanging position",
    detail: "Keep both hands above the shoulders and your body under the bar.",
  },
  partial: {
    id: "finish-top",
    priority: 70,
    tone: "attention",
    title: "Finish higher before lowering",
    detail: "Bring your face to bar height, then return under control.",
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
): LiveCoachCue {
  const candidates: LiveCoachCue[] = [];

  if (!snapshot.poseReady) candidates.push(cues.noPose);
  if (snapshot.poseReady && !snapshot.setupReady) candidates.push(cues.setup);
  if (snapshot.latestRep?.outcome === "partial") candidates.push(cues.partial);
  if (snapshot.phase === "top") candidates.push(cues.top);
  if (snapshot.phase === "lowering") candidates.push(cues.lowering);
  if (snapshot.phase === "rising") candidates.push(cues.rising);
  if (snapshot.phase === "bottom") candidates.push(cues.ready);

  return candidates.sort((left, right) => right.priority - left.priority)[0] ?? cues.noPose;
}

