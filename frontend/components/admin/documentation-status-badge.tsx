import { Badge } from "@/components/ui/badge";
import type { DocumentationStatus } from "@/features/admin/documentation/types";

const labels: Record<DocumentationStatus, string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};

export function DocumentationStatusBadge({ status }: { status: DocumentationStatus }) {
  return (
    <Badge
      variant={status === "published" ? "default" : status === "draft" ? "secondary" : "outline"}
      className="capitalize"
    >
      {labels[status]}
    </Badge>
  );
}
