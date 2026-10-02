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
