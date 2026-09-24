import { LiveCoachSessionError } from "../camera-session.ts";

export function normalizeSessionError(error: unknown) {
  return error instanceof LiveCoachSessionError
    ? error
    : new LiveCoachSessionError("camera", "The session could not start.", {
        cause: error,
      });
}

export function sessionErrorMessage(error: LiveCoachSessionError) {
  const cause = error.cause;
  const name = cause instanceof DOMException ? cause.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera permission was denied. Allow camera access in browser settings, then restart the session.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No camera is available. Connect or enable a camera, then restart the session.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "The camera is busy or could not be initialized. Close other camera apps and try again.";
  }
  if (error.stage === "mediapipe") {
    return "The local pose model could not initialize. Check the connection used to download the static model files and try again.";
  }
  if (error.stage === "inference") {
    return "Local pose inference stopped. The camera has been released; restart the session to try again.";
  }
  return "The camera could not start. Check browser permission and device availability, then try again.";
}
