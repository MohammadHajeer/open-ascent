import logging

from app.workers.analysis_worker import run_worker
from app.workers.vertical_pull_processor import process_vertical_pull

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    run_worker(process_vertical_pull)
