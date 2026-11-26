from __future__ import annotations


class AccountSyncProvider:
    """
    AQA NEA note: extension point for future internal account sync / SSO integration.
    This project currently ships with a no-op implementation (no live SSO).
    """

    name = "noop"

    def status(self) -> dict:
        return {
            "provider": self.name,
            "sso_enabled": False,
            "account_sync_enabled": False,
            "note": "Placeholder only. No production SSO/account sync is implemented.",
        }


def get_account_sync_provider() -> AccountSyncProvider:
    return AccountSyncProvider()
