import json
import os
import platform
import re
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from server.config import RUNTIME_DIR


CONFIG_FILE = RUNTIME_DIR / "chat_automation.json"


class ChatAutomationService:
    def _empty(self) -> dict[str, Any]:
        return {"allowlist": [], "logs": []}

    def _load(self) -> dict[str, Any]:
        try:
            if not CONFIG_FILE.exists():
                return self._empty()
            data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                return self._empty()
            data.setdefault("allowlist", [])
            data.setdefault("logs", [])
            return data
        except Exception:
            return self._empty()

    def _save(self, data: dict[str, Any]) -> dict[str, Any]:
        CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        CONFIG_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        return data

    def get_config(self) -> dict[str, Any]:
        data = self._load()
        return {"allowlist": data.get("allowlist", []), "logs": data.get("logs", [])[-100:]}

    def update_config(self, allowlist: list[dict[str, Any]]) -> dict[str, Any]:
        cleaned = []
        for entry in allowlist:
            if not isinstance(entry, dict):
                continue
            mode = "visual" if entry.get("mode") == "visual" else "selector"
            domain = str(entry.get("domain") or "").strip().lower()
            input_selector = str(entry.get("inputSelector") or "").strip()
            input_point = self._normalize_point(entry.get("inputPoint"))
            send_point = self._normalize_point(entry.get("sendPoint"))
            viewport = self._normalize_viewport(entry.get("viewport"))
            if mode == "visual":
                domain = domain or "visual:tango-live"
                input_selector = input_selector or "visual-point"
                if not input_point:
                    continue
            elif not domain or not input_selector:
                continue
            cleaned.append(
                {
                    "id": str(entry.get("id") or f"allow-{uuid.uuid4()}"),
                    "label": str(entry.get("label") or domain),
                    "mode": mode,
                    "domain": domain,
                    "urlPattern": str(entry.get("urlPattern") or "").strip(),
                    "inputSelector": input_selector,
                    "sendSelector": str(entry.get("sendSelector") or "").strip(),
                    "inputPoint": input_point,
                    "sendPoint": send_point,
                    "viewport": viewport,
                    "submitWithEnter": bool(entry.get("submitWithEnter", True)),
                    "typingDelayMs": max(0, min(int(entry.get("typingDelayMs", 25) or 25), 2000)),
                    "maxPerMinute": max(1, min(int(entry.get("maxPerMinute", 6) or 6), 60)),
                    "enabled": entry.get("enabled", True) is not False,
                }
            )
        data = self._load()
        data["allowlist"] = cleaned
        return self._save(data)

    def validate_target(
        self,
        url: str = "",
        input_selector: str | None = None,
        mode: str = "selector",
        input_point: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        match = self._match_target(url, input_selector, mode, input_point)
        return {"allowed": bool(match), "target": match, "reason": None if match else "not_allowlisted"}

    def send(
        self,
        url: str,
        text: str,
        input_selector: str | None = None,
        dry_run: bool = True,
        mode: str = "selector",
        input_point: dict[str, Any] | None = None,
        send_point: dict[str, Any] | None = None,
        viewport: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        target = self._match_target(url, input_selector, mode, input_point)
        if not target:
            result = {"status": "blocked", "allowed": False, "reason": "not_allowlisted"}
            self._log(url, text, result, input_selector, mode, input_point)
            return result
        if not text.strip():
            result = {"status": "blocked", "allowed": False, "reason": "empty_text", "target": target}
            self._log(url, text, result, input_selector, mode, input_point)
            return result
        visual = mode == "visual"
        result = {
            "status": "dry_run" if dry_run else "ready",
            "allowed": True,
            "target": target,
            "text": text,
            "mode": mode,
            "inputPoint": self._normalize_point(input_point) or target.get("inputPoint"),
            "sendPoint": self._normalize_point(send_point) or target.get("sendPoint"),
            "viewport": self._normalize_viewport(viewport) or target.get("viewport"),
            "wouldClick": visual,
            "wouldType": True,
            "wouldSend": not dry_run,
        }
        result["plannedInputPixel"] = self._planned_pixel(result.get("inputPoint"), result.get("viewport"))
        result["plannedSendPixel"] = self._planned_pixel(result.get("sendPoint"), result.get("viewport"))
        if visual and not dry_run:
            execution = self._execute_visual_desktop_send(
                text=text,
                input_point=result.get("inputPoint"),
                send_point=result.get("sendPoint"),
                viewport=result.get("viewport"),
            )
            result["execution"] = execution
            result["executed"] = bool(execution.get("ok"))
            if not execution.get("ok"):
                result["status"] = "blocked"
                result["reason"] = execution.get("error") or "desktop_execution_failed"
        self._log(url, text, result, input_selector, mode, input_point)
        return result

    def execute_visual_send(
        self,
        text: str,
        input_point: dict[str, Any] | None,
        send_point: dict[str, Any] | None = None,
        viewport: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if not text.strip():
            return {"status": "blocked", "allowed": False, "reason": "empty_text"}
        execution = self._execute_visual_desktop_send(
            text=text,
            input_point=input_point,
            send_point=send_point,
            viewport=viewport,
        )
        return {
            "status": "ready" if execution.get("ok") else "blocked",
            "allowed": True,
            "mode": "visual",
            "text": text,
            "inputPoint": self._normalize_point(input_point),
            "sendPoint": self._normalize_point(send_point),
            "wouldClick": True,
            "wouldType": True,
            "wouldSend": True,
            "executed": bool(execution.get("ok")),
            "execution": execution,
            "reason": None if execution.get("ok") else execution.get("error") or "desktop_execution_failed",
        }

    def _match_target(
        self,
        url: str,
        input_selector: str | None = None,
        mode: str = "selector",
        input_point: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        if mode == "visual":
            point = self._normalize_point(input_point)
            if not point:
                return None
            data = self._load()
            for entry in data.get("allowlist", []):
                if not entry.get("enabled", True) or entry.get("mode") != "visual":
                    continue
                return entry
            return None

        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
        data = self._load()
        for entry in data.get("allowlist", []):
            if not entry.get("enabled", True):
                continue
            if entry.get("mode", "selector") == "visual":
                continue
            domain = str(entry.get("domain") or "").lower()
            if host != domain and not host.endswith(f".{domain}"):
                continue
            pattern = str(entry.get("urlPattern") or "").strip()
            if pattern and not re.search(pattern, url):
                continue
            if input_selector and input_selector != entry.get("inputSelector"):
                continue
            return entry
        return None

    def _normalize_point(self, point: Any) -> dict[str, float] | None:
        if not isinstance(point, dict):
            return None
        try:
            x = float(point.get("x"))
            y = float(point.get("y"))
        except (TypeError, ValueError):
            return None
        if not 0 <= x <= 1 or not 0 <= y <= 1:
            return None
        return {"x": round(x, 4), "y": round(y, 4)}

    def _normalize_viewport(self, viewport: Any) -> dict[str, int] | None:
        if not isinstance(viewport, dict):
            return None
        try:
            width = int(viewport.get("width"))
            height = int(viewport.get("height"))
        except (TypeError, ValueError):
            return None
        if width < 1 or height < 1:
            return None
        return {"width": width, "height": height}

    def _planned_pixel(
        self,
        point: dict[str, Any] | None,
        viewport: dict[str, Any] | None,
    ) -> dict[str, int] | None:
        normalized_point = self._normalize_point(point)
        normalized_viewport = self._normalize_viewport(viewport)
        if not normalized_point or not normalized_viewport:
            return None
        return {
            "x": round(normalized_point["x"] * normalized_viewport["width"]),
            "y": round(normalized_point["y"] * normalized_viewport["height"]),
        }

    def _execute_visual_desktop_send(
        self,
        text: str,
        input_point: dict[str, Any] | None,
        send_point: dict[str, Any] | None = None,
        viewport: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if os.getenv("ODESSA_CHAT_AUTOMATION_DISABLED") == "1":
            return {"ok": False, "error": "desktop_chat_automation_disabled"}
        if platform.system().lower() != "windows":
            return {"ok": False, "error": "desktop_visual_send_requires_windows"}
        point = self._normalize_point(input_point)
        if not point:
            return {"ok": False, "error": "input_point_missing"}
        send = self._normalize_point(send_point)
        normalized_viewport = self._normalize_viewport(viewport)
        try:
            script = r"""
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MouseBridge {
  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
}
"@
$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$targetWidth = if ($payload.viewport -and $payload.viewport.width) { [int]$payload.viewport.width } else { $screen.Width }
$targetHeight = if ($payload.viewport -and $payload.viewport.height) { [int]$payload.viewport.height } else { $screen.Height }
function Click-Normalized($point) {
  $x = [Math]::Round($screen.Left + ($targetWidth * [double]$point.x))
  $y = [Math]::Round($screen.Top + ($targetHeight * [double]$point.y))
  [MouseBridge]::SetCursorPos([int]$x, [int]$y) | Out-Null
  Start-Sleep -Milliseconds 90
  [MouseBridge]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  [MouseBridge]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  return @{ x = $x; y = $y }
}
$clickedInput = Click-Normalized $payload.inputPoint
Start-Sleep -Milliseconds 120
[System.Windows.Forms.Clipboard]::SetText([string]$payload.text)
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Milliseconds 120
$clickedSend = $null
if ($payload.sendPoint -and $payload.sendPoint.x -ne $null -and $payload.sendPoint.y -ne $null) {
  $clickedSend = Click-Normalized $payload.sendPoint
} else {
  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
}
@{
  ok = $true
  screen = @{ width = $screen.Width; height = $screen.Height; left = $screen.Left; top = $screen.Top }
  targetViewport = @{ width = $targetWidth; height = $targetHeight }
  clickedInput = $clickedInput
  clickedSend = $clickedSend
  submittedWithEnter = ($clickedSend -eq $null)
} | ConvertTo-Json -Depth 5 -Compress
"""
            payload = json.dumps(
                {
                    "text": text,
                    "inputPoint": point,
                    "sendPoint": send,
                    "viewport": normalized_viewport,
                },
                ensure_ascii=False,
            )
            completed = subprocess.run(
                [
                    "powershell",
                    "-NoProfile",
                    "-STA",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-Command",
                    script,
                ],
                input=payload,
                text=True,
                capture_output=True,
                timeout=10,
                check=False,
            )
            if completed.returncode != 0:
                return {
                    "ok": False,
                    "error": "powershell_send_failed",
                    "stderr": completed.stderr[-500:],
                }
            output = completed.stdout.strip()
            if not output:
                return {"ok": False, "error": "empty_desktop_executor_output"}
            data = json.loads(output)
            data["executor"] = "windows-powershell-sendkeys"
            return data
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": "desktop_executor_timeout"}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    def _log(
        self,
        url: str,
        text: str,
        result: dict[str, Any],
        input_selector: str | None,
        mode: str = "selector",
        input_point: dict[str, Any] | None = None,
    ):
        data = self._load()
        data.setdefault("logs", []).append(
            {
                "id": f"chatlog-{uuid.uuid4()}",
                "createdAt": datetime.now(timezone.utc).isoformat(),
                "mode": mode,
                "url": url,
                "inputSelector": input_selector,
                "inputPoint": self._normalize_point(input_point),
                "text": text[:500],
                "result": result,
            }
        )
        data["logs"] = data["logs"][-300:]
        self._save(data)


chat_automation_service = ChatAutomationService()
