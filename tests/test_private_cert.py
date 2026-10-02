import hashlib
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


@unittest.skipUnless(shutil.which('bash') and shutil.which('openssl'), 'Bash and OpenSSL required on CI Linux')
class PrivateCertificateTests(unittest.TestCase):
    def test_private_certificate_matches_ip_and_reuses_ca_and_leaf(self):
        helper = Path(__file__).resolve().parents[1] / 'scripts' / 'create-private-master-cert.sh'
        with tempfile.TemporaryDirectory() as directory:
            command = ['bash', str(helper), '172.19.30.100', directory]
            subprocess.run(command, check=True, capture_output=True, text=True)
            ca = Path(directory) / 'ca.crt'
            leaf = Path(directory) / 'master.crt'
            before = (hashlib.sha256(ca.read_bytes()).digest(), hashlib.sha256(leaf.read_bytes()).digest())
            subprocess.run(command, check=True, capture_output=True, text=True)
            self.assertEqual(before, (hashlib.sha256(ca.read_bytes()).digest(), hashlib.sha256(leaf.read_bytes()).digest()))
            subprocess.run(['openssl', 'verify', '-CAfile', str(ca), '-verify_ip', '172.19.30.100',
                            '-purpose', 'sslserver', str(leaf)], check=True, capture_output=True)
            self.assertNotEqual(subprocess.run(['openssl', 'verify', '-CAfile', str(ca), '-verify_ip',
                                                '172.19.30.99', str(leaf)], capture_output=True).returncode, 0)
            self.assertNotEqual(subprocess.run(['bash', str(helper), '8.8.8.8', directory],
                                                capture_output=True).returncode, 0)
