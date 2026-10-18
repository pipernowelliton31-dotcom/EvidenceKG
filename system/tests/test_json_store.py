"""Exercise Windows snapshot replacement with real file locks and concurrent IO."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import json_store, server


class JsonStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'run.json'
        self.original = {'answer': '已经保存的回答'}
        self.path.write_text(json.dumps(self.original), encoding='utf-8')

    def test_transient_windows_denials_retry_then_save_complete_snapshot(self):
        replace = os.replace
        for code in (5, 32, 33):
            error = PermissionError('temporary sharing lock')
            error.winerror = code
            with patch.object(json_store.os, 'replace') as mocked, \
                 patch.object(json_store.time, 'sleep'):
                # Use a callable side effect to invoke the real replacement on success.
                outcomes = iter([error, error, None])
                def attempt(source, target):
                    failure = next(outcomes)
                    if failure:
                        raise failure
                    replace(source, target)
                mocked.side_effect = attempt
                json_store.atomic_write_json(self.path, {'answer': '完整的新回答', 'code': code})
                self.assertEqual(mocked.call_count, 3)
            self.assertEqual(json.loads(self.path.read_text(encoding='utf-8'))['code'], code)
            self.assertFalse(list(self.path.parent.glob('*.tmp')))

    def test_persistent_denial_keeps_original_and_does_not_retry_forever(self):
        error = PermissionError('persistent access denied')
        error.winerror = 5
        with patch.object(json_store.os, 'replace', side_effect=error) as replace, \
             patch.object(json_store.time, 'sleep') as sleep:
            with self.assertRaises(PermissionError):
                json_store.atomic_write_json(self.path, {'answer': 'new'})
            self.assertEqual(replace.call_count, 8)
            self.assertEqual(sleep.call_count, 7)
        self.assertEqual(json.loads(self.path.read_text(encoding='utf-8')), self.original)
        self.assertFalse(list(self.path.parent.glob('*.tmp')))

    def test_unrelated_error_does_not_retry_or_damage_old_record(self):
        with patch.object(json_store.os, 'replace', side_effect=OSError('disk failure')), \
             patch.object(json_store.time, 'sleep') as sleep:
            with self.assertRaises(OSError):
                json_store.atomic_write_json(self.path, {'answer': 'new'})
            sleep.assert_not_called()
        self.assertEqual(json.loads(self.path.read_text(encoding='utf-8')), self.original)

    def test_concurrent_history_reads_and_writes_remain_valid(self):
        def operation(index):
            if index % 3:
                server.write_json(self.path, {'answer': '回答' * 4000, 'index': index})
            return server.read_json(self.path)
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(operation, range(100)))
        self.assertTrue(all(isinstance(result['answer'], str) for result in results))
        self.assertFalse(list(self.path.parent.glob('*.tmp')))

    def test_unique_temporary_files_for_independent_writers(self):
        sources = []
        source_lock = threading.Lock()
        replace = os.replace
        def capture(source, target):
            with source_lock:
                sources.append(str(source))
            replace(source, target)
        with patch.object(json_store.os, 'replace', side_effect=capture), ThreadPoolExecutor(max_workers=6) as pool:
            list(pool.map(lambda index: json_store.atomic_write_json(self.path, {'index': index}), range(24)))
        self.assertEqual(len(set(sources)), 24)
        self.assertIn(json.loads(self.path.read_text())['index'], range(24))

    @unittest.skipUnless(os.name == 'nt', 'Windows sharing semantics')
    def test_real_windows_read_handle_can_close_during_retry(self):
        blocked = threading.Event()
        replace = os.replace
        def attempt(source, target):
            try:
                replace(source, target)
            except OSError:
                blocked.set()
                raise
        with patch.object(json_store.os, 'replace', side_effect=attempt), ThreadPoolExecutor(max_workers=1) as pool:
            with self.path.open('rb'):
                future = pool.submit(json_store.atomic_write_json, self.path, {'answer': '恢复成功'})
                self.assertTrue(blocked.wait(2), 'Expected a real Windows sharing denial')
            future.result(timeout=3)
        self.assertEqual(json.loads(self.path.read_text(encoding='utf-8'))['answer'], '恢复成功')


if __name__ == '__main__':
    unittest.main()
