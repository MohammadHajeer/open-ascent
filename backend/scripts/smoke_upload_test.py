from pathlib import Path

from app.core.config import settings
from app.core.supabase import supabase

BUCKET = settings.supabase_video_bucket

path = "analyses/2fe603de-4a06-463d-8474-78bc460a7a72/source.mp4"
token = "eyJraWQiOiIyNzkyNGI0ZS1lYjQyLTQxMGEtYjY5NS1jZDdjMjg2MzY4ZmIiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJhbmFseXNpcy12aWRlb3MvYW5hbHlzZXMvMmZlNjAzZGUtNGEwNi00NjNkLTg0NzQtNzhiYzQ2MGE3YTcyL3NvdXJjZS5tcDQiLCJ1cHNlcnQiOmZhbHNlLCJzY29wZSI6InVwbG9hZCIsImlhdCI6MTc4OTc0MzcwMCwiZXhwIjoxNzg5NzUwOTAwfQ.uibuLrlhUXmj97WNujMPybt9RAGyx3SIyh--q3Hn7WQ"

video = Path("scripts/smoke-test.mp4")

with video.open("rb") as file:
    response = supabase.storage.from_(BUCKET).upload_to_signed_url(
        path=path,
        token=token,
        file=file,
        file_options={
            "content-type": "video/mp4",
        },
    )

print(response)
