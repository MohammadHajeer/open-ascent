from app.core.config import settings
from app.db.database import SessionLocal
from app.services.entitlements import seed_plan_catalog


def main() -> None:
    with SessionLocal() as db:
        try:
            seed_plan_catalog(
                db,
                pro_stripe_price_id=settings.stripe_pro_price_id,
            )
            db.commit()
        except Exception:
            db.rollback()
            raise

    print("Open Ascent subscription plan seed complete.")


if __name__ == "__main__":
    main()
