"use client";

import { CameraPreview } from "./components/camera-preview";
import { SessionDetails } from "./components/session-details";
import { SessionPanel } from "./components/session-panel";
import { useFocusMode } from "./hooks/use-focus-mode";
import { useLiveCoachSession } from "./hooks/use-live-coach-session";

export function LiveCoachWorkspace() {
  const session = useLiveCoachSession();
  const focus = useFocusMode();

  return (
    <div className="space-y-5 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-0">
      <section className="scroll-mt-24 overflow-clip rounded-[1.6rem] border border-border bg-card/70">
        <div className="grid lg:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.7fr)]">
          <CameraPreview session={session} focus={focus} />
          <SessionPanel session={session} />
        </div>
      </section>
      <SessionDetails session={session} />
    </div>
  );
}
