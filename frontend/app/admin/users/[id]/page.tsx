import { UserAccount } from "@/features/admin/management/views";

// The param is only a lookup key for client-side fetching. An empty list lets
// Next prerender each id on first visit and reuse it instead of rendering
// per request.
export function generateStaticParams() {
  return [];
}

export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <UserAccount id={id} />;
}
