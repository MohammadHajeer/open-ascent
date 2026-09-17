import uuid
from pathlib import Path

import httpx
from supabase import create_client

from app.core.config import settings

BUCKET = settings.supabase_video_bucket
OBJECT_PATH = f"smoke-tests/{uuid.uuid4()}.mp4"

TEST_FILE = Path(__file__).parent / "smoke-test.mp4"


def main() -> None:
    if not TEST_FILE.exists():
        raise FileNotFoundError(f"Put a small MP4 test file here first: {TEST_FILE}")

    supabase = create_client(
        settings.supabase_url,
        settings.supabase_service_role_key,
    )

    bucket = supabase.storage.from_(BUCKET)

    print(f"Uploading to {BUCKET}/{OBJECT_PATH}...")

    with TEST_FILE.open("rb") as file:
        bucket.upload(
            path=OBJECT_PATH,
            file=file,
            file_options={
                "content-type": "video/mp4",
                "upsert": "false",
            },
        )

    print("✅ Upload succeeded")

    public_url = bucket.get_public_url(OBJECT_PATH)

    public_response = httpx.get(public_url)

    print(f"Public URL status: {public_response.status_code}")

    if public_response.is_success:
        raise RuntimeError("❌ Private object was accessible through a public URL.")

    print("✅ Public access is blocked")

    signed = bucket.create_signed_url(
        OBJECT_PATH,
        60,
    )

    signed_url = signed["signedURL"]

    signed_response = httpx.get(signed_url)

    print(f"Signed URL status: {signed_response.status_code}")

    if not signed_response.is_success:
        raise RuntimeError("❌ Signed URL could not access the private object.")

    print("✅ Signed URL access works")

    bucket.remove([OBJECT_PATH])

    print("✅ Smoke-test object deleted")
    print("✅ Private Storage feasibility verified")


if __name__ == "__main__":
    main()
