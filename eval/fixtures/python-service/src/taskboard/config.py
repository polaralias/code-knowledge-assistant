from dataclasses import dataclass
from os import environ


@dataclass(frozen=True)
class Settings:
    notification_module: str | None
    project_name: str


def load_settings() -> Settings:
    return Settings(
        notification_module=environ.get("TASKBOARD_NOTIFICATION_MODULE"),
        project_name=environ.get("TASKBOARD_PROJECT", "fixture"),
    )
