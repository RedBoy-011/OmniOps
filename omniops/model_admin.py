"""Local root model pull request for the private Master."""

import argparse
import os
from pathlib import Path

from scripts.upgrade_config import parse_environment_file
from .identity import IdentityStore
from .nodes import NodeRegistry


def main():
    parser = argparse.ArgumentParser(description='Queue one audited model pull from the Master root shell')
    parser.add_argument('--node-id', required=True)
    parser.add_argument('--model', required=True)
    args = parser.parse_args()
    if not hasattr(os, 'geteuid') or os.geteuid() != 0:
        parser.error('Local root shell required')
    config = Path('/etc/omniops/master.env')
    if config.stat().st_mode & 0o077:
        parser.error('Master environment file must be owner-only')
    values = parse_environment_file(config)
    store = IdentityStore(values['OMNIOPS_DB_PATH'], values['OMNIOPS_SIGNING_KEY'].encode())
    result = NodeRegistry(store).queue_model_pull_local_root(args.node_id, args.model)
    print('Queued model download:', result['id'])


if __name__ == '__main__':
    main()
