import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from omniops.private_tls_config import read_master_settings


class PrivateTlsConfigTests(unittest.TestCase):
    def test_reads_only_an_explicit_private_master_and_existing_port(self):
        with tempfile.TemporaryDirectory() as folder:
            env = Path(folder) / 'master.env'
            env.write_text('OMNIOPS_BIND_HOST=172.19.30.100\nOMNIOPS_PORT=9000\n', encoding='utf-8')
            if os.name != 'nt':
                env.chmod(0o600)
            self.assertEqual(read_master_settings(env), ('172.19.30.100', 9000))
            result = subprocess.run([sys.executable, '-m', 'omniops.private_tls_config', str(env)],
                                    capture_output=True, text=True)
            self.assertEqual((result.returncode, result.stdout.strip()), (0, '172.19.30.100|9000'))
            for address in ('127.0.0.1', '8.8.8.8', '0.0.0.0'):
                env.write_text(f'OMNIOPS_BIND_HOST={address}\nOMNIOPS_PORT=9000\n', encoding='utf-8')
                with self.subTest(address=address), self.assertRaises(ValueError):
                    read_master_settings(env)
