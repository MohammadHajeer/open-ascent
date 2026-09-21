"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { MovementForm } from "@/components/admin/movement-form";
import { buttonVariants } from "@/components/ui/button";
import { useCreateAdminMovement } from "@/features/admin/movements/hooks";

export function AdminMovementCreateClient() {
  const router = useRouter();
  const createMovement = useCreateAdminMovement();

  async function handleSubmit(payload: Parameters<React.ComponentProps<typeof MovementForm>["onSubmit"]>[0]) {
    try {
      const movement = await createMovement.mutateAsync({
        ...payload,
        name: payload.name ?? "",
        slug: payload.slug ?? "",
        family_key: payload.family_key ?? "",
        upload_analysis_supported: payload.upload_analysis_supported ?? false,
        live_coach_supported: payload.live_coach_supported ?? false,
      });
      router.push(`/admin/movements/${encodeURIComponent(movement.slug)}`);
    } catch {
      // The mutation hook provides Sonner feedback; keep the form available for correction.
    }
  }

  return (
    <div className="space-y-5">
      <Link href="/admin/movements" className={buttonVariants({ variant: "outline" })}>
        <ArrowLeft className="size-4" aria-hidden="true" />
        All movements
      </Link>
      <DashboardSection eyebrow="New movement" title="Catalog definition" description="Create the movement record first. Documentation remains a separate draft and publishing workflow.">
        <MovementForm saving={createMovement.isPending} onSubmit={handleSubmit} />
        {createMovement.isError ? <p className="border-t border-destructive/20 bg-destructive/5 px-5 py-3 text-sm text-destructive sm:px-7">{createMovement.error instanceof Error ? createMovement.error.message : "The movement could not be created."}</p> : null}
      </DashboardSection>
    </div>
  );
}
