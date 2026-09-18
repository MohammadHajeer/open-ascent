import { Suspense } from "react";
import {
  Hero,
  Principle,
  HowItWorks,
  ExerciseShowcase,
  MovementAnalysis,
  MovementAnalysisSkeleton,
  CoachingModes,
  Difference,
  FinalCTA,
} from "./_components";

export default function Home() {
  return (
    <>
      <Hero />

      <Principle />

      <HowItWorks />

      <ExerciseShowcase />

      <Suspense fallback={<MovementAnalysisSkeleton />}>
        <MovementAnalysis />
      </Suspense>

      <CoachingModes />

      <Difference />

      <FinalCTA />
    </>
  );
}
