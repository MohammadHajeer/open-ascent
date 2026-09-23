import { AnalysisInspection } from "@/features/admin/management/views";

export default async function AdminAnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AnalysisInspection id={id} />;
}
