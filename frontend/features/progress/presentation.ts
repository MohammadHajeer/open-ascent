import type { ProgressMetricSeries, ProgressMovement } from "./types.ts";

export function comparableMetric(
  movement: ProgressMovement | undefined,
): ProgressMetricSeries | undefined {
  return movement?.metrics.toSorted((left, right) => {
    const pointDifference = right.points.length - left.points.length;
    if (pointDifference !== 0) return pointDifference;
    return left.measurement === "reps" ? -1 : 1;
  })[0];
}

export function trendEmptyCopy(
  movementName: string,
  pointCount: number,
): { title: string; description: string } {
  if (pointCount === 1) {
    return {
      title: "One comparable set logged.",
      description: `Log another ${movementName} set to start seeing a trend.`,
    };
  }
  return {
    title: `No ${movementName} data yet.`,
    description: `Log a ${movementName} set to start building a comparable trend.`,
  };
}
