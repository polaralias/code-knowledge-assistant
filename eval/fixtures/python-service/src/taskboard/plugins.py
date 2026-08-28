from importlib import import_module

from .domain import Notifier


def load_notifier(module_name: str | None) -> Notifier | None:
    if module_name is None:
        return None
    module = import_module(module_name)
    factory = getattr(module, "create_notifier")
    return factory()
