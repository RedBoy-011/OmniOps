"""A source-restricted TCP bridge from Master to the private upstream SOCKS server."""

import argparse
import ipaddress
import selectors
import socket
import socketserver
import threading


class RelayServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True
    block_on_close = False
    request_queue_size = 16

    def __init__(self, listen, upstream, allowed_client, maximum=16):
        self.upstream = upstream
        self.allowed_client = allowed_client
        self.slots = threading.BoundedSemaphore(maximum)
        super().__init__(listen, RelayHandler)

    def process_request(self, request, client_address):
        if client_address[0] != self.allowed_client or not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()


class RelayHandler(socketserver.BaseRequestHandler):
    def handle(self):
        try:
            upstream = socket.create_connection(self.server.upstream, timeout=8)
            with upstream, selectors.DefaultSelector() as selector:
                self.request.settimeout(20)
                upstream.settimeout(20)
                selector.register(self.request, selectors.EVENT_READ, upstream)
                selector.register(upstream, selectors.EVENT_READ, self.request)
                while selector.get_map():
                    events = selector.select(timeout=120)
                    if not events:
                        break
                    for key, _ in events:
                        source, destination = key.fileobj, key.data
                        chunk = source.recv(65536)
                        if chunk:
                            destination.sendall(chunk)
                        else:
                            selector.unregister(source)
                            try:
                                destination.shutdown(socket.SHUT_WR)
                            except OSError:
                                pass
        except (OSError, ValueError):
            pass


def private_ipv4(value):
    address = ipaddress.ip_address(value)
    if address.version != 4 or not address.is_private or address.is_unspecified:
        raise argparse.ArgumentTypeError('Private IPv4 required')
    return str(address)


def main():
    parser = argparse.ArgumentParser(description='Private Master-to-Worker SOCKS TCP relay')
    parser.add_argument('--listen', type=private_ipv4, required=True)
    parser.add_argument('--allow', type=private_ipv4, required=True)
    parser.add_argument('--upstream', type=private_ipv4, required=True)
    parser.add_argument('--port', type=int, default=17890)
    parser.add_argument('--upstream-port', type=int, default=7890)
    args = parser.parse_args()
    if args.listen == args.allow or not 1024 <= args.port <= 65535 or not 1 <= args.upstream_port <= 65535:
        parser.error('Invalid relay IP or port')
    with RelayServer((args.listen, args.port), (args.upstream, args.upstream_port), args.allow) as server:
        server.serve_forever(poll_interval=0.5)


if __name__ == '__main__':
    main()
