"""Sakhte hesab-e aval-e modir faghat az terminal-e haman server."""

import getpass
import os
from pathlib import Path

from .identity import IdentityError, IdentityStore


def main():
    signing_key = os.environ.get("OMNIOPS_SIGNING_KEY", "").encode()
    if len(signing_key) < 32:
        raise SystemExit("OMNIOPS_SIGNING_KEY bayad yek kelid-e yektaye 32+ character bashad")
    db_path = Path(os.environ.get("OMNIOPS_DB_PATH", "data/identity.db"))
    db_path.parent.mkdir(parents=True, exist_ok=True)
    username = input("Namn-e karbari-e SuperAdmin: ").strip()
    mobile = input("Shomare mobile: ").strip()
    while True:
        password = getpass.getpass("Ramz-e oboor (12 ta 1024 neveshe): ")
        if not 12 <= len(password) <= 1024:
            print("Ramz bayad beyn 12 ta 1024 neveshe bashad. Dobare talash konid.")
            continue
        confirm = getpass.getpass("Tekrare ramz: ")
        if password != confirm:
            print("Ramzha yeksan nistand. Dobare talash konid.")
            continue
        break
    try:
        IdentityStore(db_path, signing_key).bootstrap_admin(username, password, mobile)
    except IdentityError as exc:
        raise SystemExit(f"Hesab-e SuperAdmin sakhte nashod: {exc}") from None
    print(f"Hesab-e SuperAdmin baraye '{username}' ba movafaghiat sakhte shod.")


if __name__ == "__main__":
    main()
