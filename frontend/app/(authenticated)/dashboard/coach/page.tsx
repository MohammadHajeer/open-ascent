import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { ThemedAsset } from "@/components/shared/themed-asset";
import { assets } from "@/lib/assets";

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
          title="Your coaching space is not active yet."
          description="There are no conversations to display. Coaching will appear here when the experience is ready."
          visual={
            <ThemedAsset
              asset={assets.emptyStates.noCoachConversations}
              alt=""
              width={176}
            />
          }
        />
      </DashboardSection>
    </div>
  );
}
