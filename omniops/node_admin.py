"""Interactive grant issuer over verified private TLS; web credentials stay in RAM."""

import argparse
import getpass
from pathlib import Path

from .identity import IdentityStore
from .nodes import NodeRegistry
from scripts.upgrade_config import parse_environment_file

from .node_client import NodeClient


def main():
    parser = argparse.ArgumentParser(description='Issue a one-use node grant over verified TLS')
    parser.add_argument('--master')
    parser.add_argument('--ca-file')
    parser.add_argument('--local-root', action='store_true', help='Issue locally from the Master root shell')
    parser.add_argument('--raw', action='store_true', help='Print only the short-lived grant for an SSH pipe')
    parser.add_argument('--token', action='store_true', help='Generate full join token and ready-to-run curl command')
    parser.add_argument('--role', choices=('worker', 'edge'), required=True)
    args = parser.parse_args()
    if args.local_root:
        if args.master or args.ca_file:
            parser.error('Local root mode does not use remote TLS options')
        config = Path('/etc/omniops/master.env')
        values = parse_environment_file(config)
        if config.stat().st_mode & 0o077:
            parser.error('Master environment file must be owner-only')
        store = IdentityStore(values['OMNIOPS_DB_PATH'], values['OMNIOPS_SIGNING_KEY'].encode())
        issued = NodeRegistry(store).issue_local_root(args.role)
        if args.token:
            bind_host = values.get('OMNIOPS_BIND_HOST', '127.0.0.1')
            tls_port = "9443"
            tls_unit = Path('/etc/systemd/system/omniops-master-tls.service')
            if tls_unit.exists():
                for line in tls_unit.read_text().splitlines():
                    if "OMNIOPS_PORT=" in line:
                        import re
                        m = re.search(r'OMNIOPS_PORT=(\d+)', line)
                        if m:
                            tls_port = m.group(1)
            master_url = f"https://{bind_host}:{tls_port}"

            ca_path = Path('/etc/omniops/private-pki/ca.crt')
            ca_crt = ""
            ca_fingerprint = ""
            if ca_path.exists():
                ca_crt = ca_path.read_text(encoding='utf-8')
                import subprocess
                cmd = f"openssl x509 -in {ca_path} -outform DER | openssl dgst -sha256"
                res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
                if res.stdout:
                    ca_fingerprint = res.stdout.strip().split()[-1].lower()

            import json, base64
            payload = {
                "version": 1,
                "role": args.role,
                "master_url": master_url,
                "grant": issued['grant'],
                "expires_at": issued['expires_at'],
                "ca_crt": ca_crt,
                "ca_fingerprint": ca_fingerprint
            }
            token_str = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()
            join_token = f"omniops_{args.role}_{token_str}"

            if args.raw:
                print(join_token)
            else:
                script_name = "setup-worker.sh" if args.role == "worker" else "setup-edge.sh"
                print("\n" + "=" * 72)
                print(f"       توکن تبادل و اتصال یکپارچه OmniOps برای نقش {args.role.upper()}")
                print("=" * 72)
                print(f"\nتوکن تبادل ({args.role}):")
                print(join_token)
                print(f"\nدستور آماده برای اجرا روی سرور {args.role.upper()} (کپی و اجرا کنید):")
                print(f"curl -fsSL https://raw.githubusercontent.com/RedBoy-011/OmniOps/main/scripts/{script_name} | bash -s -- --token {join_token}")
                print("=" * 72 + "\n")
            return
        if args.raw:
            print(issued['grant'])
        else:
            print('One-time local root grant:', issued['grant'])
            print('Expires at Unix time:', issued['expires_at'])
        return
    if args.raw or not args.master or not args.ca_file:
        parser.error('Remote mode requires --master and --ca-file; --raw is local-root only')
    client = NodeClient(args.master, args.ca_file)
    username = input('SuperAdmin username: ').strip()
    password = getpass.getpass('SuperAdmin password: ')
    try:
        login = client.request('/api/auth/login', {'username': username, 'password': password})
    finally:
        password = None
    issued = client.request('/api/admin/nodes/grants', {'role': args.role}, login['token'])
    print('One-time grant (enter on the matching node within 10 minutes):', issued['grant'])
    print('Expires at Unix time:', issued['expires_at'])


if __name__ == '__main__':
    main()
