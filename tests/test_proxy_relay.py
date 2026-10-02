import argparse
import socket
import socketserver
import threading
import unittest
from omniops.proxy_relay import RelayServer, private_ipv4


class Echo(socketserver.BaseRequestHandler):
    def handle(self):
        while data := self.request.recv(4096):
            self.request.sendall(data)


class RelayTests(unittest.TestCase):
    def test_master_only_and_bidirectional_relay(self):
        with socketserver.ThreadingTCPServer(('127.0.0.1', 0), Echo) as upstream, \
             RelayServer(('127.0.0.1', 0), upstream.server_address, '127.0.0.1') as relay:
            threads = [threading.Thread(target=service.serve_forever, daemon=True)
                       for service in (upstream, relay)]
            for thread in threads:
                thread.start()
            try:
                with socket.create_connection(relay.server_address, timeout=2) as client:
                    client.settimeout(2)
                    client.sendall(b'socks-like hello')
                    self.assertEqual(client.recv(20), b'socks-like hello')
                relay.allowed_client = '127.0.0.2'
                with socket.create_connection(relay.server_address, timeout=2) as client:
                    client.settimeout(2)
                    self.assertEqual(client.recv(1), b'')
            finally:
                for service in (upstream, relay):
                    service.shutdown()
                for thread in threads:
                    thread.join(timeout=2)

    def test_ip_validation(self):
        for value in ('8.8.8.8', '0.0.0.0', 'not-an-ip', '::1'):
            with self.assertRaises((ValueError, argparse.ArgumentTypeError)):
                private_ipv4(value)
        self.assertEqual(private_ipv4('172.19.30.99'), '172.19.30.99')
