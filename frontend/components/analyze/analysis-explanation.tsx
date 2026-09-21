"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";

import { ThemedAsset } from "@/components/shared/themed-asset";
import { assets } from "@/lib/assets";
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
      className="mt-8 min-h-80 overflow-hidden rounded-[3px_3px_34px_3px] border border-primary/30 bg-card"
      aria-labelledby="ai-explanation-title"
      aria-live="polite"
    >
      <div className="border-b border-border bg-primary-light/55 px-6 py-5 sm:px-9">
        <span className="font-mono text-[0.58rem] font-semibold tracking-widest text-primary uppercase">
          AI explanation
        </span>
        <h3
          id="ai-explanation-title"
          className="mt-2 text-3xl font-medium tracking-tighter"
        >
          What the analysis means.
        </h3>
      </div>
      {activeStatus === "completed" && content ? (
        <div className="grid gap-7 p-6 text-sm leading-6 text-foreground-soft sm:p-9 lg:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.9fr)] lg:gap-10">
          <div>
            <p className="text-base leading-7 text-foreground">
              {content.summary.text}
            </p>
            {content.uncertainty_note && (
              <aside className="mt-6 rounded-2xl border border-primary/20 bg-primary-light/65 p-5">
                <span className="font-mono text-[0.55rem] font-semibold tracking-widest text-primary uppercase">
                  Understanding uncertainty
                </span>
                <p className="mt-2 leading-6 text-foreground-mid">
                  {content.uncertainty_note.text}
                </p>
              </aside>
            )}
          </div>
          <div className="space-y-6 lg:border-l lg:border-border lg:pl-10">
            {content.key_findings.length > 0 && (
              <div>
                <h4 className="font-semibold text-foreground">Key findings</h4>
                <ul className="mt-3 space-y-3">
                  {content.key_findings.map((finding, index) => (
                    <li key={index} className="flex gap-3">
                      <span
                        className="mt-2 size-1.5 shrink-0 rounded-full bg-primary"
                        aria-hidden="true"
                      />
                      <span>{finding.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="border-t border-border pt-5">
              <h4 className="font-semibold text-foreground">Next set focus</h4>
              <p className="mt-2">{content.next_set_focus.text}</p>
            </div>
            {content.safety_note && (
              <div className="border-t border-border pt-5">
                <h4 className="font-semibold text-foreground">
                  Published safety guidance
                </h4>
                <p className="mt-2">{content.safety_note.text}</p>
              </div>
            )}
          </div>
        </div>
      ) : activeStatus === "pending" || activeStatus === "running" ? (
        <div className="grid min-h-60 items-center gap-5 p-6 sm:grid-cols-[minmax(0,260px)_1fr] sm:p-9">
          <ThemedAsset
            asset={assets.analysis.processing}
            alt=""
            width={240}
            className="opacity-80"
          />
          <div role="status">
            <div className="flex items-center gap-2 text-foreground">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              <span className="font-semibold">Building your interpretation</span>
            </div>
            <p className="mt-3 max-w-lg text-sm leading-6 text-foreground-soft">
              Preparing a grounded explanation from your analysis…
            </p>
          </div>
        </div>
      ) : (
        <div className="min-h-52 space-y-3 p-6 text-sm text-foreground-soft sm:p-9">
          <p role="status">
            Explanation unavailable. Your analysis findings and safety guidance
            remain available on this page.
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
