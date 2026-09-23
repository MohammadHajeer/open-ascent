import { PlanInspection } from "@/features/admin/management/views";

export default async function AdminPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PlanInspection id={id} />;
}
