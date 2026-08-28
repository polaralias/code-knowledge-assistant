from taskboard.api import create_ticket_endpoint


def test_endpoint_creates_a_ticket() -> None:
    assert create_ticket_endpoint({"title": "Document the flow"}) == {
        "id": 1,
        "title": "Document the flow",
    }
