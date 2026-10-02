"""Read one provider key from stdin in a root-only session; never pass secrets as arguments."""

import argparse
import os
import sys
from pathlib import Path

from scripts.upgrade_config import parse_environment_file
from .identity import IdentityStore
from .providers import ProviderRegistry, ENDPOINTS


def main():
    parser = argparse.ArgumentParser(description='Configure or test a private Master API provider')
    parser.add_argument('--kind', required=True, choices=tuple(ENDPOINTS))
    parser.add_argument('--mode', choices=('direct', 'socks'), default='direct')
    parser.add_argument('--proxy', default='')
    parser.add_argument('--key-stdin', action='store_true')
    parser.add_argument('--test', action='store_true')
    parser.add_argument('--enable', action='store_true')
    args = parser.parse_args()
    if args.enable and not args.test:
        parser.error('--enable requires --test')
    if args.proxy and args.mode != 'socks':
        parser.error('--proxy requires --mode socks')
    if not args.key_stdin and not args.test:
        parser.error('Specify --key-stdin and/or --test')
    if not hasattr(os, 'geteuid') or os.geteuid() != 0:
        parser.error('Local root shell required')
    config = Path('/etc/omniops/master.env')
    if config.is_symlink() or config.stat().st_mode & 0o077:
        parser.error('Master environment file must be owner-only and not a symlink')
    values = parse_environment_file(config)
    store = IdentityStore(values['OMNIOPS_DB_PATH'], values['OMNIOPS_SIGNING_KEY'].encode())
    principal = {'id': 'system:local-root', 'role': 'superadmin', 'capabilities': ['provider.manage']}
    registry = ProviderRegistry(store)
    if args.key_stdin:
        raw = sys.stdin.readline(1100)
        key = raw.rstrip('\r\n')
        if not key:
            parser.error('API key missing on stdin')
        registry.save(principal, args.kind, key, args.mode, args.proxy)
        print('Provider configuration encrypted and saved:', args.kind)
    if args.test:
        result = registry.test(principal, args.kind)
        print('Provider catalog verified:', args.kind, 'models:', len(result['models']), 'route:', result['network_mode'])
        if args.enable and result['models']:
            registry.enable(principal, args.kind, True)
            print('Provider enabled:', args.kind)


if __name__ == '__main__':
    main()
