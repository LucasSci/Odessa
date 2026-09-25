r"""
bench_local_llm.py — benchmark do motor de IA local embutido (llama.cpp `llama-server`).

Mede carga, RAM, velocidade de geração, tempo de resposta no estilo do chat da
live e acerto de tool calling em 2 turnos (consultar → arquivar duplicados).
Base dos números da Frente D em docs/PLANO-USABILIDADE.md.

Uso:
    set LLAMA_SERVER=C:\caminho\llama-server.exe
    python scripts/bench_local_llm.py <modelo.gguf> <rótulo> <ngl: 99=GPU, 0=CPU> <tentativas> [baixo|alto] [sem-chat]

Só Windows (mede RAM via API do Windows). Saída: uma linha JSON (use PYTHONIOENCODING=utf-8).
"""
import json
import os
import secrets
import socket
import subprocess
import sys
import time
from pathlib import Path

import ctypes
import ctypes.wintypes as wt

import httpx


class _MemStatus(ctypes.Structure):
    _fields_ = [("dwLength", wt.DWORD), ("dwMemoryLoad", wt.DWORD), ("ullTotalPhys", ctypes.c_uint64),
                ("ullAvailPhys", ctypes.c_uint64), ("ullTotalPageFile", ctypes.c_uint64), ("ullAvailPageFile", ctypes.c_uint64),
                ("ullTotalVirtual", ctypes.c_uint64), ("ullAvailVirtual", ctypes.c_uint64), ("ullAvailExtendedVirtual", ctypes.c_uint64)]


class _ProcMem(ctypes.Structure):
    _fields_ = [("cb", wt.DWORD), ("PageFaultCount", wt.DWORD), ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t), ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t)]


def free_ram_gb() -> float:
    st = _MemStatus(); st.dwLength = ctypes.sizeof(st)
    ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(st))
    return st.ullAvailPhys / 1e9


def rss_gb(pid: int) -> float:
    h = ctypes.windll.kernel32.OpenProcess(0x0400 | 0x0010, False, pid)
    pm = _ProcMem(); pm.cb = ctypes.sizeof(pm)
    ctypes.windll.psapi.GetProcessMemoryInfo(h, ctypes.byref(pm), pm.cb)
    ctypes.windll.kernel32.CloseHandle(h)
    return pm.WorkingSetSize / 1e9

HERE = Path(__file__).parent
SERVER = Path(os.environ.get("LLAMA_SERVER", HERE / "bin" / "llama-server.exe"))

PERSONA = ("Você é a Barbara, uma streamer extrovertida, animada e super próxima do público. "
           "Responda em português do Brasil, de forma curta (1 ou 2 frases), divertida e calorosa, "
           "chamando a pessoa pelo nome.")
CHAT_MSGS = [
    ("lucas_22", "oi Barbara, cheguei agora na live! tudo bem?"),
    ("mari.fs", "mandei uma rosa pra vc 🌹"),
    ("joaopedro", "qual seu jogo favorito?"),
]

TOOLS = [
    {"type": "function", "function": {"name": "library_search_videos", "description": "Busca vídeos da biblioteca da persona ativa.",
        "parameters": {"type": "object", "properties": {"query": {"type": "string"}, "category": {"type": "string", "enum": ["idle", "gatilho", "transicao", "especial"]}}}}},
    {"type": "function", "function": {"name": "library_archive_videos", "description": "Arquiva (reversível) vídeos pelos IDs.",
        "parameters": {"type": "object", "properties": {"ids": {"type": "array", "items": {"type": "string"}}}, "required": ["ids"]}}},
    {"type": "function", "function": {"name": "photo_generate", "description": "Gera uma foto nova da persona (custa créditos).",
        "parameters": {"type": "object", "properties": {"prompt": {"type": "string"}}, "required": ["prompt"]}}},
]
SYS_TOOLS = ("Você é o copiloto de produção do Odessa. Use as ferramentas para consultar e organizar o conteúdo. "
             "Quando o usuário pedir uma ação e você tiver os dados, CHAME a ferramenta em vez de só descrever. Responda em português.")
USER_TOOLS = "Quais vídeos de gatilho de beijo eu tenho? Depois arquive os duplicados (mantenha um de cada)."
LIB_RESULT = {"videos": [
    {"id": "09_GATILHO_beijo_discreto_1", "md5": "3a81fd72"}, {"id": "10_GATILHO_beijo_discreto_2", "md5": "3a81fd72"},
    {"id": "31_GATILHO_beijo_discreto_var5", "md5": "3a81fd72"}, {"id": "20_GATILHO_beijo_discreto_var3", "md5": "fefb21c2"},
    {"id": "21_GATILHO_beijo_discreto_var4", "md5": "fefb21c2"}, {"id": "30_GATILHO_beijo_aceno_discreto", "md5": "c01d9a77"}],
    "note": "md5 igual = arquivo duplicado"}
TOOLS_HI = [
    {"type": "function", "function": {"name": "library_find_duplicates", "description": "Encontra vídeos duplicados (mesmo arquivo) na biblioteca, com filtro opcional, e sugere quais arquivar mantendo um de cada.",
        "parameters": {"type": "object", "properties": {"query": {"type": "string"}, "category": {"type": "string", "enum": ["idle", "gatilho", "transicao", "especial"]}}}}},
    TOOLS[1], TOOLS[2],
]
HI_RESULT = {"grupos": [
    {"manter": "09_GATILHO_beijo_discreto_1", "duplicados": ["10_GATILHO_beijo_discreto_2", "31_GATILHO_beijo_discreto_var5"]},
    {"manter": "20_GATILHO_beijo_discreto_var3", "duplicados": ["21_GATILHO_beijo_discreto_var4"]}],
    "sugestao_arquivar": ["10_GATILHO_beijo_discreto_2", "31_GATILHO_beijo_discreto_var5", "21_GATILHO_beijo_discreto_var4"],
    "sem_duplicata": ["30_GATILHO_beijo_aceno_discreto"]}
GROUP_A = {"09_GATILHO_beijo_discreto_1", "10_GATILHO_beijo_discreto_2", "31_GATILHO_beijo_discreto_var5"}
GROUP_B = {"20_GATILHO_beijo_discreto_var3", "21_GATILHO_beijo_discreto_var4"}


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def grade_archive(ids: list[str]) -> str:
    ids = set(ids)
    if "30_GATILHO_beijo_aceno_discreto" in ids:
        return "errado (arquivou o único)"
    if len(ids & GROUP_A) == 2 and len(ids & GROUP_B) == 1 and len(ids) == 3:
        return "correto"
    return f"parcial ({len(ids)} ids)"


def run(model: Path, label: str, ngl: int, tool_trials: int, design: str = "baixo", skip_chat: bool = False) -> dict:
    port, key = free_port(), secrets.token_hex(16)
    free_before = free_ram_gb()
    args = [str(SERVER), "-m", str(model), "--host", "127.0.0.1", "--port", str(port), "--api-key", key,
            "-c", "4096", "-ngl", str(ngl), "--jinja", "--no-webui"]
    t0 = time.perf_counter()
    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
    base = f"http://127.0.0.1:{port}"
    headers = {"Authorization": f"Bearer {key}"}
    out = {"model": label, "device": "GPU integrada (Vulkan)" if ngl else "CPU", "free_ram_before_GB": round(free_before, 1)}
    try:
        with httpx.Client(timeout=600, headers=headers) as c:
            while True:
                if proc.poll() is not None:
                    out["error"] = "servidor encerrou: " + (proc.stderr.read()[-800:] if proc.stderr else "")
                    return out
                try:
                    if c.get(f"{base}/health", timeout=1).status_code == 200:
                        break
                except httpx.HTTPError:
                    pass
                time.sleep(0.25)
            out["load_s"] = round(time.perf_counter() - t0, 1)
            out["rss_GB"] = round(rss_gb(proc.pid), 2)

            # --- Chat da live (3 mensagens; a 1ª aquece) ---
            chat = []
            for user, text in ([] if skip_chat else CHAT_MSGS):
                t = time.perf_counter()
                r = c.post(f"{base}/v1/chat/completions", json={
                    "messages": [{"role": "system", "content": PERSONA}, {"role": "user", "content": f"{user}: {text}"}],
                    "max_tokens": 80, "temperature": 0.7}).json()
                tm = r.get("timings", {})
                chat.append({"wall_s": round(time.perf_counter() - t, 1), "gen_tok_s": round(tm.get("predicted_per_second", 0), 1),
                             "prompt_tok_s": round(tm.get("prompt_per_second", 0), 1), "tokens": tm.get("predicted_n"),
                             "reply": r["choices"][0]["message"].get("content", "")[:140]})
            out["chat"] = chat

            # --- Tool calling em 2 turnos ---
            tools = TOOLS_HI if design == "alto" else TOOLS
            result = HI_RESULT if design == "alto" else LIB_RESULT
            out["tool_design"] = design
            trials = []
            for _ in range(tool_trials):
                msgs = [{"role": "system", "content": SYS_TOOLS}, {"role": "user", "content": USER_TOOLS}]
                t = time.perf_counter()
                r1 = c.post(f"{base}/v1/chat/completions", json={"messages": msgs, "tools": tools, "temperature": 0.2, "max_tokens": 300}).json()
                m1 = r1["choices"][0]["message"]
                calls1 = m1.get("tool_calls") or []
                trial = {"t1_s": round(time.perf_counter() - t, 1), "t1_call": [x["function"]["name"] for x in calls1]}
                if calls1:
                    msgs += [m1, {"role": "tool", "tool_call_id": calls1[0].get("id", "0"), "content": json.dumps(result, ensure_ascii=False)}]
                    t = time.perf_counter()
                    r2 = c.post(f"{base}/v1/chat/completions", json={"messages": msgs, "tools": tools, "temperature": 0.2, "max_tokens": 300}).json()
                    m2 = r2["choices"][0]["message"]
                    calls2 = m2.get("tool_calls") or []
                    trial["t2_s"] = round(time.perf_counter() - t, 1)
                    archive = [json.loads(x["function"]["arguments"]).get("ids", []) for x in calls2 if x["function"]["name"] == "library_archive_videos"]
                    trial["t2"] = grade_archive(archive[0]) if archive else "não chamou a ferramenta"
                    if archive:
                        trial["t2_ids"] = archive[0]
                else:
                    trial["t2"] = "turno 1 falhou"
                trials.append(trial)
            out["tools"] = trials
            out["rss_after_GB"] = round(rss_gb(proc.pid), 2)
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
    return out


if __name__ == "__main__":
    model, label, ngl, trials = Path(sys.argv[1]), sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
    design = sys.argv[5] if len(sys.argv) > 5 else "baixo"
    skip_chat = len(sys.argv) > 6 and sys.argv[6] == "sem-chat"
    print(json.dumps(run(model, label, ngl, trials, design, skip_chat), ensure_ascii=False))
