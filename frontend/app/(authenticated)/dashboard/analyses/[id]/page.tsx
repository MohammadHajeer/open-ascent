import { AuthenticatedAnalysisDetail } from "@/features/analysis/analysis-detail";

export default async function AnalysisDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AuthenticatedAnalysisDetail id={id} />;
}
