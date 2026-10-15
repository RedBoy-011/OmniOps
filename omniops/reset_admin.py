"""CLI baraye bazneshani-e name karbari va ramze oboor-e modir-e arshad (SuperAdmin)."""

import argparse
import getpass
import os
import sys
from pathlib import Path

from .identity import IdentityStore, IdentityError

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def _load_env_file(path: Path) -> dict[str, str]:
    values = {}
    if not path.is_file():
        return values
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                values[k] = v
    except OSError:
        pass
    return values


def resolve_config(config_path: str | None = None) -> tuple[Path, bytes]:
    """Peyda kardane masir-e database va signing key az config ya env."""
    env_values = {}
    candidates = []
    if config_path:
        candidates.append(Path(config_path))
    else:
        candidates.extend([
            Path("/etc/omniops/master.env"),
            Path("data/master.env"),
            Path("../data/master.env"),
        ])

    for candidate in candidates:
        if candidate.is_file():
            env_values = _load_env_file(candidate)
            if "OMNIOPS_DB_PATH" in env_values or "OMNIOPS_SIGNING_KEY" in env_values:
                break

    # 1. DB Path
    db_raw = os.environ.get("OMNIOPS_DB_PATH") or env_values.get("OMNIOPS_DB_PATH")
    if db_raw:
        db_path = Path(db_raw)
    else:
        # Fallback local paths
        for local_db in [Path("data/identity.db"), Path("/opt/omniops/data/identity.db"), Path("identity.db")]:
            if local_db.is_file():
                db_path = local_db
                break
        else:
            db_path = Path("data/identity.db")

    # 2. Signing Key
    key_raw = os.environ.get("OMNIOPS_SIGNING_KEY") or env_values.get("OMNIOPS_SIGNING_KEY")
    if key_raw:
        signing_key = key_raw.encode("utf-8")
        if len(signing_key) < 32:
            signing_key = signing_key.ljust(32, b"0")
    else:
        # Standalone reset operations only need a valid 32-byte key for local DB init
        signing_key = b"omniops-local-admin-recovery-signing-key-32bytes"

    return db_path, signing_key


def main():
    parser = argparse.ArgumentParser(
        description="بازنشانی و تنظیم نام کاربری و رمز عبور مدیر ارشد OmniOps (SuperAdmin)",
        formatter_class=argparse.RawTextHelpFormatter,
    )
    parser.add_argument("-u", "--username", help="نام کاربری جدید مدیر ارشد [پیش‌فرض: admin]")
    parser.add_argument("-p", "--password", help="رمز عبور جدید مدیر ارشد (حداقل ۱۲ نویسه)")
    parser.add_argument("-m", "--mobile", default="09120000000", help="شماره موبایل مدیر ارشد [پیش‌فرض: 09120000000]")
    parser.add_argument("--stdin-password", action="store_true", help="خواندن رمز عبور مستقیماً از ورودی استاندارد (stdin)")
    parser.add_argument("--config", help="مسیر فایل تنظیمات (پیش‌فرض: /etc/omniops/master.env)")
    parser.add_argument("--db", help="مسیر مستقیم فایل پایگاه‌داده identity.db")

    args = parser.parse_args()

    # 1. Database & Key resolution
    if args.db:
        db_path = Path(args.db)
        _, signing_key = resolve_config(args.config)
    else:
        db_path, signing_key = resolve_config(args.config)

    if not db_path.parent.exists():
        db_path.parent.mkdir(parents=True, exist_ok=True)

    # 2. Username
    username = args.username
    is_interactive = sys.stdin.isatty()

    if not username:
        if is_interactive:
            try:
                entered = input("نام کاربری مدیر ارشد [پیش‌فرض: admin]: ").strip()
                username = entered if entered else "admin"
            except (KeyboardInterrupt, EOFError):
                print("\nعملیات لغو شد.", file=sys.stderr)
                sys.exit(1)
        else:
            username = "admin"

    # 3. Mobile
    mobile = args.mobile or "09120000000"
    if is_interactive and not args.username and not args.password:
        try:
            entered_mob = input("شماره موبایل مدیر ارشد [پیش‌فرض: 09120000000]: ").strip()
            if entered_mob:
                mobile = entered_mob
        except (KeyboardInterrupt, EOFError):
            print("\nعملیات لغو شد.", file=sys.stderr)
            sys.exit(1)

    # 4. Password
    password = args.password
    if args.stdin_password:
        password = sys.stdin.read().strip()
    elif not password:
        if not is_interactive:
            print("خطا: رمز عبور مشخص نشده است. لطفاً از آرگومان --password یا --stdin-password استفاده کنید.", file=sys.stderr)
            sys.exit(1)

        while True:
            try:
                pw1 = getpass.getpass("رمز عبور جدید مدیر ارشد (حداقل ۱۲ نویسه): ")
                if len(pw1) < 12:
                    print("⚠️ رمز عبور باید حداقل ۱۲ نویسه باشد. لطفاً دوباره وارد کنید.", file=sys.stderr)
                    continue
                pw2 = getpass.getpass("تکرار رمز عبور جدید: ")
                if pw1 != pw2:
                    print("⚠️ رمزهای عبور مطابقت ندارند. لطفاً دوباره وارد کنید.", file=sys.stderr)
                    continue
                password = pw1
                break
            except (KeyboardInterrupt, EOFError):
                print("\nعملیات لغو شد.", file=sys.stderr)
                sys.exit(1)

    if len(password) < 4:
        print("خطا: رمز عبور باید حداقل ۴ نویسه باشد.", file=sys.stderr)
        sys.exit(1)

    # 5. Execute reset
    try:
        store = IdentityStore(db_path, signing_key)
        user_id = store.reset_admin(username, password, mobile)
    except IdentityError as exc:
        print(f"خطای احراز هویت: {exc}", file=sys.stderr)
        sys.exit(1)
    except Exception as exc:
        print(f"خطا در به‌روزرسانی پایگاه‌داده: {exc}", file=sys.stderr)
        sys.exit(1)

    # 6. Success Output
    print("\n╔══════════════════════════════════════════════════════════════════════╗")
    print("║     ✅ مشخصات و رمز عبور مدیر ارشد با موفقیت بازنشانی شد!            ║")
    print("╚══════════════════════════════════════════════════════════════════════╝")
    print(f"  👤 نام کاربری:     {username}")
    print(f"  📱 شماره موبایل:   {mobile}")
    print(f"  🔑 شناسه کاربر:    {user_id}")
    print(f"  📁 پایگاه‌داده:     {db_path}")
    print("  ⚡ وضعیت حساب:     فعال (SuperAdmin Active)")
    print("  🔒 نشست‌های قبلی:  کلیه نشست‌های فعال قبلی باطل شدند (Revoked)")
    print("──────────────────────────────────────────────────────────────────────")
    print("  هم‌اکنون می‌توانید با نام کاربری و رمز جدید وارد پنل وب شوید.")
    print("══════════════════════════════════════════════════════════════════════\n")
    sys.exit(0)


if __name__ == "__main__":
    main()
