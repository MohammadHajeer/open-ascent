import { SavedPlanDetail } from "@/features/library/saved-plan-detail";

// The param is only a lookup key for client-side fetching. An empty list lets
// Next prerender each id on first visit and reuse it instead of rendering
// per request.
export function generateStaticParams() {
  return [];
}

export default async function LibraryPlanPage({ params }: { params: Promise<{ planId: string }> }) {
  const { planId } = await params;
  return <SavedPlanDetail planId={planId} />;
}
