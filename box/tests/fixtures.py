"""Synthetic data only. Production startup must never create these accounts."""
from backend.domain import Store


def populated_store(path=":memory:"):
    store = Store(path)
    center = store.create_gym("Test Center", "test-center")
    for username, password, role in (("owner", "Owner!123", "OWNER"), ("member", "Member!123", "MEMBER")):
        account = store.create_user(username, password, role, username, center.id)
        store.create_profile(account, "", "", "")
    return store
