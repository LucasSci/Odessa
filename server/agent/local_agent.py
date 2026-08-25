from __future__ import annotations

import asyncio
import logging
import os
import platform
import socket
from dataclasses import dataclass
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from server.config import PROJECT_ROOT

load_dotenv(PROJECT_ROOT / ".env")

logger = logging.getLogger("odessa.agent")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")


@dataclass
class AgentConfig:
    cloud_url: str
    token: str
    agent_id: str
    heartbeat_interval: float
    command_interval: float
    local_http_host: str
    local_http_port: int


def load_agent_config() -> AgentConfig:
    cloud_url = os.getenv("ODESSA_CLOUD_URL", "https://odessa-gules.vercel.app").rstrip("/")
    token = os.getenv("ODESSA_AGENT_TOKEN", "").strip()
    if not token:
        raise RuntimeError("ODESSA_AGENT_TOKEN is required to connect the local agent to Odessa Cloud.")
    return AgentConfig(
        cloud_url=cloud_url,
        token=token,
        agent_id=os.getenv("ODESSA_AGENT_ID", socket.gethostname() or "local-agent").strip() or "local-agent",
        heartbeat_interval=float(os.getenv("ODESSA_AGENT_HEARTBEAT_SECONDS", "10")),
        command_interval=float(os.getenv("ODESSA_AGENT_COMMAND_SECONDS", "2")),
        local_http_host=os.getenv("ODESSA_AGENT_HOST", "127.0.0.1").strip() or "127.0.0.1",
        local_http_port=int(os.getenv("ODESSA_AGENT_PORT", "8766")),
    )


class AgentCommandRequest(BaseModel):
    type: str = "noop"
    payload: dict[str, Any] = {}
    id: str | None = None


class OdessaAgent:
    def __init__(self, config: AgentConfig):
        self.config = config
        self.headers = {"X-Odessa-Agent-Token": config.token}
        self.client = httpx.AsyncClient(timeout=15)
        self._last_health: dict[str, Any] = {}

    async def close(self) -> None:
        await self.client.aclose()

    async def probe_local_health(self) -> dict[str, Any]:
        health: dict[str, Any] = {
            "ok": True,
            "platform": platform.platform(),
            "python": platform.python_version(),
        }
        try:
            from server.services.obs_service import obs_service

            obs_health = await obs_service.live_health()
            health["obs"] = obs_health
            health["obsConnected"] = bool(obs_health.get("connected"))
        except Exception as exc:
            health["obs"] = {"ok": False, "error": str(exc)}
            health["obsConnected"] = False
        self._last_health = health
        return health

    async def send_heartbeat(self) -> None:
        health = await self.probe_local_health()
        capabilities = ["obs", "capture", "ocr-local", "video-local", "tts-local", "chat.send_visual"]
        payload = {
            "agentId": self.config.agent_id,
            "host": socket.gethostname(),
            "version": "0.1.0",
            "capabilities": capabilities,
            "health": health,
        }
        response = await self.client.post(
            f"{self.config.cloud_url}/api/agent/heartbeat",
            headers=self.headers,
            json=payload,
        )
        response.raise_for_status()
        logger.info("Heartbeat sent: agentConnected=%s", response.json().get("agentConnected"))

    async def report_event(self, event: dict[str, Any]) -> None:
        try:
            response = await self.client.post(
                f"{self.config.cloud_url}/api/agent/events",
                headers=self.headers,
                json=event,
            )
            response.raise_for_status()
        except Exception as exc:
            logger.warning("Could not report agent event: %s", exc)

    async def fetch_command(self) -> dict[str, Any] | None:
        response = await self.client.get(
            f"{self.config.cloud_url}/api/agent/commands/next",
            headers=self.headers,
        )
        response.raise_for_status()
        return response.json().get("command")

    async def execute_command(self, command: dict[str, Any]) -> dict[str, Any]:
        command_type = command.get("type")
        payload = command.get("payload") or {}
        logger.info("Executing command %s (%s)", command.get("id"), command_type)

        if command_type == "noop":
            return {"ok": True, "result": "noop"}

        if command_type == "obs.health":
            from server.services.obs_service import obs_service

            return await obs_service.health_check(payload.get("sourceName"))

        if command_type == "obs.live_health":
            from server.services.obs_service import obs_service

            return await obs_service.live_health()

        if command_type == "obs.configure":
            from server.services.obs_service import obs_service

            return {"ok": True, "settings": await obs_service.configure(payload)}

        if command_type == "obs.setup_live_scene":
            from server.services.obs_service import obs_service

            if payload:
                await obs_service.configure_live_layout(payload)
            return await obs_service.setup_live_scene()

        if command_type == "obs.show_stage":
            from server.services.obs_service import obs_service

            return await obs_service.show_stage_scene()

        if command_type == "obs.show_start":
            from server.services.video_service import video_service

            video_service.return_to_idle()
            return {"ok": True, "status": "idle"}

        if command_type == "obs.switch_scene":
            from server.services.obs_service import obs_service

            scene_name = str(payload.get("sceneName") or payload.get("scene") or "").strip()
            if not scene_name:
                return {"ok": False, "error": "sceneName is required"}
            return await obs_service.switch_scene(scene_name)

        if command_type in {"chat.send_visual", "chat.reply"}:
            from server.services.chat_automation_service import chat_automation_service

            text = str(payload.get("text") or payload.get("message") or "").strip()
            result = chat_automation_service.execute_visual_send(
                text,
                payload.get("inputPoint"),
                send_point=payload.get("sendPoint"),
                viewport=payload.get("viewport"),
                submit=payload.get("submit", True) is not False,
            )
            execution = result.get("execution") or {}
            coordinates = {
                "clickedInput": execution.get("clickedInput"),
                "clickedSend": execution.get("clickedSend"),
                "submittedWithEnter": execution.get("submittedWithEnter"),
            }
            return {
                "ok": bool(result.get("executed")),
                "status": "executed" if result.get("executed") else "failed",
                "commandId": payload.get("commandId"),
                "coordinates": coordinates,
                "error": None if result.get("executed") else result.get("reason") or execution.get("error"),
                "result": result,
            }

        if command_type == "obs.screenshot":
            from server.services.obs_service import obs_service

            return await obs_service.get_source_screenshot(
                payload.get("sourceName") or obs_service.chat_source_name,
                width=payload.get("width"),
                height=payload.get("height"),
                image_format=payload.get("format") or "png",
            )

        if command_type == "obs.transmission.start":
            from server.services.obs_service import obs_service

            return await obs_service.start_transmission(payload.get("mode"))

        if command_type == "obs.transmission.stop":
            from server.services.obs_service import obs_service

            return await obs_service.stop_transmission(payload.get("mode"))

        if command_type == "video.force":
            from server.services.video_service import video_service

            video_id = str(payload.get("videoId") or payload.get("video_id") or payload.get("id") or "").strip()
            if not video_id:
                return {"ok": False, "error": "videoId is required"}
            result = video_service.force_video(video_id)
            return {"ok": bool(result.get("status") != "error"), "result": result}

        if command_type == "obs.settings":
            from server.services.obs_service import obs_service

            return {"ok": True, "settings": obs_service.get_settings()}

        if command_type == "live.start":
            from server.services.obs_service import obs_service

            steps: list[dict[str, Any]] = []
            if payload.get("prepareObs", True):
                health = await obs_service.live_health()
                steps.append({"step": "obs.live_health", "result": health})
                if not health.get("ok"):
                    setup = await obs_service.setup_live_scene()
                    steps.append({"step": "obs.setup_live_scene", "result": setup})
                    if not setup.get("ok"):
                        return {"ok": False, "steps": steps, "error": setup.get("error") or health.get("error")}

            if payload.get("showStage", True):
                stage = await obs_service.show_stage_scene()
                steps.append({"step": "obs.show_stage", "result": stage})
                if not stage.get("ok"):
                    return {"ok": False, "steps": steps, "error": stage.get("error")}

            if payload.get("startTransmission"):
                transmission = await obs_service.start_transmission(payload.get("transmissionMode"))
                steps.append({"step": "obs.transmission.start", "result": transmission})
                if not transmission.get("ok"):
                    return {"ok": False, "steps": steps, "error": transmission.get("error")}

            return {"ok": True, "steps": steps}

        return {"ok": False, "error": f"Unsupported command type: {command_type}"}

    def create_local_http_app(self) -> FastAPI:
        app = FastAPI(title="Odessa Local Agent", version="0.1.0")
        app.add_middleware(
            CORSMiddleware,
            allow_origins=[
                "https://odessa-gules.vercel.app",
                "https://odessa-lucasscis-projects.vercel.app",
                "https://odessa-lucassci-lucasscis-projects.vercel.app",
                "http://localhost:3000",
                "http://127.0.0.1:3000",
            ],
            allow_credentials=False,
            allow_methods=["*"],
            allow_headers=["*"],
        )

        @app.get("/status")
        async def status():
            health = await self.probe_local_health()
            return {
                "ok": True,
                "agentConnected": True,
                "agent": {
                    "agentId": self.config.agent_id,
                    "host": socket.gethostname(),
                    "version": "0.1.0",
                    "capabilities": ["obs", "capture", "ocr-local", "video-local", "tts-local", "chat.send_visual"],
                    "health": health,
                },
                "queueSize": 0,
                "message": "Odessa Agent local conectado.",
            }

        @app.post("/command")
        async def command(request: AgentCommandRequest):
            command_payload = {
                "id": request.id or "local-http-command",
                "type": request.type,
                "payload": request.payload,
            }
            result = await self.execute_command(command_payload)
            await self.report_event({
                "kind": "local_command_result",
                "commandId": command_payload.get("id"),
                "status": result.get("status") or ("executed" if result.get("ok") else "failed"),
                "coordinates": result.get("coordinates"),
                "error": result.get("error"),
                "command": command_payload,
                "result": result,
            })
            return {"ok": bool(result.get("ok")), "command": command_payload, "result": result}

        return app

    async def heartbeat_loop(self) -> None:
        while True:
            try:
                await self.send_heartbeat()
            except Exception as exc:
                logger.warning("Heartbeat failed: %s", exc)
            await asyncio.sleep(self.config.heartbeat_interval)

    async def command_loop(self) -> None:
        while True:
            try:
                command = await self.fetch_command()
                if command:
                    result = await self.execute_command(command)
                    await self.report_event({
                        "kind": "command_result",
                        "commandId": command.get("id") or result.get("commandId"),
                        "status": result.get("status") or ("executed" if result.get("ok") else "failed"),
                        "coordinates": result.get("coordinates"),
                        "error": result.get("error"),
                        "command": command,
                        "result": result,
                    })
            except Exception as exc:
                logger.warning("Command loop failed: %s", exc)
            await asyncio.sleep(self.config.command_interval)

    async def local_http_loop(self) -> None:
        import uvicorn

        app = self.create_local_http_app()
        config = uvicorn.Config(
            app,
            host=self.config.local_http_host,
            port=self.config.local_http_port,
            log_level="warning",
        )
        server = uvicorn.Server(config)
        logger.info(
            "Local agent HTTP listening at http://%s:%s",
            self.config.local_http_host,
            self.config.local_http_port,
        )
        await server.serve()

    async def run(self) -> None:
        logger.info("Odessa Agent connecting to %s as %s", self.config.cloud_url, self.config.agent_id)
        try:
            await asyncio.gather(self.heartbeat_loop(), self.command_loop(), self.local_http_loop())
        finally:
            await self.close()


async def main() -> None:
    agent = OdessaAgent(load_agent_config())
    await agent.run()


if __name__ == "__main__":
    asyncio.run(main())
