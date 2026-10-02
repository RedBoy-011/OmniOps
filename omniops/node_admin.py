"""Interactive grant issuer over verified private TLS; web credentials stay in RAM."""

import argparse
import getpass

from .node_client import NodeClient


def main():
    parser = argparse.ArgumentParser(description='Issue a one-use node grant over verified TLS')
    parser.add_argument('--master', required=True)
    parser.add_argument('--ca-file', required=True)
    parser.add_argument('--role', choices=('worker', 'edge'), required=True)
    args = parser.parse_args()
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
