import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger("odessa.project")

class ProjectService:
    def normalize_project_priority(self, value: str) -> str:
        v = str(value).strip().lower()
        if v in ("low", "normal", "high", "urgent"):
            return v
        return "normal"

    def normalize_project_area(self, value: str) -> str:
        v = str(value).strip().lower()
        if v in ("backend", "frontend", "qa", "product", "design", "docs"):
            return v
        return "produto"

    def normalize_slack_route(self, route: str, area: str) -> str:
        r = str(route).strip().lstrip("#").lower()
        if r in ("odessa-roadmap", "odessa-dev-log", "odessa-qa", "odessa-ops"):
            return r
        if area == "qa":
            return "odessa-qa"
        if area == "docs":
            return "odessa-dev-log"
        return "odessa-roadmap"

    def normalize_string_list(self, value: Any, fallback: List[str]) -> List[str]:
        if isinstance(value, list):
            return [str(v).strip() for v in value if v]
        if isinstance(value, str) and value.strip():
            return [value.strip()]
        return fallback

    def normalize_object_list(self, value: Any, fallback: List[Dict[str, Any]], required_keys: tuple) -> List[Dict[str, Any]]:
        if not isinstance(value, list) or not value:
            return fallback
        items = []
        for index, item in enumerate(value):
            if isinstance(item, dict):
                normalized = {key: str(item.get(key) or "").strip() for key in required_keys}
            else:
                normalized = {required_keys[0]: str(item).strip()}
            
            if not normalized.get(required_keys[0]):
                normalized[required_keys[0]] = f"Item {index + 1}"
            items.append(normalized)
        return items

    def normalize_project_task(self, raw: Dict[str, Any], index: int, area: str) -> Dict[str, Any]:
        task_id = str(raw.get("id") or f"ODS-TASK-{index + 1:03d}").strip()
        return {
            "id": task_id,
            "title": str(raw.get("title") or f"Tarefa {index + 1}").strip(),
            "status": str(raw.get("status") or "todo").strip().lower(),
            "priority": self.normalize_project_priority(str(raw.get("priority") or "normal")),
            "area": self.normalize_project_area(str(raw.get("area") or area)),
        }

    def merge_project_tasks(self, existing: List[Dict[str, Any]], incoming: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        task_map = {t["id"]: t for t in existing}
        for task in incoming:
            tid = task["id"]
            if tid in task_map:
                # Preserve status if not provided in incoming
                if "status" not in task or not task["status"]:
                    task["status"] = task_map[tid]["status"]
                task_map[tid].update(task)
            else:
                task_map[tid] = task
        return list(task_map.values())

    def normalize_project_plan(self, data: Dict[str, Any]) -> Dict[str, Any]:
        area = self.normalize_project_area(str(data.get("area") or "backend"))
        raw_tasks = data.get("tasks") or data.get("items") or []
        tasks = [self.normalize_project_task(t, i, area) for i, t in enumerate(raw_tasks)]
        
        return {
            "projectId": str(data.get("projectId") or "ODS-PROJ-001").strip(),
            "title": str(data.get("title") or "Plano de Projeto Odessa").strip(),
            "area": area,
            "slackChannel": self.normalize_slack_route(str(data.get("slackChannel") or ""), area),
            "tasks": tasks,
            "milestones": self.normalize_object_list(
                data.get("milestones"), 
                [{"id": "M1", "title": "MVP Baseline"}], 
                ("id", "title")
            ),
            "risks": self.normalize_string_list(data.get("risks"), ["Nenhum risco critico mapeado"]),
            "tags": self.normalize_string_list(data.get("tags"), ["odessa", "v1"]),
        }

    def normalize_night_shift_plan(self, data: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "summary": str(data.get("summary") or "Avanços automatizados durante a madrugada.").strip(),
            "completedTasks": self.normalize_object_list(
                data.get("completedTasks"), 
                [], 
                ("id", "title")
            ),
            "nextSteps": self.normalize_string_list(
                data.get("nextSteps"), 
                ["Revisar logs de auditoria pela manha"]
            ),
            "alerts": self.normalize_string_list(data.get("alerts"), []),
        }

# Singleton instance
project_service = ProjectService()
