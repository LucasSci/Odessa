import logging
import time
from typing import Dict, Any, List
from collections import deque

logger = logging.getLogger("odessa.automation.metrics")

class AutomationMetrics:
    """
    Tracks performance and usage metrics for the automation engine.
    """
    def __init__(self):
        self.total_events = 0
        self.processed_events = 0
        self.deduplicated_events = 0
        self.aggregated_gift_events = 0
        self.blocked_actions = 0
        self.simulated_actions = 0
        self.done_actions = 0
        self.ai_fallback_count = 0
        self.tts_blocked_count = 0
        self.obs_blocked_count = 0
        self.moderation_events = 0

        # Processing times
        self.processing_times = deque(maxlen=1000)
        self.start_times: Dict[str, float] = {}

    def start_event(self, event_id: str):
        self.start_times[event_id] = time.time()
        self.total_events += 1

    def end_event(self, event_id: str):
        if event_id in self.start_times:
            duration = (time.time() - self.start_times.pop(event_id)) * 1000
            self.processing_times.append(duration)
            self.processed_events += 1

    def increment(self, metric_name: str, count: int = 1):
        if hasattr(self, metric_name):
            setattr(self, metric_name, getattr(self, metric_name) + count)
        else:
            logger.warning(f"Metric '{metric_name}' does not exist.")

    def get_summary(self) -> Dict[str, Any]:
        p95 = 0
        avg = 0
        if self.processing_times:
            sorted_times = sorted(list(self.processing_times))
            p95 = sorted_times[int(len(sorted_times) * 0.95)]
            avg = sum(self.processing_times) / len(self.processing_times)

        return {
            "totalEvents": self.total_events,
            "processedEvents": self.processed_events,
            "deduplicatedEvents": self.deduplicated_events,
            "aggregatedGiftEvents": self.aggregated_gift_events,
            "blockedActions": self.blocked_actions,
            "simulatedActions": self.simulated_actions,
            "doneActions": self.done_actions,
            "aiFallbackCount": self.ai_fallback_count,
            "ttsBlockedCount": self.tts_blocked_count,
            "obsBlockedCount": self.obs_blocked_count,
            "moderationEvents": self.moderation_events,
            "averageProcessingMs": round(avg, 2),
            "p95ProcessingMs": round(p95, 2),
            "maxProcessingMs": round(max(self.processing_times) if self.processing_times else 0, 2)
        }

# Singleton instance
automation_metrics = AutomationMetrics()
