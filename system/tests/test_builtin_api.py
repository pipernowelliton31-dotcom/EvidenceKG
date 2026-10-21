"""Built-in evaluation credentials stay on the server and use a fixed model list."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import HTTPException
from app import api_config, server


class BuiltinAPITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.path = self.directory / 'local_api.json'
        self.values = {'BUILTIN_DEEPSEEK_API_KEY': 'test-deepseek-secret',
                       'BUILTIN_OPENROUTER_API_KEY': 'test-openrouter-secret',
                       'BUILTIN_OLLAMA_API_KEY': 'test-ollama-secret'}
        for context in [patch.object(server, 'DATA', self.directory),
                        patch.object(server, 'dotenv_values', side_effect=lambda _: self.values.copy()),
                        patch.dict(server.os.environ, {'BUILTIN_DEEPSEEK_API_KEY': '',
                                                       'BUILTIN_OPENROUTER_API_KEY': '',
                                                       'BUILTIN_OLLAMA_API_KEY': '', 'OPENROUTER_API_KEY': ''})]:
            context.start()
            self.addCleanup(context.stop)
        # Environment variables take precedence over .env, including deliberate empties.
        for name in self.values:
            server.os.environ.pop(name, None)

    def select(self, provider='deepseek', model='deepseek-flash', **extra):
        return server.update_settings(server.APISettings(
            mode='builtin', builtin_provider=provider, model=model,
            base='https://untrusted.example/v1', **extra))

    def test_defaults_and_public_settings_never_expose_credentials(self):
        public = server.get_settings()
        self.assertEqual(public['mode'], 'custom')
        self.assertEqual(public['builtin_provider'], 'deepseek')
        self.assertEqual(public['builtin_providers'][0]['models'], ['deepseek-flash'])
        self.assertTrue(all(p['configured'] for p in public['builtin_providers']))
        self.assertNotIn('test-deepseek-secret', json.dumps(public))
        self.assertNotIn('test-openrouter-secret', json.dumps(public))
        ollama = next(p for p in public['builtin_providers'] if p['id'] == 'ollama')
        self.assertEqual(ollama['models'], ['gemma4:31b'])
        self.assertNotIn('test-ollama-secret', json.dumps(public))

    def test_deepseek_routes_to_fixed_endpoint_without_persisting_secret(self):
        public = self.select()
        config = server.settings()
        self.assertEqual(config['base'], 'https://api.deepseek.com')
        self.assertEqual(config['key'], self.values['BUILTIN_DEEPSEEK_API_KEY'])
        self.assertEqual(public['model'], 'deepseek-flash')
        self.assertTrue(public['api_configured'])
        stored = json.loads(self.path.read_text(encoding='utf-8'))
        self.assertNotIn('key', stored)
        self.assertNotIn('protected_key', stored)
        self.assertNotIn('test-deepseek-secret', json.dumps(public))

    def test_all_openrouter_models_use_openrouter_key(self):
        models = api_config.BUILTIN_PROVIDERS['openrouter']['models']
        self.assertEqual(models[0], 'nvidia/nemotron-3.5-super-vl:free')
        for model in models:
            with self.subTest(model=model):
                self.select('openrouter', model)
                config = server.settings()
                self.assertEqual(config['model'], model)
                self.assertEqual(config['base'], 'https://openrouter.ai/api/v1')
                self.assertEqual(config['key'], self.values['BUILTIN_OPENROUTER_API_KEY'])

    def test_allowlist_and_missing_key_errors_do_not_mutate_settings(self):
        self.select()
        before = self.path.read_bytes()
        for provider, model in [('deepseek', 'other-model'), ('openrouter', 'deepseek-flash'),
                                ('ollama', 'other-model'), ('ollama', 'gemma4:31b-cloud')]:
            with self.assertRaises(HTTPException) as caught:
                self.select(provider, model)
            self.assertEqual(caught.exception.status_code, 400)
        self.values['BUILTIN_OPENROUTER_API_KEY'] = ''
        with self.assertRaises(HTTPException) as caught:
            self.select('openrouter', api_config.BUILTIN_PROVIDERS['openrouter']['models'][0])
        self.assertIn('尚未配置', caught.exception.detail)
        self.values['BUILTIN_OLLAMA_API_KEY'] = ''
        with self.assertRaises(HTTPException) as caught:
            self.select('ollama', 'gemma4:31b')
        self.assertIn('Ollama 内置密钥尚未配置', caught.exception.detail)
        self.assertEqual(self.path.read_bytes(), before)

    def test_ollama_uses_fixed_cloud_endpoint_and_keeps_secret_server_side(self):
        public = self.select('ollama', 'gemma4:31b')
        config = server.settings()
        self.assertEqual(config['base'], 'https://ollama.com/v1')
        self.assertEqual(config['model'], 'gemma4:31b')
        self.assertEqual(config['key'], self.values['BUILTIN_OLLAMA_API_KEY'])
        self.assertTrue(public['api_configured'])
        self.assertEqual(public['builtin_provider'], 'ollama')
        stored = json.loads(self.path.read_text(encoding='utf-8'))
        self.assertEqual(stored['builtin_model'], 'gemma4:31b')
        self.assertNotIn('key', stored)
        self.assertNotIn('protected_key', stored)
        self.assertNotIn('test-ollama-secret', json.dumps(public))
        self.assertNotIn('test-ollama-secret', json.dumps(stored))

    def test_ollama_connection_test_uses_cloud_key_and_fixed_model(self):
        self.select('ollama', 'gemma4:31b')
        response = Mock()
        response.json.return_value = {'choices': [{'message': {'content': 'OK'}}]}
        with patch.object(server.requests, 'post', return_value=response) as post:
            result = server.test_connection()
        self.assertTrue(result['ok'])
        self.assertEqual(post.call_args.args[0], 'https://ollama.com/v1/chat/completions')
        self.assertEqual(post.call_args.kwargs['headers']['Authorization'], 'Bearer test-ollama-secret')
        self.assertEqual(post.call_args.kwargs['json']['model'], 'gemma4:31b')
        self.assertNotIn('test-ollama-secret', json.dumps(result))

    def test_switching_back_preserves_custom_key_and_never_copies_builtin_key(self):
        self.path.write_text(json.dumps({'base': 'https://custom.example/v1', 'model': 'custom-model',
                                        'protected_key': 'original-encrypted-blob', 'effort': ''}), encoding='utf-8')
        def crypto(value, decrypt=False):
            self.assertIn(value, ['original-encrypted-blob', 'custom-secret'])
            return 'custom-secret' if decrypt else 'original-encrypted-blob'
        with patch.object(api_config, 'protect', side_effect=crypto):
            public = self.select()
            self.assertEqual(json.loads(self.path.read_text())['protected_key'], 'original-encrypted-blob')
            self.assertEqual(public['custom']['model'], 'custom-model')
            server.update_settings(server.APISettings(base=public['custom']['base'], model='custom-model'))
            config = server.settings()
            self.assertEqual(config['key'], 'custom-secret')
            self.assertEqual(config['mode'], 'custom')

    def test_env_changes_are_loaded_and_test_connection_uses_selected_key(self):
        self.select()
        self.values['BUILTIN_DEEPSEEK_API_KEY'] = 'replacement-test-secret'
        response = Mock()
        response.json.return_value = {'choices': [{'message': {'content': 'OK'}}]}
        with patch.object(server.requests, 'post', return_value=response) as post:
            result = server.test_connection()
        self.assertTrue(result['ok'])
        self.assertEqual(post.call_args.args[0], 'https://api.deepseek.com/chat/completions')
        self.assertEqual(post.call_args.kwargs['headers']['Authorization'], 'Bearer replacement-test-secret')
        self.assertEqual(post.call_args.kwargs['json']['model'], 'deepseek-flash')
        self.assertNotIn('replacement-test-secret', json.dumps(result))


if __name__ == '__main__':
    unittest.main()
