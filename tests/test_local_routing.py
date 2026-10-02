import unittest

from omniops.local_routing import choose_local_chat_model
from omniops.ollama import LocalModel


class LocalRoutingTests(unittest.TestCase):
    def test_short_prompt_uses_smaller_chat_model(self):
        models = (LocalModel('large:latest', 200), LocalModel('small:latest', 20))
        self.assertEqual(choose_local_chat_model(models, 'auto', 'سلام'), 'small:latest')
        self.assertEqual(choose_local_chat_model(models, 'auto', 'x' * 241), 'large:latest')

    def test_manual_selection_is_exact_and_missing_model_fails(self):
        models = (LocalModel('large:latest', 200), LocalModel('small:latest', 20))
        self.assertEqual(choose_local_chat_model(models, 'ollama/large:latest', 'سلام'), 'large:latest')
        with self.assertRaises(ValueError):
            choose_local_chat_model(models, 'ollama/embedding-only', 'سلام')
        with self.assertRaises(ValueError):
            choose_local_chat_model((), 'auto', 'سلام')
