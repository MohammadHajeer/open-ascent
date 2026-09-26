import { AdminDocumentationDetailClient } from "@/components/admin/admin-documentation-detail-client";

type AdminDocumentationDetailPageProps = {
  params: Promise<{ id: string }>;
};

// The param is only a lookup key for client-side fetching. An empty list lets
// Next prerender each id on first visit and reuse it instead of rendering
// per request.
export function generateStaticParams() {
  return [];
}

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
