import importlib.util
import sqlite3
import tempfile
from contextlib import closing
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "diagnose-ubuntu.py"
spec = importlib.util.spec_from_file_location("omniops_diagnose", SCRIPT)
diagnose = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnose)


class HealthyServices(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        body = b'{"status":"up"}' if self.path == "/health" else b'{"models":[{"name":"test:1b","size":1}]}'
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class UbuntuDiagnosticsTests(unittest.TestCase):
    def test_reads_persisted_worker_and_never_discloses_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            db_path = Path(directory) / "identity.db"
            with closing(sqlite3.connect(db_path)) as db:
                db.execute("CREATE TABLE settings (name TEXT PRIMARY KEY, value TEXT)")
            master = ThreadingHTTPServer(("127.0.0.1", 0), HealthyServices)
            worker = ThreadingHTTPServer(("127.0.0.1", 0), HealthyServices)
            threads = [threading.Thread(target=server.serve_forever, daemon=True) for server in (master, worker)]
            for thread in threads:
                thread.start()
            try:
                worker_url = f"http://127.0.0.1:{worker.server_port}"
                with closing(sqlite3.connect(db_path)) as db:
                    db.execute("INSERT INTO settings VALUES ('ollama_endpoint', ?)", (worker_url,))
                    db.commit()
                config = Path(directory) / "master.env"
                config.write_text(f"OMNIOPS_DB_PATH={db_path.as_posix()}\nOMNIOPS_BIND_HOST=127.0.0.1\nOMNIOPS_PORT={master.server_port}\nOMNIOPS_API_KEY=secret-value\n", encoding="utf-8")
                with patch.object(diagnose.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout="active\n")):
                    result, status = diagnose.inspect(config)
                self.assertEqual(status, 0, result)
                self.assertEqual(result["models"], ["test:1b"])
                self.assertEqual(result["database"], "ok")
                self.assertNotIn("secret-value", str(result))
                worker.shutdown()
                worker.server_close()
                threads[1].join(timeout=2)
                with patch.object(diagnose.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout="active\n")):
                    offline, status = diagnose.inspect(config)
                self.assertEqual((status, offline["master"], offline["worker"]), (2, "up", "unreachable"))
            finally:
                master.shutdown()
                master.server_close()
                threads[0].join(timeout=2)
                if threads[1].is_alive():
                    worker.shutdown()
                    worker.server_close()
                    threads[1].join(timeout=2)


if __name__ == "__main__":
    unittest.main()
