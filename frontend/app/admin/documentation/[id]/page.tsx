import { AdminDocumentationDetailClient } from "@/components/admin/admin-documentation-detail-client";

type AdminDocumentationDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function AdminDocumentationDetailPage({
  params,
}: AdminDocumentationDetailPageProps) {
  const { id } = await params;

  return (
    <div className="space-y-8">
      <AdminDocumentationDetailClient id={id} />
    </div>
  );
}
