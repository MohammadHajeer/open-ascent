"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";

type Box = { top: number; left: number; width: number; height: number };

export function Spotlight({
  target,
  title,
  description,
  progress,
  onBack,
  onNext,
  onExit,
  nextLabel = "Next",
  onMissing,
}: {
  target: string;
  title: string;
  description: string;
  progress: string;
  onBack?: () => void;
  onNext: () => void;
  onExit: () => void;
  nextLabel?: string;
  onMissing?: () => void;
}) {
  const [box, setBox] = useState<Box | null>(null);
  const [card, setCard] = useState({ top: 0, left: 0 });
  const cardRef = useRef<HTMLDivElement>(null);
  const updateRef = useRef<() => void>(() => {});
  const previousFocus = useRef<HTMLElement | null>(null);
  const ready = box !== null;

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    return () => previousFocus.current?.focus();
  }, []);

  useEffect(() => { if (ready) cardRef.current?.focus(); }, [ready]);

  useEffect(() => {
    if (!ready || !cardRef.current) return;
    const observer = new ResizeObserver(() => updateRef.current());
    observer.observe(cardRef.current);
    updateRef.current();
    return () => observer.disconnect();
  }, [ready]);

  useEffect(() => {
    let frame = 0;
    let found = false;
    let missingTimer = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const element = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
        if (!element) {
          setBox(null);
          if (found && !missingTimer) missingTimer = window.setTimeout(() => onMissing?.(), 3000);
          return;
        }
        if (missingTimer) { window.clearTimeout(missingTimer); missingTimer = 0; }
        if (!found) element.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
        found = true;
        const rect = element.getBoundingClientRect();
        const gap = 8;
        const top = Math.max(8, rect.top - gap);
        const left = Math.max(8, rect.left - gap);
        const width = Math.min(window.innerWidth - left - 8, rect.width + gap * 2);
        const height = Math.min(window.innerHeight - top - 8, rect.height + gap * 2);
        setBox({ top, left, width, height });
        const cardWidth = Math.min(360, window.innerWidth - 24);
        const cardHeight = cardRef.current?.getBoundingClientRect().height ?? 230;
        const below = rect.bottom + 18;
        const above = rect.top - cardHeight - 18;
        const cardTop = below + cardHeight + 12 <= window.innerHeight ? below : above;
        setCard({ top: Math.max(12, Math.min(cardTop, window.innerHeight - cardHeight - 12)), left: Math.max(12, Math.min(rect.left, window.innerWidth - cardWidth - 12)) });
      });
    };
    updateRef.current = update;
    const observer = new MutationObserver(update);
    observer.observe(document.body, { subtree: true, childList: true });
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    update();
    const timeout = window.setTimeout(() => { if (!found) onMissing?.(); }, 5000);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.clearTimeout(timeout);
      if (missingTimer) window.clearTimeout(missingTimer);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [target, onMissing]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onExit(); }
      if (event.key !== "Tab" || !cardRef.current) return;
      const controls = Array.from(cardRef.current.querySelectorAll<HTMLElement>("button:not([disabled])"));
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onExit]);

  if (!box) return null;
  const right = box.left + box.width;
  const bottom = box.top + box.height;
  const mask = [
    { top: 0, left: 0, width: "100%", height: box.top },
    { top: bottom, left: 0, width: "100%", height: `calc(100% - ${bottom}px)` },
    { top: box.top, left: 0, width: box.left, height: box.height },
    { top: box.top, left: right, width: `calc(100% - ${right}px)`, height: box.height },
  ];
  return createPortal(
    <div className="fixed inset-0 z-[100]" aria-label="Guided tour">
      {mask.map((style, index) => <div key={index} className="fixed bg-black/65 transition-all duration-200 motion-reduce:transition-none" style={style} />)}
      <div className="pointer-events-none fixed rounded-xl ring-2 ring-primary ring-offset-4 ring-offset-transparent transition-all duration-200 motion-reduce:transition-none" style={box} aria-hidden="true" />
      <div ref={cardRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-description" className="fixed z-[101] max-h-[calc(100dvh-24px)] w-[min(360px,calc(100vw-24px))] overflow-y-auto rounded-2xl border border-border bg-card p-5 text-foreground shadow-2xl outline-none sm:p-6" style={card}>
        <p className="font-mono text-[0.6rem] font-semibold uppercase tracking-widest text-primary">{progress}</p>
        <h2 id="tour-title" className="mt-3 text-xl font-semibold tracking-tight">{title}</h2>
        <p id="tour-description" className="mt-2 text-sm leading-6 text-foreground-soft">{description}</p>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          {onBack && <Button type="button" variant="outline" onClick={onBack}>Back</Button>}
          <Button type="button" variant="brand" onClick={onNext}>{nextLabel}</Button>
          <Button type="button" variant="ghost" className="ml-auto" onClick={onExit}>Exit tour</Button>
        </div>
      </div>
    </div>, document.body,
  );
}
