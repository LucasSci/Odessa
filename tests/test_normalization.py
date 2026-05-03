import pytest
from unittest.mock import patch
from server.main import (
    normalize_project_priority,
    normalize_project_area,
    normalize_slack_route,
    normalize_string_list,
    normalize_object_list,
    normalize_project_task,
    merge_project_tasks
)

def test_normalize_project_priority():
    assert normalize_project_priority("urgent") == "urgent"
    assert normalize_project_priority("  HIGH  ") == "high"
    assert normalize_project_priority("invalid") == "normal"

def test_normalize_project_area():
    assert normalize_project_area("backend") == "backend"
    assert normalize_project_area("  QA  ") == "qa"
    assert normalize_project_area("unknown") == "produto"

def test_normalize_slack_route():
    assert normalize_slack_route("odessa-roadmap", "backend") == "odessa-roadmap"
    assert normalize_slack_route("#odessa-qa", "qa") == "odessa-qa"
    assert normalize_slack_route("invalid", "qa") == "odessa-qa"
    assert normalize_slack_route("invalid", "docs") == "odessa-dev-log"
    assert normalize_slack_route("invalid", "backend") == "odessa-roadmap"

def test_normalize_string_list():
    assert normalize_string_list(["a", "b"], ["fallback"]) == ["a", "b"]
    assert normalize_string_list([], ["fallback"]) == ["fallback"]
    assert normalize_string_list("string", ["fallback"]) == ["string"]
    assert normalize_string_list(None, ["fallback"]) == ["fallback"]

def test_normalize_object_list():
    fallback = [{"id": "f"}]
    required = ("id", "title")
    assert normalize_object_list([{"id": "1", "title": "T"}], fallback, required) == [{"id": "1", "title": "T"}]
    assert normalize_object_list([], fallback, required) == fallback
    # Mixed list: for non-dict item, only the first required key is populated
    assert normalize_object_list(["item"], fallback, required) == [{"id": "item"}]

def test_normalize_project_task():
    raw = {"title": "Test", "status": "DONE", "priority": "high"}
    task = normalize_project_task(raw, 0, "backend")
    assert task["title"] == "Test"
    assert task["status"] == "done"
    assert task["priority"] == "high"
    assert task["id"] == "ODS-TASK-001"

def test_merge_project_tasks():
    existing = [{"id": "T1", "status": "done", "title": "Old"}]
    incoming = [{"id": "T1", "title": "New"}, {"id": "T2", "title": "Other"}]
    merged = merge_project_tasks(existing, incoming)
    # T1 should preserve its status
    t1 = next(t for t in merged if t["id"] == "T1")
    assert t1["status"] == "done"
    assert t1["title"] == "New"
    assert len(merged) == 2
