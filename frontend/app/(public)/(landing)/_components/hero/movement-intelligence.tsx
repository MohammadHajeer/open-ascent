import { ArrowRight, Check, ScanLine } from "lucide-react";

import { CanvasTrajectories } from "./hero-environment";

import styles from "./movement-intelligence.module.css";

// Illustrative joint trajectories, not a measurement or a specific exercise.
const trajectories = [
  "M 32 232 C 106 234 108 88 206 76 S 340 166 404 178 S 488 142 528 100",
  "M 32 250 C 106 250 120 132 212 130 S 336 230 404 228 S 487 182 528 148",
  "M 32 268 C 112 270 132 194 218 188 S 328 278 404 278 S 490 232 528 196",
];

const samples = [
  [[76.6, 210.2], [78.4, 231.5], [82.7, 257.2]],
  [[131.2, 125.8], [138.1, 164.7], [146.6, 213.7]],
  [[206, 76], [212, 130], [218, 188]],
  [[317.8, 118], [317, 179], [314.8, 230.8]],
  [[490.6, 143.5], [491.1, 185.1], [494.4, 235.1]],
];

function MotionTrajectories() {
  return (
    <svg className={styles.trajectories} viewBox="0 0 560 340" fill="none" aria-hidden="true" focusable="false">
      <g className={styles.guides}>
        {[76, 130, 184, 238, 292].map((y) => <path key={y} d={`M 20 ${y} H 540`} />)}
        {[72, 144, 216, 288, 360, 432, 504].map((x) => <path key={x} d={`M ${x} 40 V 310`} />)}
      </g>
      <path className={styles.envelope} d={`${trajectories[0]} L 528 196 C 490 232 480 278 404 278 S 304 182 218 188 S 112 270 32 268 Z`} />
      <g className={styles.connections}>
        {samples.map((points, index) => <polyline key={index} points={points.map((point) => point.join(",")).join(" ")} />)}
      </g>
      {trajectories.map((path, index) => (
        <path key={path} d={path} className={styles.trail} style={{ opacity: 1 - index * 0.22 }} />
      ))}
      <g className={styles.sampleNodes}>
        {samples.flatMap((points, index) => points.map(([x, y], node) => (
          <circle key={`${index}-${node}`} cx={x} cy={y} r="3.5" />
        )))}
      </g>
      <g className={styles.activeFrame}>
        <path className={styles.frameGuide} d="M 404 58 V 310" />
        <path className={styles.frameConnection} d="M 404 178 V 278" />
        {[178, 228, 278].map((y) => (
          <g key={y}>
            <circle className={styles.nodeHalo} cx="404" cy={y} r="12" />
            <circle className={styles.activeNode} cx="404" cy={y} r="5" />
          </g>
        ))}
        <path d="M 400 307 L 404 311 L 408 307" className={styles.frameConnection} />
      </g>
      <g className={styles.axisTicks}>
        {Array.from({ length: 35 }, (_, index) => (
          <path key={index} d={`M ${25 + index * 15} 325 v ${index % 5 === 0 ? 7 : 3}`} />
        ))}
      </g>
    </svg>
  );
}

export function PhaseTimeline() {
  return (
    <div className={styles.phaseSection}>
      <div className={styles.sectionLabel}>
        <span>Phase-aware tracking</span>
        <span className={styles.phaseDetail}>One complete cycle</span>
      </div>
      <ol className={styles.phases} aria-label="Illustrative movement phases">
        {["Prepare", "Engage", "Peak", "Return"].map((phase, index) => (
          <li key={phase} className={index === 3 ? styles.selectedPhase : undefined}>
            <span className={styles.phaseBar} aria-hidden="true" />
            <span>{phase}</span>
            {index === 3 && <span className="sr-only">, highlighted phase</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function MovementIntelligence() {
  return (
    <figure className={styles.visual} aria-label="Illustrative movement analysis: joint tracking, phases, movement quality, and coaching feedback">
      <header className={styles.header}>
        <div className={styles.identity}><ScanLine size={15} aria-hidden="true" /> Movement intelligence</div>
        <span className={styles.previewLabel}>Illustrative view</span>
      </header>
      <div className={styles.plot}>
        <div className={styles.plotHeading}>
          <h2>Every phase. A clearer picture.</h2>
          <p>Joint trajectories, understood together.</p>
        </div>
        <div className={styles.plotLabels} aria-hidden="true">
          <span><i /> Connected motion paths</span>
          <span>Time <ArrowRight size={12} /></span>
        </div>
        <CanvasTrajectories />
        <MotionTrajectories />
      </div>

      <dl className={styles.metrics}>
        {[
          { label: "Control", value: "Smooth", signal: styles.controlSignal },
          { label: "Range", value: "Full", signal: styles.rangeSignal },
          { label: "Tempo", value: "Steady", signal: styles.tempoSignal },
        ].map(({ label, value, signal }) => (
          <div key={label} className={styles.metric}>
            <dt>{label}</dt>
            <dd>{value}<span className={signal} aria-hidden="true"><i /><i /><i /><i /><i /></span></dd>
          </div>
        ))}
      </dl>

    </figure>
  );
}

export function TechniqueFeedback() {
  return (
      <div className={styles.feedback}>
        <span className={styles.feedbackIcon}><Check size={15} aria-hidden="true" /></span>
        <div><span className={styles.feedbackLabel}>Technique feedback</span><p>Keep control through the return.</p></div>
        <ArrowRight className={styles.feedbackArrow} size={17} aria-hidden="true" />
      </div>
  );
}
