"""Exercise removal against temporary projects, never the user's materials."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import server
from fastapi import HTTPException


class FileManagementTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        materials = self.base / 'materials'
        materials.mkdir()
        work = self.base / 'work'
        work.mkdir()
        (work / '04_knowledge_graph.json').write_text('{}', encoding='utf-8')
        binding = {}
        for name, content in [('保留.txt', b'keep'), ('待删.txt', b'remove')]:
            (materials / name).write_bytes(content)
            binding[name] = hashlib.sha256(content).hexdigest()
        self.project_id = 'file-removal-test'
        self.project = dict(id=self.project_id, name='Temporary project', materials=materials,
                            work=work, work_dir='work', read_only=False, user_uploaded=True,
                            source_binding=binding, roles={n: 'corpus' for n in binding})
        server.projects[self.project_id] = self.project
        server.save_project(self.project)

    def tearDown(self):
        server.projects.pop(self.project_id, None)
        for key in list(server.runs):
            if server.runs[key].get('project_id') == self.project_id:
                server.runs.pop(key)
        self.temp.cleanup()

    def remove(self, name):
        routes = [r for r in server.app.routes
                  if getattr(r, 'path', '') == '/api/projects/{project_id}/files/remove']
        self.assertEqual(len(routes), 1, 'The file-removal API must be registered')
        return routes[0].endpoint(self.project_id, server.RemoveFile(path=name))

    def test_removal_updates_file_list_and_invalidates_only_current_graph(self):
        result = self.remove('待删.txt')
        self.assertEqual([f['path'] for f in result['files']], ['保留.txt'])
        self.assertFalse(result['ready'])
        revised = server.projects[self.project_id]
        self.assertNotEqual(revised['work'], self.project['work'])
        self.assertTrue((self.project['work'] / '04_knowledge_graph.json').is_file())
        self.assertEqual((revised['materials'] / '保留.txt').read_bytes(), b'keep')
        self.assertFalse((revised['materials'] / '待删.txt').exists())
        archived = list(self.base.glob('removed_files/*/待删.txt'))
        self.assertEqual(len(archived), 1)
        self.assertEqual(archived[0].read_bytes(), b'remove')
        saved = json.loads((self.base / 'project.json').read_text(encoding='utf-8'))
        self.assertEqual(saved['source_binding'], {'保留.txt': hashlib.sha256(b'keep').hexdigest()})
        self.assertNotIn('待删.txt', saved['roles'])

    def test_last_file_can_be_removed_and_project_accepts_future_uploads(self):
        self.remove('待删.txt')
        result = self.remove('保留.txt')
        self.assertEqual(result['files'], [])
        self.assertFalse(result['ready'])
        self.assertTrue(result['can_append'])

    def test_read_only_and_imported_projects_reject_removal(self):
        for flag in ('read_only', 'imported'):
            with self.subTest(flag=flag):
                self.project[flag] = True
                with self.assertRaises(HTTPException) as caught:
                    self.remove('待删.txt')
                self.assertEqual(caught.exception.status_code, 409)
                self.project[flag] = False
                self.assertTrue((self.project['materials'] / '待删.txt').exists())

    def test_running_task_prevents_removal(self):
        server.runs['file-removal-running'] = dict(project_id=self.project_id, status='running')
        with self.assertRaises(HTTPException) as caught:
            self.remove('待删.txt')
        self.assertEqual(caught.exception.status_code, 409)
        self.assertTrue((self.project['materials'] / '待删.txt').exists())

    def test_unknown_or_escaping_filename_does_not_touch_materials(self):
        for name, status in [('missing.txt', 404), ('../待删.txt', 400),
                             ('..\\待删.txt', 400), ('C:\\待删.txt', 400)]:
            with self.subTest(name=name):
                with self.assertRaises(HTTPException) as caught:
                    self.remove(name)
                self.assertEqual(caught.exception.status_code, status)
                self.assertTrue((self.project['materials'] / '待删.txt').exists())

    def test_persistence_failure_restores_original_file_and_project(self):
        with patch.object(server, 'save_project', side_effect=OSError('disk unavailable')):
            with self.assertRaises(OSError):
                self.remove('待删.txt')
        self.assertIs(server.projects[self.project_id], self.project)
        self.assertEqual((self.project['materials'] / '待删.txt').read_bytes(), b'remove')
        self.assertIn('待删.txt', self.project['source_binding'])


if __name__ == '__main__':
    unittest.main()
