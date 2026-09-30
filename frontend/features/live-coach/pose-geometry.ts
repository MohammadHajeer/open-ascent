import type { PoseLandmark } from "./types.ts";

// MediaPipe normalizes x by frame width and y by frame height, so on a
// non-square frame the two axes have different scales and raw 2D angles
// depend on the camera's aspect ratio, not only on the body.

/**
 * Puts x on the same scale as y (frame-height units), so angles and
 * distances are true to the body. Used by the side-view analyzers.
 */
export function aspectCorrected<T extends PoseLandmark>(point: T, aspectRatio: number): T {
  return { ...point, x: point.x * aspectRatio };
}

/**
 * The frame Pull-Up's thresholds were calibrated in: a 16:9 landscape webcam,
 * with its elbow angles read on raw normalized coordinates (as the backend
 * Python analyzer also does).
 */
export const PULL_UP_REFERENCE_ASPECT_RATIO = 16 / 9;

/**
 * Re-expresses landmarks from any frame as if the same body had been filmed by
 * a 16:9 landscape camera whose height is this frame's short side. Phones
 * rotate one sensor crop, so the short side covers the same view in portrait
 * and landscape. A 16:9 landscape frame is returned unchanged, which keeps
 * Pull-Up's landscape-calibrated behavior exactly; every other aspect ratio
 * now reads the same angles and body-relative heights as that frame.
 */
export function toPullUpReferenceFrame(
  landmarks: readonly PoseLandmark[],
  aspectRatio: number,
): readonly PoseLandmark[] {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) return landmarks;
  // Source pixels per short side, in each normalized axis.
  const shortSideWidths = Math.max(1, aspectRatio);
  const shortSideHeights = Math.max(1, 1 / aspectRatio);
  const xScale = shortSideWidths / PULL_UP_REFERENCE_ASPECT_RATIO;
  const yScale = shortSideHeights;
  if (xScale === 1 && yScale === 1) return landmarks;
  return landmarks.map((point) => point && { ...point, x: point.x * xScale, y: point.y * yScale });
}
