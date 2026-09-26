import { AuthenticatedAnalysisDetail } from "@/features/analysis/analysis-detail";

// The param is only a lookup key for client-side fetching. An empty list lets
// Next prerender each id on first visit and reuse it instead of rendering
// per request.
export function generateStaticParams() {
  return [];
}

export default async function AnalysisDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AuthenticatedAnalysisDetail id={id} />;
}
