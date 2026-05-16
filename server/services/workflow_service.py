import copy
import time
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from server.core.config_manager import _normalize_config, load_persona_config, save_persona_config
from server.core.video_files import get_video_path


WORKFLOW_KEYS = {
    "idleVideoId",
    "flowNodes",
    "flowConnections",
    "triggers",
    "stageSettings",
    "mediaTracks",
    "transitions",
}


class WorkflowService:
    schema_version = "odessa.workflow.v1"

    def _now(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _workflow_fields_from_config(self, config: dict[str, Any]) -> dict[str, Any]:
        return {
            "workflowName": config.get("workflowName") or "Odessa Workflow",
            "idleVideoId": config.get("idleVideoId", ""),
            "flowNodes": copy.deepcopy(config.get("flowNodes", [])),
            "flowConnections": copy.deepcopy(config.get("flowConnections", [])),
            "triggers": copy.deepcopy(config.get("triggers", [])),
            "stageSettings": copy.deepcopy(config.get("stageSettings", {})),
            "mediaTracks": copy.deepcopy(config.get("mediaTracks", [])),
            "transitions": copy.deepcopy(config.get("transitions", {})),
        }

    def _with_metadata(
        self,
        workflow: dict[str, Any],
        *,
        status: str,
        existing: dict[str, Any] | None = None,
        published_from_draft_id: str | None = None,
        validation: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        current = existing if isinstance(existing, dict) else {}
        workflow_id = str(current.get("workflowId") or workflow.get("workflowId") or uuid4())
        version = int(current.get("version") or workflow.get("version") or 0)
        if current:
            version += 1
        meta = {
            "schemaVersion": self.schema_version,
            "workflowId": workflow_id,
            "version": version,
            "status": status,
            "updatedAt": self._now(),
            "publishedAt": current.get("publishedAt") if status == "draft" else self._now(),
            "publishedFromDraftId": published_from_draft_id or current.get("publishedFromDraftId"),
            "lastValidation": validation if validation is not None else current.get("lastValidation"),
        }
        return {**workflow, **meta}

    def _ensure_versioned(self, config: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        changed = False
        base = self._workflow_fields_from_config(config)
        if not isinstance(config.get("publishedWorkflow"), dict):
            config["publishedWorkflow"] = self._with_metadata(base, status="published")
            changed = True
        if not isinstance(config.get("draftWorkflow"), dict):
            config["draftWorkflow"] = self._with_metadata(
                copy.deepcopy(config["publishedWorkflow"]),
                status="draft",
            )
            changed = True
        return config, changed

    def _merge_workflow_into_config(self, config: dict[str, Any], workflow: dict[str, Any]) -> dict[str, Any]:
        next_config = copy.deepcopy(config)
        for key in WORKFLOW_KEYS:
            if key in workflow:
                next_config[key] = copy.deepcopy(workflow.get(key))
        if workflow.get("workflowName"):
            next_config["workflowName"] = workflow.get("workflowName")
        return _normalize_config(next_config)

    def _workflow_response(self, config: dict[str, Any], source: str) -> dict[str, Any]:
        workflow_key = "draftWorkflow" if source == "draft" else "publishedWorkflow"
        workflow = copy.deepcopy(config.get(workflow_key) or {})
        merged = self._merge_workflow_into_config(config, workflow)
        return {
            **merged,
            "workflowMeta": {
                key: workflow.get(key)
                for key in [
                    "schemaVersion",
                    "workflowId",
                    "version",
                    "status",
                    "updatedAt",
                    "publishedAt",
                    "publishedFromDraftId",
                    "lastValidation",
                ]
            },
        }

    def get_versioned_workflow(self, source: str = "draft") -> dict[str, Any]:
        config = load_persona_config()
        config, changed = self._ensure_versioned(config)
        if changed:
            save_persona_config(config)
        return self._workflow_response(config, "published" if source == "published" else "draft")

    def save_draft(self, payload: dict[str, Any]) -> dict[str, Any]:
        config = load_persona_config()
        config, _ = self._ensure_versioned(config)
        current_draft = copy.deepcopy(config.get("draftWorkflow") or {})
        workflow = self._extract_workflow(payload)
        next_draft = {
            **current_draft,
            **self._workflow_fields_from_config({**config, **workflow}),
        }
        preview_config = self._merge_workflow_into_config(config, next_draft)
        validation = self.validate_workflow(preview_config)
        next_draft = self._with_metadata(
            next_draft,
            status="draft",
            existing=current_draft,
            validation=validation,
        )
        config["draftWorkflow"] = next_draft
        if not save_persona_config(config):
            raise RuntimeError("Failed to save draft workflow")
        return {"status": "draft_saved", "draft": self._preview_config(preview_config), "validation": validation, "meta": next_draft}

    def reset_draft_from_published(self) -> dict[str, Any]:
        config = load_persona_config()
        config, _ = self._ensure_versioned(config)
        published = copy.deepcopy(config.get("publishedWorkflow") or self._workflow_fields_from_config(config))
        current_draft = copy.deepcopy(config.get("draftWorkflow") or {})
        config["draftWorkflow"] = self._with_metadata(published, status="draft", existing=current_draft)
        if not save_persona_config(config):
            raise RuntimeError("Failed to reset draft workflow")
        return {"status": "draft_reset", "draft": self._workflow_response(config, "draft")}

    def compare_draft_to_published(self) -> dict[str, Any]:
        config = load_persona_config()
        config, changed = self._ensure_versioned(config)
        if changed:
            save_persona_config(config)
        draft = config.get("draftWorkflow") or {}
        published = config.get("publishedWorkflow") or {}
        draft_nodes = {node.get("nodeId"): node for node in draft.get("flowNodes", []) if isinstance(node, dict)}
        published_nodes = {node.get("nodeId"): node for node in published.get("flowNodes", []) if isinstance(node, dict)}
        draft_connections = {item.get("id"): item for item in draft.get("flowConnections", []) if isinstance(item, dict)}
        published_connections = {item.get("id"): item for item in published.get("flowConnections", []) if isinstance(item, dict)}
        draft_triggers = {item.get("id"): item for item in draft.get("triggers", []) if isinstance(item, dict)}
        published_triggers = {item.get("id"): item for item in published.get("triggers", []) if isinstance(item, dict)}
        return {
            "nodesAdded": sorted(set(draft_nodes) - set(published_nodes)),
            "nodesRemoved": sorted(set(published_nodes) - set(draft_nodes)),
            "nodesChanged": sorted(
                node_id for node_id in set(draft_nodes) & set(published_nodes) if draft_nodes[node_id] != published_nodes[node_id]
            ),
            "connectionsAdded": sorted(set(draft_connections) - set(published_connections)),
            "connectionsRemoved": sorted(set(published_connections) - set(draft_connections)),
            "connectionsChanged": sorted(
                item_id
                for item_id in set(draft_connections) & set(published_connections)
                if draft_connections[item_id] != published_connections[item_id]
            ),
            "triggersAdded": sorted(set(draft_triggers) - set(published_triggers)),
            "triggersRemoved": sorted(set(published_triggers) - set(draft_triggers)),
            "triggersChanged": sorted(
                item_id for item_id in set(draft_triggers) & set(published_triggers) if draft_triggers[item_id] != published_triggers[item_id]
            ),
            "idleChanged": draft.get("idleVideoId") != published.get("idleVideoId"),
        }

    def publish_draft(self) -> dict[str, Any]:
        config = load_persona_config()
        config, _ = self._ensure_versioned(config)
        draft = copy.deepcopy(config.get("draftWorkflow") or {})
        candidate = self._merge_workflow_into_config(config, draft)
        validation = self.validate_workflow(candidate)
        comparison = self.compare_draft_to_published()
        published = self._with_metadata(
            self._workflow_fields_from_config(candidate),
            status="published",
            existing=config.get("publishedWorkflow"),
            published_from_draft_id=str(draft.get("workflowId") or ""),
            validation=validation,
        )
        config = self._merge_workflow_into_config(config, published)
        config["publishedWorkflow"] = published
        config["draftWorkflow"] = self._with_metadata(
            copy.deepcopy(published),
            status="draft",
            existing=config.get("draftWorkflow"),
            validation=validation,
        )
        config["workflowPublishMeta"] = {
            "publishedAt": published["publishedAt"],
            "comparison": comparison,
            "validation": validation,
        }
        if not save_persona_config(config):
            raise RuntimeError("Failed to publish workflow")
        return {
            "status": "published",
            "published": self._preview_config(config),
            "validation": validation,
            "comparison": comparison,
            "meta": published,
        }

    def export_workflow(self) -> dict[str, Any]:
        config = self.get_versioned_workflow("published")
        flow_nodes = list(config.get("flowNodes", []))
        used_video_ids = sorted({node.get("videoId") for node in flow_nodes if node.get("videoId")})
        videos = [
            {k: v for k, v in video.items() if k in {"id", "label", "group", "description", "tags", "missingFile"}}
            for video in config.get("videos", [])
            if video.get("id") in used_video_ids
        ]
        return {
            "schemaVersion": self.schema_version,
            "workflowName": config.get("workflowName") or "Odessa Workflow",
            "exportedAt": datetime.now(timezone.utc).isoformat(),
            "idleVideoId": config.get("idleVideoId", ""),
            "flowNodes": flow_nodes,
            "flowConnections": config.get("flowConnections", []),
            "triggers": config.get("triggers", []),
            "stageSettings": config.get("stageSettings", {}),
            "mediaTracks": config.get("mediaTracks", []),
            "transitions": config.get("transitions", {}),
            "videos": videos,
            "usedVideoIds": used_video_ids,
        }

    def validate_workflow(self, payload: dict[str, Any]) -> dict[str, Any]:
        workflow = self._extract_workflow(payload)
        current = load_persona_config()
        current_video_ids = {video.get("id") for video in current.get("videos", []) if video.get("id")}
        current_node_ids = {node.get("nodeId") for node in current.get("flowNodes", []) if node.get("nodeId")}
        current_trigger_ids = {trigger.get("id") for trigger in current.get("triggers", []) if trigger.get("id")}

        node_ids = [node.get("nodeId") for node in workflow.get("flowNodes", []) if isinstance(node, dict)]
        trigger_ids = [trigger.get("id") for trigger in workflow.get("triggers", []) if isinstance(trigger, dict)]
        used_video_ids = sorted(
            {
                node.get("videoId")
                for node in workflow.get("flowNodes", [])
                if isinstance(node, dict) and node.get("videoId")
            }
        )
        missing = [
            video_id
            for video_id in used_video_ids
            if video_id not in current_video_ids and not get_video_path(video_id)
        ]
        duplicate_node_ids = sorted({node_id for node_id in node_ids if node_ids.count(node_id) > 1})
        duplicate_trigger_ids = sorted({trigger_id for trigger_id in trigger_ids if trigger_ids.count(trigger_id) > 1})
        node_conflicts = sorted({node_id for node_id in node_ids if node_id in current_node_ids})
        trigger_conflicts = sorted({trigger_id for trigger_id in trigger_ids if trigger_id in current_trigger_ids})
        connection_count = len([item for item in workflow.get("flowConnections", []) if isinstance(item, dict)])
        warnings = []
        if missing:
            warnings.append("missing_videos_will_be_placeholders")
        if duplicate_node_ids or duplicate_trigger_ids:
            warnings.append("duplicate_ids_will_be_remapped")
        if node_conflicts or trigger_conflicts:
            warnings.append("existing_ids_will_be_remapped")

        return {
            "valid": True,
            "schemaVersion": workflow.get("schemaVersion") or self.schema_version,
            "summary": {
                "nodes": len(node_ids),
                "connections": connection_count,
                "triggers": len(trigger_ids),
                "usedVideos": len(used_video_ids),
            },
            "usedVideoIds": used_video_ids,
            "missingVideoIds": missing,
            "placeholderVideos": [{"id": video_id, "missingFile": True} for video_id in missing],
            "conflicts": {
                "nodeIds": node_conflicts,
                "triggerIds": trigger_conflicts,
                "duplicateNodeIds": duplicate_node_ids,
                "duplicateTriggerIds": duplicate_trigger_ids,
            },
            "warnings": warnings,
        }

    def import_workflow(self, payload: dict[str, Any], dry_run: bool = False) -> dict[str, Any]:
        workflow = self._extract_workflow(payload)
        validation = self.validate_workflow(workflow)
        current = load_persona_config()
        imported = copy.deepcopy(workflow)

        node_id_map: dict[str, str] = {}
        trigger_id_map: dict[str, str] = {}
        current_node_ids = {node.get("nodeId") for node in current.get("flowNodes", []) if node.get("nodeId")}
        current_trigger_ids = {trigger.get("id") for trigger in current.get("triggers", []) if trigger.get("id")}

        for index, node in enumerate(imported.get("flowNodes", [])):
            if not isinstance(node, dict):
                continue
            old_id = str(node.get("nodeId") or f"import-node-{index}")
            new_id = old_id
            if old_id in current_node_ids or old_id in node_id_map.values() or old_id in node_id_map:
                new_id = f"{old_id}-import-{int(time.time() * 1000)}-{index}"
            node["nodeId"] = new_id
            node_id_map[old_id] = new_id

        for index, trigger in enumerate(imported.get("triggers", [])):
            if not isinstance(trigger, dict):
                continue
            old_id = str(trigger.get("id") or f"import-trigger-{index}")
            new_id = old_id
            if old_id in current_trigger_ids or old_id in trigger_id_map.values() or old_id in trigger_id_map:
                new_id = f"{old_id}-import-{int(time.time() * 1000)}-{index}"
            trigger["id"] = new_id
            trigger_id_map[old_id] = new_id
            for action in trigger.get("actions", []):
                if isinstance(action, dict) and action.get("nodeId") in node_id_map:
                    action["nodeId"] = node_id_map[action["nodeId"]]

        for connection in imported.get("flowConnections", []):
            if not isinstance(connection, dict):
                continue
            if connection.get("fromNodeId") in node_id_map:
                connection["fromNodeId"] = node_id_map[connection["fromNodeId"]]
            if connection.get("toNodeId") in node_id_map:
                connection["toNodeId"] = node_id_map[connection["toNodeId"]]
            if connection.get("triggerId") in trigger_id_map:
                connection["triggerId"] = trigger_id_map[connection["triggerId"]]

        videos = [dict(video) for video in current.get("videos", [])]
        video_ids = {video.get("id") for video in videos}
        imported_video_meta = {
            video.get("id"): video for video in imported.get("videos", []) if isinstance(video, dict) and video.get("id")
        }
        for video_id in validation["missingVideoIds"]:
            if video_id in video_ids:
                continue
            meta = imported_video_meta.get(video_id, {})
            videos.append(
                {
                    "id": video_id,
                    "label": meta.get("label") or str(video_id).replace("_", " ").title(),
                    "group": meta.get("group") or "placeholder",
                    "description": meta.get("description") or "Placeholder importado: envie o arquivo para habilitar.",
                    "loop": False,
                    "missingFile": True,
                }
            )

        next_config = {
            **current,
            "workflowName": imported.get("workflowName") or current.get("workflowName") or "Odessa Workflow",
            "videos": videos,
            "idleVideoId": imported.get("idleVideoId") or current.get("idleVideoId") or "",
            "flowNodes": imported.get("flowNodes", []),
            "flowConnections": imported.get("flowConnections", []),
            "triggers": imported.get("triggers", []),
            "stageSettings": imported.get("stageSettings") or current.get("stageSettings", {}),
            "mediaTracks": imported.get("mediaTracks") or current.get("mediaTracks", []),
            "transitions": imported.get("transitions") or {},
            "workflowImportMeta": {
                "importedAt": datetime.now(timezone.utc).isoformat(),
                "nodeIdMap": node_id_map,
                "triggerIdMap": trigger_id_map,
                "warnings": validation["warnings"],
            },
        }
        normalized = _normalize_config(next_config)
        if dry_run:
            return {"status": "validated", "validation": validation, "wouldImport": self._preview_config(normalized)}

        if not save_persona_config(normalized):
            raise RuntimeError("Failed to save imported workflow")
        return {"status": "imported", "validation": validation, "workflow": self._preview_config(normalized)}

    def _extract_workflow(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise ValueError("Workflow JSON must be an object")
        workflow = payload.get("workflow") if isinstance(payload.get("workflow"), dict) else payload
        if not isinstance(workflow.get("flowNodes", []), list):
            raise ValueError("flowNodes must be a list")
        if not isinstance(workflow.get("flowConnections", []), list):
            raise ValueError("flowConnections must be a list")
        if not isinstance(workflow.get("triggers", []), list):
            raise ValueError("triggers must be a list")
        return workflow

    def _preview_config(self, config: dict[str, Any]) -> dict[str, Any]:
        return {
            "workflowName": config.get("workflowName"),
            "idleVideoId": config.get("idleVideoId"),
            "nodes": len(config.get("flowNodes", [])),
            "connections": len(config.get("flowConnections", [])),
            "triggers": len(config.get("triggers", [])),
            "placeholderVideos": [
                {"id": video.get("id"), "label": video.get("label")}
                for video in config.get("videos", [])
                if video.get("missingFile")
            ],
        }


workflow_service = WorkflowService()
