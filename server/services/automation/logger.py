import json
import logging
import os
from datetime import datetime
from typing import Dict, Any, List

logger = logging.getLogger("odessa.automation.execution_logger")

class ExecutionLogger:
    """
    Records detailed execution logs for the automation engine.
    Persists data to a JSONL file for audit and debugging.
    """
    def __init__(self):
        self.log_dir = os.path.join(os.getcwd(), "server", "data", "logs")
        os.makedirs(self.log_dir, exist_ok=True)
        self.log_file = os.path.join(self.log_dir, "execution.jsonl")

        # Keep an in-memory buffer for fast frontend polling
        self.recent_logs: List[Dict[str, Any]] = []
        self.max_buffer_size = 50

    def log(self, stage: str, message: str, event_data: Dict[str, Any] = None) -> Dict[str, Any]:
        """
        Records a step in the automation flow.
        Stages: OCR, PARSER, ENGINE, QUEUE, ERROR
        """
        entry = {
            "timestamp": datetime.now().isoformat(),
            "stage": stage.upper(),
            "message": message,
            "data": event_data or {}
        }

        # 1. In-memory buffer
        self.recent_logs.insert(0, entry)
        if len(self.recent_logs) > self.max_buffer_size:
            self.recent_logs.pop()

        # 2. Persist to disk
        try:
            with open(self.log_file, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry) + "\n")
        except Exception as e:
            logger.error(f"Failed to write execution log: {e}")
        return entry

    def get_recent(self) -> List[Dict[str, Any]]:
        """Returns recent logs for the Studio frontend."""
        return self.recent_logs

# Singleton instance
execution_logger = ExecutionLogger()
