"""Rebuilding publishes a new graph only after success, without deleting old data."""
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
from interactive_kg import notebook_runtime


class GraphRebuildTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        materials = self.base / 'materials'
        materials.mkdir()
        (materials / 'notes.txt').write_bytes(b'Example material')
        work = self.base / 'work'
        work.mkdir()
        self.old_graph = {'nodes': [], 'edges': [], 'facts': [], 'evidence': [], 'documents': [], 'revision': 'old'}
        (work / '04_knowledge_graph.json').write_text(json.dumps(self.old_graph))
        self.project = dict(id='rebuild-test', name='Rebuild test', materials=materials, work=work,
                            work_dir='work', read_only=False, user_uploaded=True,
                            source_binding={'notes.txt': hashlib.sha256(b'Example material').hexdigest()},
                            roles={'notes.txt': 'corpus'})
        self.contexts = [patch.object(server, 'DATA', self.base / 'web'),
                         patch.dict(server.projects, {'rebuild-test': self.project}, clear=True),
                         patch.dict(server.runs, {}, clear=True),
                         patch.object(server, 'settings', return_value=dict(key='test-only', model='test', base='https://example.test', effort=''))]
        for context in self.contexts:
            context.start()
            self.addCleanup(context.stop)
        server.save_project(self.project)

    def run_build(self, outcome='success', rebuild=True):
        original = self.project
        graph = {**self.old_graph, 'revision': 'new'}

        class Session:
            def __init__(self, notebook, overrides, progress):
                self.work = Path(overrides['WORK_DIR'])

            def ensure_graph(session):
                # This is the external model boundary; all persistence is real.
                self.assertIs(server.projects['rebuild-test'], original)
                self.assertEqual(server.read_graph(original)['revision'], 'old')
                if outcome == 'failure':
                    raise RuntimeError('model unavailable')
                if outcome == 'cancelled':
                    raise server.Cancelled()
                if not rebuild:
                    return
                session.work.mkdir(parents=True, exist_ok=True)
                (session.work / '04_knowledge_graph.json').write_text(json.dumps(graph))
                if outcome == 'late-cancel':
                    run['cancel'].set()
                if outcome == 'source-changed':
                    (original['materials'] / 'notes.txt').write_bytes(b'Changed material')

        run = server.new_run('rebuild-test', 'build')
        run['rebuild'] = rebuild
        with patch.object(server, 'InteractiveKGSession', Session):
            server.build_worker(run)
        return run

    def test_success_builds_fresh_and_persists_new_active_work_directory(self):
        self.run_build()
        revised = server.projects['rebuild-test']
        self.assertNotEqual(revised['work'], self.project['work'])
        self.assertEqual(server.read_graph(revised)['revision'], 'new')
        self.assertEqual(server.read_graph(self.project)['revision'], 'old')
        saved = json.loads((self.base / 'project.json').read_text())
        self.assertEqual(saved['work_dir'], revised['work'].name)
        self.assertEqual((self.project['materials'] / 'notes.txt').read_bytes(), b'Example material')

    def test_failure_or_cancellation_preserves_old_graph_and_project_manifest(self):
        before = (self.base / 'project.json').read_bytes()
        for outcome, error in [('failure', RuntimeError), ('cancelled', server.Cancelled)]:
            with self.subTest(outcome=outcome), self.assertRaises(error):
                self.run_build(outcome)
            self.assertIs(server.projects['rebuild-test'], self.project)
            self.assertEqual(server.read_graph(self.project)['revision'], 'old')
            self.assertEqual((self.base / 'project.json').read_bytes(), before)

    def test_failed_manifest_save_does_not_switch_active_graph(self):
        with patch.object(server, 'save_project', side_effect=OSError('disk unavailable')):
            with self.assertRaises(OSError):
                self.run_build()
        self.assertIs(server.projects['rebuild-test'], self.project)
        self.assertEqual(server.read_graph(self.project)['revision'], 'old')

    def test_cancellation_after_model_returns_does_not_publish(self):
        with self.assertRaises(server.Cancelled):
            self.run_build('late-cancel')
        self.assertIs(server.projects['rebuild-test'], self.project)
        self.assertEqual(server.read_graph(self.project)['revision'], 'old')

    def test_source_change_prevents_publishing_unverified_graph(self):
        before = (self.base / 'project.json').read_bytes()
        with self.assertRaises(HTTPException) as caught:
            self.run_build('source-changed')
        self.assertEqual(caught.exception.status_code, 409)
        self.assertIs(server.projects['rebuild-test'], self.project)
        self.assertEqual((self.base / 'project.json').read_bytes(), before)

    def test_regular_build_keeps_existing_checkpoint_and_work_directory(self):
        self.run_build(rebuild=False)
        self.assertIs(server.projects['rebuild-test'], self.project)
        self.assertEqual(server.read_graph(self.project)['revision'], 'old')

    def test_final_event_failure_rolls_back_manifest_and_discards_success_events(self):
        before = (self.base / 'project.json').read_bytes()
        emit = server.emit
        def fail_completion(run, kind, **data):
            if kind == 'run.completed':
                # emit appends before writing, so cover a failure after append.
                run['events'].append({'type': kind})
                raise OSError('event storage unavailable')
            return emit(run, kind, **data)
        with patch.object(server, 'emit', side_effect=fail_completion):
            with self.assertRaises(OSError):
                self.run_build()
        self.assertIs(server.projects['rebuild-test'], self.project)
        self.assertEqual((self.base / 'project.json').read_bytes(), before)
        run = next(iter(server.runs.values()))
        self.assertNotIn('run.completed', [event['type'] for event in run['events']])
        self.assertNotIn('graph.updated', [event['type'] for event in run['events']])

    def test_publication_finalizes_run_so_late_cancel_cannot_report_failure(self):
        run = self.run_build()
        self.assertEqual(server.cancel(run['id'])['status'], 'completed')
        self.assertFalse(run['cancel'].is_set())
        self.assertEqual(run['events'][-1]['type'], 'run.completed')

    def test_api_passes_rebuild_intent_to_worker(self):
        with patch.object(server, 'launch'):
            result = server.build('rebuild-test', server.BuildRequest(rebuild=True))
        self.assertTrue(server.runs[result['run_id']]['rebuild'])

    def test_active_question_prevents_rebuild(self):
        server.runs['question'] = dict(project_id='rebuild-test', kind='answer', status='running')
        with patch.object(server, 'launch'), self.assertRaises(HTTPException) as caught:
            server.build('rebuild-test')
        self.assertEqual(caught.exception.status_code, 409)

    def test_imported_project_cannot_rebuild_without_original_materials(self):
        self.project['imported'] = True
        with patch.object(server, 'launch'), self.assertRaises(HTTPException) as caught:
            server.build('rebuild-test')
        self.assertEqual(caught.exception.status_code, 400)


class BundledRuntimeTests(unittest.TestCase):
    def test_runtime_loads_bundled_pipeline_without_untracked_skill_document(self):
        runtime = notebook_runtime(server.ROOT / 'evidence_kg_openrouter_debug.ipynb')
        self.assertEqual(runtime['SCRIPTS_DIR'], server.SCRIPTS)
        self.assertTrue(runtime['PIPELINE'].is_file())


if __name__ == '__main__':
    unittest.main()
