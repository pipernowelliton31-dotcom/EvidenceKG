"""Settings copied between Windows accounts must remain recoverable."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import api_config, server


class APIConfigRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.path = self.directory / 'local_api.json'
        self.original = json.dumps({'base': 'https://example.com/v1', 'model': 'test-model',
                                    'effort': '', 'protected_key': 'foreign-account-blob'})
        self.path.write_text(self.original, encoding='utf-8')

    def test_unreadable_key_keeps_nonsecret_settings_and_original_file(self):
        with patch.object(api_config, 'protect', side_effect=ValueError('Cannot decrypt')):
            config = api_config.stored_settings(self.directory)
        self.assertEqual(config['model'], 'test-model')
        self.assertNotIn('key', config)
        self.assertNotIn('protected_key', config)
        self.assertTrue(config.get('key_warning'))
        self.assertEqual(self.path.read_text(encoding='utf-8'), self.original)

    def test_initial_settings_and_bootstrap_still_work_without_a_key(self):
        with patch.object(server, 'DATA', self.directory), \
             patch.object(server, 'dotenv_values', return_value={}), \
             patch.dict(server.os.environ, {'OPENROUTER_API_KEY': ''}), \
             patch.object(api_config, 'protect', side_effect=ValueError('Cannot decrypt')), \
             patch.object(server, 'projects', {}):
            public = server.get_settings()
            bootstrap = server.bootstrap()
        self.assertFalse(public['api_configured'])
        self.assertTrue(public['key_warning'])
        self.assertIn('重新', public['key_hint'])
        self.assertFalse(bootstrap['api_configured'])
        self.assertNotIn('foreign-account-blob', json.dumps(public))

    def test_valid_local_environment_key_remains_available(self):
        with patch.object(server, 'DATA', self.directory), \
             patch.object(server, 'dotenv_values', return_value={'OPENROUTER_API_KEY': 'local-test-key'}), \
             patch.dict(server.os.environ, {'OPENROUTER_API_KEY': 'local-test-key'}), \
             patch.object(api_config, 'protect', side_effect=ValueError('Cannot decrypt')):
            config = server.settings()
        self.assertEqual(config['key'], 'local-test-key')

    def test_new_key_can_replace_foreign_encrypted_key(self):
        body = server.APISettings(base='https://example.com/v1', model='test-model', key='new-local-test-key')
        def crypto(value, decrypt=False):
            if decrypt and value == 'foreign-account-blob':
                raise ValueError('Cannot decrypt')
            return 'new-local-test-key' if decrypt else 'new-local-blob'
        with patch.object(server, 'DATA', self.directory), patch.object(api_config, 'protect', side_effect=crypto):
            public = server.update_settings(body)
            loaded = api_config.stored_settings(self.directory)
        self.assertTrue(public['api_configured'])
        self.assertEqual(loaded['key'], 'new-local-test-key')
        self.assertFalse(loaded.get('key_warning'))

    def test_working_key_still_loads(self):
        with patch.object(api_config, 'protect', return_value='working-test-key'):
            config = api_config.stored_settings(self.directory)
        self.assertEqual(config['key'], 'working-test-key')
        self.assertNotIn('key_warning', config)


if __name__ == '__main__':
    unittest.main()
