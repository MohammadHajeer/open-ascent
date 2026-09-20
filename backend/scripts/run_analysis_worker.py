import logging
from threading import Thread

from app.workers.analysis_worker import run_worker
from app.workers.explanation_worker import run_explanation_worker
from app.workers.guest_cleanup_worker import run_guest_cleanup_worker
from app.workers.vertical_pull_processor import process_vertical_pull

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    Thread(
        target=run_explanation_worker, name="explanation-worker", daemon=True
    ).start()
    Thread(target=run_guest_cleanup_worker, name="guest-cleanup", daemon=True).start()
    run_worker(process_vertical_pull)
