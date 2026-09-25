import Image from "next/image";
import { Sparkles } from "lucide-react";

import { assets } from "@/lib/assets";

import styles from "./analysis-stage.module.css";

const athlete = assets.hero.pullUpAthlete;

/*
  Every overlay shares the illustration's own 1024 × 1536 coordinate space, so
  landmarks stay pinned to the athlete at any rendered size. Illustrative only.
*/
const joints = {
  head: [512, 100],
  neck: [512, 238],
  leftShoulder: [394, 270],
  rightShoulder: [630, 270],
  leftElbow: [323, 401],
  rightElbow: [701, 401],
  leftWrist: [352, 220],
  rightWrist: [672, 220],
  leftHip: [452, 516],
  rightHip: [575, 516],
  leftKnee: [459, 793],
  rightKnee: [560, 793],
  leftAnkle: [480, 1018],
  rightAnkle: [546, 1018],
} as const;

type Joint = keyof typeof joints;

const bones: readonly [Joint, Joint][] = [
  ["head", "neck"],
  ["leftShoulder", "rightShoulder"],
  ["leftShoulder", "leftHip"],
  ["rightShoulder", "rightHip"],
  ["leftHip", "rightHip"],
  ["leftShoulder", "leftElbow"],
  ["rightShoulder", "rightElbow"],
  ["leftElbow", "leftWrist"],
  ["rightElbow", "rightWrist"],
  ["leftHip", "leftKnee"],
  ["rightHip", "rightKnee"],
  ["leftKnee", "leftAnkle"],
  ["rightKnee", "rightAnkle"],
];

// Tracked box around the athlete, drawn as camera-style corner brackets.
const box = { x1: 282, y1: 28, x2: 742, y2: 1150, arm: 46 };

const brackets = [
  `M ${box.x1} ${box.y1 + box.arm} V ${box.y1} H ${box.x1 + box.arm}`,
  `M ${box.x2 - box.arm} ${box.y1} H ${box.x2} V ${box.y1 + box.arm}`,
  `M ${box.x2} ${box.y2 - box.arm} V ${box.y2} H ${box.x2 - box.arm}`,
  `M ${box.x1 + box.arm} ${box.y2} H ${box.x1} V ${box.y2 - box.arm}`,
];

const dialTicks = Array.from({ length: 72 }, (_, index) => {
  const angle = (index * 5 * Math.PI) / 180;
  const major = index % 6 === 0;
  const inner = major ? 536 : 546;
  const round = (value: number) => Math.round(value * 10) / 10;

  return {
    major,
    d: `M ${round(512 + inner * Math.cos(angle))} ${round(560 + inner * Math.sin(angle))} L ${round(512 + 560 * Math.cos(angle))} ${round(560 + 560 * Math.sin(angle))}`,
  };
});

const phases = ["Bottom", "Rising", "Top", "Lowering"] as const;

function PoseOverlay() {
  return (
    <svg
      className={styles.overlay}
      viewBox={`0 0 ${athlete.width} ${athlete.height}`}
      fill="none"
      focusable="false"
    >
      <g className={styles.brackets}>
        {brackets.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>

      <g className={styles.bones}>
        {bones.map(([from, to], index) => (
          <line
            key={`${from}-${to}`}
            x1={joints[from][0]}
            y1={joints[from][1]}
            x2={joints[to][0]}
            y2={joints[to][1]}
            pathLength={1}
            style={{ animationDelay: `${700 + index * 45}ms` }}
          />
        ))}
      </g>

      {/* Elbow angle at the top of the rep: wedge, arc, and a leader to the readout. */}
      <g className={styles.angle}>
        <path
          className={styles.angleWedge}
          d="M 701 401 L 676.2 355.3 A 52 52 0 0 1 692.8 349.7 Z"
        />
        <path d="M 676.2 355.3 A 52 52 0 0 1 692.8 349.7" />
        <path className={styles.leader} d="M 716 420 L 792 506 H 812" />
      </g>

      <g className={styles.pulse}>
        <circle cx={joints.rightElbow[0]} cy={joints.rightElbow[1]} r="30" />
      </g>

      <g className={styles.joints}>
        {Object.entries(joints).map(([name, [cx, cy]], index) => (
          <circle
            key={name}
            cx={cx}
            cy={cy}
            r={name === "rightElbow" ? 12 : 9}
            className={name === "rightElbow" ? styles.trackedJoint : undefined}
            style={{ animationDelay: `${1100 + index * 40}ms` }}
          />
        ))}
      </g>
    </svg>
  );
}

function RepScrubber() {
  return (
    <div className={styles.scrubber}>
      <div className={styles.scrubberHead}>
        <span>Rep path</span>
        <span className={styles.scrubberPhase}>Top</span>
      </div>

      <svg
        className={styles.trace}
        viewBox="0 0 240 44"
        preserveAspectRatio="none"
        fill="none"
        focusable="false"
      >
        <path className={styles.traceBase} d="M 0 43.5 H 240" />
        <path
          className={styles.traceLine}
          pathLength={1}
          d="M 0 38 C 24 38 42 38 60 30 S 96 6 120 6 S 156 10 180 26 S 216 38 240 38"
        />
        <path className={styles.playhead} d="M 132 0 V 44" />
        <circle className={styles.playheadDot} cx="132" cy="6.6" r="3.2" />
      </svg>

      <ol className={styles.phases}>
        {phases.map((phase) => (
          <li key={phase} data-active={phase === "Top" || undefined}>
            {phase}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function AnalysisStage() {
  return (
    <div
      className={styles.stage}
      role="img"
      aria-label="Illustrative pull-up analysis: an athlete at the top of a rep with pose landmarks, a 41° elbow angle, the rep path by phase, and an AI coach cue to lower with control."
    >
      <div className={styles.lighting} />

      <div className={styles.rig}>
        <svg
          className={styles.dial}
          viewBox={`0 0 ${athlete.width} ${athlete.height}`}
          fill="none"
          focusable="false"
        >
          <circle cx="512" cy="560" r="560" className={styles.dialRing} />
          <circle cx="512" cy="560" r="472" className={styles.dialInner} />
          <g className={styles.dialTicks}>
            {dialTicks.map(({ d, major }) => (
              <path key={d} d={d} className={major ? styles.dialMajor : undefined} />
            ))}
          </g>
          <path
            className={styles.dialArc}
            pathLength={1}
            d="M 27 280 A 560 560 0 0 1 997 280"
          />
        </svg>

        <div className={styles.floor} />

        <Image
          src={athlete.src}
          width={athlete.width}
          height={athlete.height}
          alt=""
          preload
          sizes="(min-width: 1024px) 520px, (min-width: 640px) 420px, 92vw"
          className={styles.athlete}
        />

        <div className={styles.scan}>
          <span />
        </div>

        <PoseOverlay />

        <div className={styles.hudTop}>
          <span className={styles.hudLive}>
            <i /> Tracking · Pull-up
          </span>
          <span>Rep 04</span>
        </div>

        <div className={styles.readout}>
          <span>Elbow</span>
          <strong>41°</strong>
        </div>

        <RepScrubber />
      </div>

      <div className={styles.cue}>
        <div className={styles.cueHead}>
          <span className={styles.cueIcon}>
            <Sparkles className="size-3.5" />
          </span>
          <span>AI coach</span>
          <span className={styles.cueTime}>Rep 04</span>
        </div>
        <p>Chin cleared the bar. Now lower slowly and stay in control to the bottom.</p>
      </div>
    </div>
  );
}
