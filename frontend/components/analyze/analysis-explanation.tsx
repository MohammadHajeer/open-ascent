"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";

import {
  getGuestResult,
  retryGuestExplanation,
  type GuestAccess,
  type GuestResult,
} from "@/lib/analysis";
import { streamGuestAnalysis } from "@/lib/analysis-stream";

export function AnalysisExplanationPanel({
  initial,
  access,
}: {
  initial: GuestResult;
  access: GuestAccess | null;
}) {
  const [current, setCurrent] = useState(initial);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState(false);
  const cursor = useRef(0);
  const activeStatus = current.explanation_status;
  const watching = activeStatus === "pending" || activeStatus === "running";

  useEffect(() => {
    if (!access || !watching) return;
    let active = true;
    const controller = new AbortController();

    async function refresh() {
      const latest = await getGuestResult(access!);
      if (active) setCurrent(latest);
      return latest;
    }

    async function observe() {
      let failures = 0;
      while (active) {
        try {
          await streamGuestAnalysis(
            access!,
            cursor.current,
            controller.signal,
            async (event) => {
              if (event.id !== null)
                cursor.current = Math.max(cursor.current, event.id);
              if (
                event.type === "explanation_started" ||
                event.type === "explanation_ready" ||
                event.type === "explanation_failed" ||
                event.type === "state"
              ) {
                await refresh();
              }
            },
          );
          if (!active) return;
          const latest = await refresh();
          if (
            ["completed", "failed", "skipped"].includes(
              latest.explanation_status,
            )
          )
            return;
          throw new Error("Explanation stream disconnected.");
        } catch {
          if (!active || controller.signal.aborted) return;
          failures += 1;
          try {
            const latest = await refresh();
            if (
              ["completed", "failed", "skipped"].includes(
                latest.explanation_status,
              )
            )
              return;
          } catch {
            // The result remains visible while the live connection recovers.
          }
          await new Promise((resolve) =>
            setTimeout(
              resolve,
              Math.min(1000 * 2 ** Math.min(failures - 1, 3), 8000),
            ),
          );
        }
      }
    }

    void observe();
    return () => {
      active = false;
      controller.abort();
    };
  }, [access, watching]);

  async function retry() {
    if (!access || retrying || !current.explanation_retry_available) return;
    setRetrying(true);
    setRetryError(false);
    try {
      const queued = await retryGuestExplanation(access);
      setCurrent((previous) => ({
        ...previous,
        explanation_status: queued.explanation_status,
        explanation: null,
        explanation_retry_available: false,
      }));
    } catch {
      setRetryError(true);
      try {
        setCurrent(await getGuestResult(access));
      } catch {
        // Keep the completed deterministic result visible.
      }
    } finally {
      setRetrying(false);
    }
  }

  const content = current.explanation;
  return (
    <section
      className="mt-8 rounded-[3px_3px_34px_3px] border border-border bg-card p-6 sm:p-9"
      aria-labelledby="ai-explanation-title"
    >
      <span className="font-mono text-[0.58rem] font-semibold tracking-widest text-primary uppercase">
        AI explanation
      </span>
      <h3
        id="ai-explanation-title"
        className="mt-3 text-3xl font-medium tracking-tighter"
      >
        What the analysis means.
      </h3>
      {activeStatus === "completed" && content ? (
        <div className="mt-6 space-y-6 text-sm leading-6 text-foreground-soft">
          <p className="text-base text-foreground">{content.summary.text}</p>
          {content.key_findings.length > 0 && (
            <div>
              <h4 className="font-semibold text-foreground">Key findings</h4>
              <ul className="mt-2 list-disc space-y-2 pl-5">
                {content.key_findings.map((finding, index) => (
                  <li key={index}>{finding.text}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <h4 className="font-semibold text-foreground">Next set focus</h4>
            <p className="mt-2">{content.next_set_focus.text}</p>
          </div>
          {content.safety_note && (
            <div>
              <h4 className="font-semibold text-foreground">
                Published safety guidance
              </h4>
              <p className="mt-2">{content.safety_note.text}</p>
            </div>
          )}
        </div>
      ) : activeStatus === "pending" || activeStatus === "running" ? (
        <p
          className="mt-6 flex items-center gap-2 text-sm text-foreground-soft"
          role="status"
        >
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          Preparing explanation…
        </p>
      ) : (
        <div className="mt-6 space-y-3 text-sm text-foreground-soft">
          <p role="status">
            Explanation unavailable. Your analysis findings and safety guidance
            remain above.
          </p>
          {activeStatus === "failed" && current.explanation_retry_available && access && (
            <button
              type="button"
              onClick={() => void retry()}
              disabled={retrying}
              className="rounded-md border border-border px-4 py-2 font-medium text-foreground hover:bg-muted disabled:opacity-50"
            >
              {retrying ? "Preparing explanation…" : "Try explanation again"}
            </button>
          )}
          {retryError && (
            <p role="alert">Could not start the explanation. Please try again.</p>
          )}
        </div>
      )}
    </section>
  );
}
