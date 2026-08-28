from .domain import Ticket


class InMemoryTicketRepository:
    def __init__(self) -> None:
        self._tickets: list[Ticket] = []

    def add(self, ticket: Ticket) -> None:
        self._tickets.append(ticket)

    def next_identifier(self) -> int:
        return len(self._tickets) + 1

    def all(self) -> tuple[Ticket, ...]:
        return tuple(self._tickets)
