from typing import Mapping

from .config import load_settings
from .domain import TicketService
from .plugins import load_notifier
from .repository import InMemoryTicketRepository


def build_service() -> TicketService:
    settings = load_settings()
    repository = InMemoryTicketRepository()
    notifier = load_notifier(settings.notification_module)
    return TicketService(repository, notifier)


def create_ticket_endpoint(payload: Mapping[str, object]) -> dict[str, object]:
    title = payload.get("title")
    if not isinstance(title, str):
        raise ValueError("title must be a string")
    ticket = build_service().create_ticket(title)
    return {"id": ticket.identifier, "title": ticket.title}
