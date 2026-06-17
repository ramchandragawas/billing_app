from __future__ import annotations

import os

import uvicorn


def _env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def main() -> None:
    host = os.getenv("BILLING_HOST", "0.0.0.0")
    port = int(os.getenv("PORT", os.getenv("BILLING_PORT", "8000")))
    reload_enabled = _env_flag("BILLING_RELOAD", default=False)
    uvicorn.run("billing_app.main:app", host=host, port=port, reload=reload_enabled)


if __name__ == "__main__":
    main()
