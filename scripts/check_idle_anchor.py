"""
check_idle_anchor.py — valida se os clipes começam E terminam na pose âncora.

Um clipe só entra no pool de IDLE se o primeiro e o último frame forem
praticamente iguais ao frame âncora da persona (assets/idle-kit/<persona>/A0_camera.png).
Sem --anchor, usa o frame do formato antigo (assets/idle-kit/_formato_antigo/).
Assim qualquer clipe pode seguir qualquer outro sem "pulo" no crossfade.

Uso:
    python scripts/check_idle_anchor.py                       # todos em assets/videos
    python scripts/check_idle_anchor.py caminho/clip.mp4 ...  # arquivos específicos
    python scripts/check_idle_anchor.py --anchor assets/idle-kit/barbara/A1_chat.png clip.mp4

Também aponta arquivos duplicados (mesmo conteúdo com nomes diferentes).
Requer ffmpeg no PATH.
"""
import argparse
import hashlib
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ANCHOR = ROOT / "assets" / "idle-kit" / "_formato_antigo" / "A0_ancora_master.png"
DEFAULT_DIR = ROOT / "assets" / "videos"

# PSNR (dB) contra a âncora. >= 38 é imperceptível num crossfade curto;
# 32–38 aparece como leve "respiro"; abaixo disso o pulo é visível.
OK_DB = 38.0
WARN_DB = 32.0


def _frame(video: Path, out: Path, last: bool) -> None:
    cmd = ["ffmpeg", "-v", "error", "-y"]
    if last:
        cmd += ["-sseof", "-0.1"]
    cmd += ["-i", str(video), "-frames:v", "1", str(out)]
    subprocess.run(cmd, check=True)


def _psnr(a: Path, b: Path) -> float:
    proc = subprocess.run(
        ["ffmpeg", "-i", str(a), "-i", str(b), "-lavfi", "[0][1]scale2ref[x][y];[x][y]psnr", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    match = re.search(r"average:(inf|[0-9.]+)", proc.stderr)
    if not match:
        return 0.0
    return 99.0 if match.group(1) == "inf" else float(match.group(1))


def _grade(db: float) -> str:
    if db >= OK_DB:
        return "ok"
    if db >= WARN_DB:
        return "leve"
    return "PULO"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("videos", nargs="*", type=Path)
    parser.add_argument("--anchor", type=Path, default=DEFAULT_ANCHOR)
    args = parser.parse_args()

    videos = args.videos or sorted(DEFAULT_DIR.glob("*.mp4"))
    if not args.anchor.exists():
        print(f"Âncora não encontrada: {args.anchor}", file=sys.stderr)
        return 2

    hashes: dict[str, list[str]] = {}
    failures = 0
    print(f"Âncora: {args.anchor.relative_to(ROOT) if args.anchor.is_relative_to(ROOT) else args.anchor}")
    print(f"{'clipe':<52} {'início':>8} {'fim':>8}  status")
    with tempfile.TemporaryDirectory() as tmp:
        first, last = Path(tmp) / "first.png", Path(tmp) / "last.png"
        for video in videos:
            digest = hashlib.md5(video.read_bytes()).hexdigest()
            hashes.setdefault(digest, []).append(video.name)
            _frame(video, first, last=False)
            _frame(video, last, last=True)
            db_first, db_last = _psnr(first, args.anchor), _psnr(last, args.anchor)
            status = f"{_grade(db_first)}/{_grade(db_last)}"
            if "PULO" in status:
                failures += 1
            print(f"{video.name:<52} {db_first:>7.1f}  {db_last:>7.1f}  {status}")

    dupes = [names for names in hashes.values() if len(names) > 1]
    if dupes:
        print("\nDuplicados (mesmo arquivo, nomes diferentes):")
        for names in dupes:
            print("  = " + "  ".join(names))

    print(f"\n{failures} clipe(s) com pulo visível contra a âncora.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
