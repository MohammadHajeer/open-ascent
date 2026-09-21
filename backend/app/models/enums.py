from enum import StrEnum


class AppRole(StrEnum):
    ATHLETE = "athlete"
    ADMIN = "admin"


class DocumentationStatus(StrEnum):
    DRAFT = "draft"
    PUBLISHED = "published"
    ARCHIVED = "archived"


class AnalysisOwnerKind(StrEnum):
    GUEST = "guest"
    AUTHENTICATED = "authenticated"


class AnalysisStatus(StrEnum):
    RESERVED = "reserved"
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    EXPIRED = "expired"


class AIFeedbackStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


class WorkoutSource(StrEnum):
    MANUAL = "manual"
    SELF_REPORTED = "self_reported"
    UPLOADED_ANALYSIS = "uploaded_analysis"
    LIVE_COACH = "live_coach"


class MessageRole(StrEnum):
    USER = "user"
    ASSISTANT = "assistant"


class MessageStatus(StrEnum):
    STREAMING = "streaming"
    COMPLETED = "completed"
    FAILED = "failed"
    INTERRUPTED = "interrupted"


class AIRunStatus(StrEnum):
    RESERVED = "reserved"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    INTERRUPTED = "interrupted"


class PlanCode(StrEnum):
    FREE = "free"
    PRO = "pro"


class FeatureKey(StrEnum):
    VIDEO_ANALYSIS = "video_analysis"
    TRAINING_PLAN_GENERATION = "training_plan_generation"
    AI_COACH_REPLY = "ai_coach_reply"
    LIVE_COACH = "live_coach"
    ADAPTIVE_TRAINING_PLANS = "adaptive_training_plans"
    ADVANCED_PROGRESS_INSIGHTS = "advanced_progress_insights"


class EntitlementType(StrEnum):
    BOOLEAN = "boolean"
    METERED = "metered"
    UNLIMITED = "unlimited"


class ResetPolicy(StrEnum):
    CALENDAR_MONTH_UTC = "calendar_month_utc"


class FeatureUsageStatus(StrEnum):
    RESERVED = "reserved"
    CONSUMED = "consumed"
    RELEASED = "released"
