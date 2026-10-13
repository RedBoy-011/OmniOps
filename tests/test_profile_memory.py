import tempfile
import unittest
from pathlib import Path
from omniops.identity import IdentityStore, IdentityError
from omniops.profile_memory import ProfileMemory


class ProfileMemoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = IdentityStore(Path(self.tmp.name) / 'test.db', b'x' * 32)
        self.store.bootstrap_admin('admin', 'valid admin password 123', '09123456789')
        self.memory = ProfileMemory(self.store)
        self.one = self.store.login('admin', 'valid admin password 123')['user']
        self.two = {'id': 'other', 'capabilities': ['chat']}

    def test_notes_and_history_isolated_and_cleared(self):
        self.assertEqual(self.memory.history(self.one), [])
        self.memory.remember_chat(self.one, 'hello', 'world', 'ollama/test')
        self.assertEqual(len(self.memory.history(self.one)), 1)
        self.assertEqual(self.memory.history(self.two), [])
        note_id = self.memory.add_note(self.one, 'My preferred locale is fa-IR')
        self.assertEqual(self.memory.notes(self.two), [])
        with self.assertRaises(IdentityError):
            self.memory.remove_note(self.two, note_id)
        self.memory.remove_note(self.one, note_id)
        self.memory.delete_history(self.one)
        self.assertEqual(self.memory.history(self.one), [])
        self.assertEqual(self.memory.notes(self.one), [])

    def test_chat_capability_and_input_bounds(self):
        with self.assertRaises(IdentityError):
            self.memory.add_note({'id': self.one['id'], 'capabilities': []}, 'private')
        with self.assertRaises(IdentityError):
            self.memory.add_note(self.one, 'x' * 501)

    def test_multi_session_creation_isolation_and_rename(self):
        s1 = self.memory.create_session(self.one, "پروژه پایتون")
        s2 = self.memory.create_session(self.one, "دیباگ داکر")

        sessions = self.memory.list_sessions(self.one)
        self.assertEqual(len(sessions), 2)
        self.assertEqual({s["title"] for s in sessions}, {"پروژه پایتون", "دیباگ داکر"})

        self.memory.remember_chat(self.one, "prompt 1", "reply 1", "ollama/test", session_id=s1["id"])
        self.memory.remember_chat(self.one, "prompt 2", "reply 2", "ollama/test", session_id=s2["id"])

        hist1 = self.memory.history(self.one, session_id=s1["id"])
        hist2 = self.memory.history(self.one, session_id=s2["id"])
        self.assertEqual(len(hist1), 1)
        self.assertEqual(hist1[0]["prompt"], "prompt 1")
        self.assertEqual(len(hist2), 1)
        self.assertEqual(hist2[0]["prompt"], "prompt 2")

        renamed = self.memory.rename_session(self.one, s1["id"], "پروژه پایتون پیشرفته")
        self.assertEqual(renamed["title"], "پروژه پایتون پیشرفته")

        self.memory.delete_session(self.one, s1["id"])
        remaining = self.memory.list_sessions(self.one)
        self.assertEqual(len(remaining), 1)
        self.assertEqual(remaining[0]["id"], s2["id"])
        self.assertEqual(len(self.memory.history(self.one, session_id=s1["id"])), 0)
        self.assertEqual(len(self.memory.history(self.one, session_id=s2["id"])), 1)

