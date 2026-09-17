from app.core.config import settings
from supabase import Client, create_client

supabase: Client = create_client(
    settings.supabase_url,
    settings.supabase_service_role_key,
)
