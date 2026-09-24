import { SavedPlanDetail } from "@/features/library/saved-plan-detail";

export default async function LibraryPlanPage({ params }: { params: Promise<{ planId: string }> }) {
  const { planId } = await params;
  return <SavedPlanDetail planId={planId} />;
}
