from typing import Any, List


class AIUnavailableError(RuntimeError):
    """Nenhum provedor de IA respondeu. `errors` traz o motivo de cada um."""

    def __init__(self, errors: List[str]):
        self.errors = [str(item)[:300] for item in errors]
        super().__init__("IA indisponivel: " + " | ".join(self.errors))

    def to_detail(self) -> dict[str, Any]:
        return {"code": "ai_unavailable", "message": "A IA nao respondeu.", "errors": self.errors}
