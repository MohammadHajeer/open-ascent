import styles from "./hero.module.css";

/** Page-level atmosphere behind the Hero; no interaction or accessibility-tree noise. */
export function HeroEnvironment() {
  return (
    <div className={styles.environment} aria-hidden="true">
      <div className={styles.grid} />
      <div className={styles.wash} />
      <div className={styles.vignette} />
    </div>
  );
}
