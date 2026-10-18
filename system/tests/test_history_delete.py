"""Delete conversation history removes persisted run JSON on disk."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import HTTPException
from app import server


class HistoryDeleteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.data = Path(self.temp.name)
        (self.data / 'runs').mkdir(parents=True)
        self.project_id = 'sample'
        server.projects[self.project_id] = {
            'id': self.project_id,
            'name': 'Test',
            'work': self.data / 'work',
            'materials': self.data / 'materials',
            'read_only': True,
            'hidden': False,
        }
        self.patch = patch.object(server, 'DATA', self.data)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        server.runs.clear()

    def write_run(self, run_id, **extra):
        body = {
            'id': run_id,
            'project_id': self.project_id,
            'kind': 'query',
            'question': 'Q',
            'status': 'completed',
            'created_at': 1,
            **extra,
        }
        path = self.data / 'runs' / f'{run_id}.json'
        path.write_text(json.dumps(body), encoding='utf-8')
        return body

    def test_delete_conversation_removes_thread(self):
        a = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
        b = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
        self.write_run(a, conversation_id=a)
        self.write_run(b, conversation_id=a, parent_run_id=a)
        other = 'cccccccccccccccccccccccccccccccc'
        self.write_run(other, conversation_id=other)
        result = server.delete_conversation(b, project_id=self.project_id)
        self.assertEqual(result['deleted'], 2)
        self.assertFalse((self.data / 'runs' / f'{a}.json').is_file())
        self.assertFalse((self.data / 'runs' / f'{b}.json').is_file())
        self.assertTrue((self.data / 'runs' / f'{other}.json').is_file())

    def test_clear_history_only_current_project(self):
        self.write_run('dddddddddddddddddddddddddddddddd', conversation_id='dddddddddddddddddddddddddddddddd')
        foreign = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
        self.write_run(foreign, project_id='other', conversation_id=foreign)
        result = server.clear_history(project_id=self.project_id)
        self.assertEqual(result['deleted'], 1)
        self.assertFalse((self.data / 'runs' / 'dddddddddddddddddddddddddddddddd.json').is_file())
        self.assertTrue((self.data / 'runs' / f'{foreign}.json').is_file())

    def test_delete_blocks_running_run(self):
        run_id = 'ffffffffffffffffffffffffffffffff'
        self.write_run(run_id, conversation_id=run_id)
        server.runs[run_id] = {'id': run_id, 'status': 'running', 'events': []}
        with self.assertRaises(HTTPException) as caught:
            server.delete_conversation(run_id, project_id=self.project_id)
        self.assertEqual(caught.exception.status_code, 409)


if __name__ == '__main__':
    unittest.main()
