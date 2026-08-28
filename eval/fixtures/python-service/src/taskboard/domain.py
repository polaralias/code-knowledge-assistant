from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class Ticket:
    identifier: int
    title: str


class TicketRepository(Protocol):
    def add(self, ticket: Ticket) -> None: ...

    def next_identifier(self) -> int: ...


class Notifier(Protocol):
    def ticket_created(self, ticket: Ticket) -> None: ...


class TicketService:
    def __init__(self, repository: TicketRepository, notifier: Notifier | None = None):
        self._repository = repository
        self._notifier = notifier

    def create_ticket(self, title: str) -> Ticket:
        normalized_title = title.strip()
        if not normalized_title:
            raise ValueError("title is required")
        ticket = Ticket(self._repository.next_identifier(), normalized_title)
        self._repository.add(ticket)
        if self._notifier is not None:
            self._notifier.ticket_created(ticket)
        return ticket
