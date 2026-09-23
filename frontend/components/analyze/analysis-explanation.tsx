"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";

import { ThemedAsset } from "@/components/shared/themed-asset";
import {
  fetchAuthenticatedAnalysisResult,
  streamAuthenticatedAnalysis,
} from "@/features/analysis/api";
import type { AuthenticatedAnalysisAccess } from "@/features/analysis/types";
import { assets } from "@/lib/assets";
import {
  getGuestResult,
  type GuestAccess,
  type GuestResult,
  type GroundedText,
} from "@/lib/analysis";
import {
  streamGuestAnalysis,
  type AnalysisProgressEvent,
} from "@/lib/analysis-stream";

function FindingGroup({
  title,
  items,
}: {
  title: string;
  items: GroundedText[];
}) {
  if (!items.length) return null;
  return (
    <div>
      <h4 className="font-semibold text-foreground">{title}</h4>
      <ul className="mt-3 space-y-3">
        {items.map((finding, index) => (
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
  );
}

export function AnalysisExplanationPanel({
  initial,
  access,
  authenticated = false,
}: {
  initial: GuestResult;
  access: GuestAccess | AuthenticatedAnalysisAccess | null;
  authenticated?: boolean;
}) {
  const [current, setCurrent] = useState(initial);
  const cursor = useRef(0);
  const activeStatus = current.explanation_status;
  const watching = activeStatus === "pending" || activeStatus === "running";

  useEffect(() => {
    if (!access || !watching) return;
    let active = true;
    const controller = new AbortController();

    async function refresh() {
      const latest = authenticated
        ? await fetchAuthenticatedAnalysisResult(access!.analysis_id)
        : await getGuestResult(access! as GuestAccess);
      if (active) setCurrent(latest);
      return latest;
    }

    async function observe() {
      let failures = 0;
      while (active) {
        try {
          const onEvent = async (event: AnalysisProgressEvent) => {
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
            };
          if (authenticated) {
            await streamAuthenticatedAnalysis(
              access!.analysis_id,
              cursor.current,
              controller.signal,
              onEvent,
            );
          } else {
            await streamGuestAnalysis(
              access! as GuestAccess,
              cursor.current,
              controller.signal,
              onEvent,
            );
          }
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
  }, [access, watching, authenticated]);

  const content = current.explanation;
  const grouped = content
    ? {
        positives: content.key_findings.filter((item) =>
          item.evidence.some((id) => id.startsWith("set:positive:")),
        ),
        technique: content.key_findings.filter((item) =>
          item.evidence.some(
            (id) =>
              id.startsWith("set:technique:") ||
              id.startsWith("set:deterioration:"),
          ),
        ),
        target: content.key_findings.filter((item) =>
          item.evidence.some(
            (id) => id.includes("target_") || id === "set:target_relation",
          ),
        ),
        tempo: content.key_findings.filter((item) =>
          item.evidence.some((id) => id === "set:tempo"),
        ),
      }
    : null;
  const categorized = new Set(
    grouped
      ? [
          ...grouped.positives,
          ...grouped.technique,
          ...grouped.target,
          ...grouped.tempo,
        ]
      : [],
  );
  const otherFindings = content?.key_findings.filter(
    (item) => !categorized.has(item),
  );

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
            <FindingGroup title="What went well" items={grouped?.positives ?? []} />
            <FindingGroup title="Technique findings" items={grouped?.technique ?? []} />
            <FindingGroup title="Target / variation consistency" items={grouped?.target ?? []} />
            <FindingGroup title="Tempo / control" items={grouped?.tempo ?? []} />
            <FindingGroup title="Other grounded findings" items={otherFindings ?? []} />
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
        </div>
      )}
    </section>
  );
}
