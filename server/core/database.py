import sqlite3
import logging
from contextlib import contextmanager
from typing import Generator

from server.config import ODESSA_DB_PATH

logger = logging.getLogger("odessa.database")

class Database:
    def __init__(self, db_path=ODESSA_DB_PATH):
        self.db_path = db_path
        self._initialize()

    def _initialize(self):
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self.get_connection() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    username TEXT NOT NULL,
                    first_seen TEXT NOT NULL,
                    last_seen TEXT NOT NULL,
                    total_messages INTEGER NOT NULL DEFAULT 0,
                    total_gifts INTEGER NOT NULL DEFAULT 0,
                    sentiment TEXT NOT NULL DEFAULT 'neutral'
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS interaction_logs (
                    id TEXT PRIMARY KEY,
                    user_id TEXT,
                    username TEXT,
                    kind TEXT NOT NULL,
                    source TEXT NOT NULL,
                    text TEXT NOT NULL,
                    metadata_json TEXT NOT NULL,
                    sentiment TEXT NOT NULL DEFAULT 'neutral',
                    created_at TEXT NOT NULL
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_interaction_user ON interaction_logs(user_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_interaction_created ON interaction_logs(created_at)")
            conn.commit()
            logger.info("Database initialized at %s", self.db_path)

    @contextmanager
    def get_connection(self) -> Generator[sqlite3.Connection, None, None]:
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
        finally:
            connection.close()

# Singleton instance
db = Database()
