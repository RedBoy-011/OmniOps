"""Sakhte hesab-e aval-e modir faghat az terminal-e haman server."""

import getpass
import os
from pathlib import Path

from .identity import IdentityStore


def main():
    signing_key = os.environ.get("OMNIOPS_SIGNING_KEY", "").encode()
    if len(signing_key) < 32:
        raise SystemExit("OMNIOPS_SIGNING_KEY bayad yek kelid-e yektaye 32+ character bashad")
    db_path = Path(os.environ.get("OMNIOPS_DB_PATH", "data/identity.db"))
    db_path.parent.mkdir(parents=True, exist_ok=True)
    username = input("Namn-e karbari-e SuperAdmin: ").strip()
    mobile = input("Shomare mobile: ").strip()
    password = getpass.getpass("Ramz-e oboor (hadeaghal 12 neveshe): ")
    confirm = getpass.getpass("Tekrare ramz: ")
    if password != confirm:
        raise SystemExit("Ramzha yeksan nistand")
    IdentityStore(db_path, signing_key).bootstrap_admin(username, password, mobile)
    print("Hesab-e aval-e SuperAdmin sakhte shod.")


if __name__ == "__main__":
    main()
