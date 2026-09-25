export type Capability = {
  movement_slug?: string;
  value?: number;
  source?: string;
  confidence?: string;
};

export type AthleteProfile = {
  display_name: string;
  context: {
    athlete_reported_profile?: {
      primary_goal?: string;
      equipment?: string[];
      availability?: { days_per_week?: number; minutes_per_session?: number };
      starting_training_experience?: string;
      starting_self_reported_clean_rep_max?: Record<string, number>;
    };
    athlete_state?: {
      overall_level?: string;
      overall_source?: string;
      current_capabilities?: Capability[];
    };
  };
};
