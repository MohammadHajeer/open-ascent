import { UserAccount } from "@/features/admin/management/views";

export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <UserAccount id={id} />;
}
