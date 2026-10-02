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
