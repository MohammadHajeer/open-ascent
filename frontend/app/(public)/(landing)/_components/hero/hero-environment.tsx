import styles from "./hero.module.css";

/** A shared field with no interaction or accessibility-tree noise. */
export function HeroEnvironment() {
  return (
    <div className={styles.environment} aria-hidden="true">
      <div className={styles.grid} />
      <div className={styles.illumination} />
    </div>
  );
}

// The same three joint paths expand across the canvas; copy occupies the quiet region.
const motionPaths = [
  "M -80 608 C 180 608 330 662 520 570 S 695 398 780 274 C 865 150 945 172 1040 265 S 1260 450 1510 145",
  "M -80 648 C 180 648 330 702 520 610 S 695 448 780 324 C 865 200 945 232 1040 325 S 1260 510 1510 205",
  "M -80 688 C 180 688 330 742 520 650 S 695 498 780 374 C 865 250 945 292 1040 385 S 1260 570 1510 265",
];

export function CanvasTrajectories() {
  return (
    <svg className={styles.motionField} viewBox="0 -24 1440 764" preserveAspectRatio="none" fill="none" aria-hidden="true" focusable="false">
      <g className={styles.coordinateGuides}>
        <path d="M 0 220 H 1440 M 0 400 H 1440 M 0 580 H 1440" />
        <path d="M 780 105 V 645 M 1040 105 V 645 M 1280 105 V 645" />
      </g>
      {motionPaths.map((path, index) => (
        <path key={path} d={path} className={styles.fieldPath} style={{ opacity: 1 - index * 0.23 }} />
      ))}
      <g className={styles.jointConnections}>
        <path d="M 520 570 V 650 M 780 274 V 374 M 1040 265 V 385" />
      </g>
      <g className={styles.fieldNodes}>
        {[570, 610, 650].map((y) => <circle key={y} cx="520" cy={y} r="3" />)}
        {[274, 324, 374].map((y) => <circle key={y} cx="780" cy={y} r="4" />)}
      </g>
      <g className={styles.trackedFrame}>
        <path d="M 1040 170 V 500" strokeDasharray="3 7" />
        {[265, 325, 385].map((y) => (
          <g key={y}>
            <circle className={styles.trackedHalo} cx="1040" cy={y} r="12" />
            <circle className={styles.trackedNode} cx="1040" cy={y} r="5" />
          </g>
        ))}
      </g>
      <g className={styles.fieldTicks}>
        {Array.from({ length: 59 }, (_, index) => (
          <path key={index} d={`M ${12 + index * 24} 708 v ${index % 6 === 0 ? 8 : 3}`} />
        ))}
      </g>
    </svg>
  );
}
