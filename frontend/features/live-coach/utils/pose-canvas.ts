import type { PoseLandmark } from "../types.ts";

const poseConnections = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
] as const;

export function drawPose(
  canvas: HTMLCanvasElement | null,
  video: HTMLVideoElement | null,
  landmarks: PoseLandmark[] | null,
) {
  if (!canvas || !video) return;
  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, width, height);
  if (!landmarks) return;

  context.lineWidth = Math.max(2, width / 420);
  context.strokeStyle = "#a7b28f";
  context.fillStyle = "#f5f0e8";

  for (const [startIndex, endIndex] of poseConnections) {
    const start = landmarks[startIndex];
    const end = landmarks[endIndex];
    if (!start || !end || (start.visibility ?? 1) < 0.5 || (end.visibility ?? 1) < 0.5) continue;
    context.beginPath();
    context.moveTo(start.x * width, start.y * height);
    context.lineTo(end.x * width, end.y * height);
    context.stroke();
  }

  for (const index of new Set(poseConnections.flat())) {
    const landmark = landmarks[index];
    if (!landmark || (landmark.visibility ?? 1) < 0.5) continue;
    context.beginPath();
    context.arc(
      landmark.x * width,
      landmark.y * height,
      Math.max(3, width / 300),
      0,
      Math.PI * 2,
    );
    context.fill();
  }
}

export function clearCanvas(canvas: HTMLCanvasElement | null) {
  const context = canvas?.getContext("2d");
  if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
}
