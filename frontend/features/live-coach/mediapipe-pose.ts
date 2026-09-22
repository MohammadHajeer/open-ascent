import type { PoseLandmarker } from "@mediapipe/tasks-vision";

import type { PoseLandmark } from "./types.ts";

const MEDIAPIPE_VERSION = "1.0.1";
const WASM_ROOT = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

export type PoseRuntime = {
  delegate: "GPU" | "CPU";
  detect(video: HTMLVideoElement, timestampMs: number): PoseLandmark[] | null;
  close(): void;
};

async function createLandmarker(delegate: "GPU" | "CPU") {
  const { FilesetResolver, PoseLandmarker } = await import(
    "@mediapipe/tasks-vision"
  );
  const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
  return PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputSegmentationMasks: false,
  });
}

export async function createMediaPipePoseRuntime(): Promise<PoseRuntime> {
  let landmarker: PoseLandmarker;
  let delegate: "GPU" | "CPU" = "GPU";

  try {
    landmarker = await createLandmarker("GPU");
  } catch {
    delegate = "CPU";
    landmarker = await createLandmarker("CPU");
  }

  return {
    delegate,
    detect(video, timestampMs) {
      const result = landmarker.detectForVideo(video, timestampMs);
      return result.landmarks[0] ?? null;
    },
    close() {
      landmarker.close();
    },
  };
}

export const MEDIAPIPE_STATIC_ASSETS = {
  packageVersion: MEDIAPIPE_VERSION,
  wasmRoot: WASM_ROOT,
  modelUrl: MODEL_URL,
} as const;
