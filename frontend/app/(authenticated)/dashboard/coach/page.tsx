import { Bot } from "lucide-react";

import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { DashboardSection } from "@/components/dashboard/dashboard-section";

export default function CoachPage() {
  return (
    <div className="space-y-8">
      <DashboardPageHeader
        eyebrow="Athlete guidance"
        title="AI Coach"
        description="A future coaching space for grounded, personalized guidance built from your athlete context and movement analysis."
      />

      <DashboardSection
        eyebrow="Coming next"
        title="Personalized coaching will live here."
        description="The coach will use your context and grounded analysis to help turn observations into useful next steps."
      >
        <DashboardEmptyState
          icon={<Bot className="size-5" aria-hidden="true" />}
          title="Your coaching space is not active yet."
          description="There are no conversations to display. Coaching will appear here when the experience is ready."
        />
      </DashboardSection>
    </div>
  );
}
