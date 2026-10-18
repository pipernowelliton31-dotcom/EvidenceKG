"""Routing integration with simulated provider streams; never calls a live API."""
from contextlib import ExitStack
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import HTTPException
from app import question_router, server


def stream(text, finish='stop', usage=None):
    yield {'choices': [{'index': 0, 'delta': {'content': text}}]}
    yield {'choices': [{'index': 0, 'delta': {}, 'finish_reason': finish}], 'usage': usage or {}}


class QuestionRoutingTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.project = {'id': 'routing-test', 'name': '测试资料', 'work': self.directory / 'work',
                        'materials': self.directory / 'materials', 'read_only': False}
        self.project['work'].mkdir()
        self.config = {'key': 'fake-test-key', 'model': 'mock-model', 'base': 'https://example.invalid/v1',
                       'effort': '', 'max_tokens': 1024, 'auto_continue': 1}
        for context in [patch.object(server, 'DATA', self.directory),
                        patch.dict(server.projects, {'routing-test': self.project}, clear=True),
                        patch.dict(server.runs, {}, clear=True),
                        patch.object(server, 'settings', return_value=self.config),
                        patch.object(server.requests, 'post', side_effect=AssertionError('Live API calls forbidden'))]:
            context.start()
            self.addCleanup(context.stop)

    def run_record(self, question='你好', history=None):
        run = server.new_run('routing-test', 'query', question)
        run['conversation_context'] = history or []
        return run

    def knowledge_pipeline(self):
        stack = ExitStack()
        self.addCleanup(stack.close)
        self.project['work'].joinpath('04_knowledge_graph.json').write_text('{}', encoding='utf-8')
        result = {'context': '订单记录中的原文依据', 'stats': {}, 'query_plan': {}, 'paths': []}
        rag = stack.enter_context(patch.object(server, 'LeanGraphRAG'))
        rag.return_value.retrieve.return_value = result
        for name, value in [('_validate_query_graph', None), ('read_graph', {'evidence': []}),
                            ('graph_bundle', {'nodes': [], 'edges': []}), ('evidence_cards', []),
                            ('enrich_evidence', []), ('source_urls', {})]:
            stack.enter_context(patch.object(server, name, return_value=value))
        return rag

    def test_only_unambiguous_full_inputs_use_local_rules(self):
        for text in ['你好', '你好！', 'hihi', 'Hi!', 'hello', '谢谢', '1+1=几', '１＋１＝？',
                     '(2+3)×4等于多少？', '2**8', '-3 + 5']:
            with self.subTest(text=text):
                self.assertEqual(question_router.local_route(text), 'general')
        for text in ['你好，帮我查一下订单', '1+1份订单总额', '订单金额加起来是多少', '继续',
                     '那他购买了什么', '陈默的职业是什么', '用Python写排序', '2026-10-03', '1+*2']:
            with self.subTest(text=text):
                self.assertIsNone(question_router.local_route(text))

    def test_classifier_has_recent_modes_bounded_metadata_and_no_answer_template(self):
        history = [{'question': str(index), 'answer': '答' * 2500,
                    'mode': 'general' if index % 2 else 'answer'} for index in range(9)]
        payload = question_router.classifier_payload('继续', history, '资料' * 5000, 'mock-model')
        data = json.loads(payload['messages'][-1]['content'])
        self.assertEqual([turn['question'] for turn in data['history']], ['3', '4', '5', '6', '7', '8'])
        self.assertEqual(data['history'][0]['mode'], 'general')
        self.assertEqual(len(data['library']), 4000)
        self.assertEqual(len(data['history'][0]['answer']), 2000)
        self.assertNotIn(server.ANSWER_PROMPT, payload['messages'][0]['content'])

    def test_catalog_only_uses_metadata_and_obeys_limit(self):
        server.write_json(self.project['work'] / '00_document_units.json', {
            'documents': [{'path': '订单.xlsx', 'role': 'corpus'}, {'path': '排除题目.docx', 'role': 'questions'}],
            'units': [{'content_md': 'PRIVATE_FULL_DOCUMENT_TEXT'}]})
        server.write_json(self.project['work'] / '04_knowledge_graph.json', {
            'nodes': [{'name': '产品' * 100, 'aliases': ['工具名']} for _ in range(1000)],
            'facts': [{'value': 'PRIVATE_FACT_VALUE'}]})
        catalog = server.routing_catalog(self.project)
        self.assertLessEqual(len(catalog), 4000)
        self.assertIn('订单.xlsx', catalog)
        for excluded in ['排除题目.docx', 'PRIVATE_FULL_DOCUMENT_TEXT', 'PRIVATE_FACT_VALUE']:
            self.assertNotIn(excluded, catalog)

    def test_unparsed_upload_names_are_available_to_classifier_without_reading_files(self):
        self.project['source_binding'] = {'新上传的订单.xlsx': 'fake-hash', '问题集.docx': 'fake-hash'}
        self.project['roles'] = {'新上传的订单.xlsx': 'corpus', '问题集.docx': 'questions'}
        catalog = server.routing_catalog(self.project)
        self.assertIn('新上传的订单.xlsx', catalog)
        self.assertNotIn('问题集.docx', catalog)

    def test_greeting_skips_classifier_graph_validation_retrieval_and_format_checks(self):
        run = self.run_record()
        with patch.object(server, 'provider_stream', side_effect=lambda *args, **kwargs: stream('你好！')) as provider, \
             patch.object(server, 'routing_catalog', side_effect=AssertionError('No metadata needed')), \
             patch.object(server, '_validate_query_graph') as validate, \
             patch.object(server, 'read_graph') as graph, patch.object(server, 'LeanGraphRAG') as rag:
            server.query_worker(run, 'auto', self.config)
        self.assertEqual(provider.call_count, 1)
        validate.assert_not_called(); graph.assert_not_called(); rag.assert_not_called()
        self.assertEqual(run['mode'], 'general')
        self.assertEqual(run['answer'], '你好！')
        self.assertEqual(run['routing']['source'], 'rule')
        self.assertFalse(any(event['type'] in {'retrieval.completed', 'format.warning'} for event in run['events']))
        self.assertTrue(all(event.get('stage') in {None, 'answer'} for event in run['events']))
        self.assertEqual(run['events'][-1]['mode'], 'general')

    def test_general_semantics_use_model_once_before_plain_answer_and_keep_usage_only(self):
        for question in ['法国首都是哪里', '翻译：good morning', '写一首诗', '用Python写排序']:
            with self.subTest(question=question):
                run = self.run_record(question)
                def provider(_run, _config, payload, **kwargs):
                    if 'deadline' in kwargs:
                        yield {'choices': [{'delta': {'reasoning_content': 'PRIVATE_ROUTER_REASONING'}}]}
                        yield from stream('general', usage={'total_tokens': 8, 'cost': .001, 'reasoning': 'PRIVATE'})
                    else:
                        self.assertNotIn(server.ANSWER_PROMPT, payload['messages'][0]['content'])
                        self.assertEqual(payload['messages'][-1]['content'], question)
                        yield from stream('普通回答')
                with patch.object(server, 'provider_stream', side_effect=provider) as calls, patch.object(server, 'LeanGraphRAG') as rag:
                    server.query_worker(run, 'auto', self.config)
                self.assertEqual(calls.call_count, 2)
                rag.assert_not_called()
                self.assertEqual(run['routing']['usage'], {'total_tokens': 8, 'cost': .001})
                saved = server.read_json(self.directory / 'runs' / (run['id'] + '.json'))
                self.assertNotIn('PRIVATE', json.dumps(saved))
                self.assertFalse(any(event['type'].startswith('rout') for event in saved['events']))

    def test_knowledge_semantics_keep_retrieval_evidence_and_original_prompt(self):
        rag = self.knowledge_pipeline()
        answer = '## 结论\n资料中的结论\n## 推理路径\n原文依据\n## 不确定项\n无'
        for question in ['你好，帮我查一下订单', '陈默的职业是什么', '订单金额加起来是多少', '翻译资料中的那份文件']:
            with self.subTest(question=question):
                run = self.run_record(question)
                def provider(_run, _config, payload, **kwargs):
                    if 'deadline' in kwargs:
                        yield from stream('knowledge')
                    else:
                        self.assertIn(server.ANSWER_PROMPT, payload['messages'][0]['content'])
                        self.assertIn('订单记录中的原文依据', payload['messages'][-1]['content'])
                        yield from stream(answer)
                with patch.object(server, 'provider_stream', side_effect=provider):
                    server.query_worker(run, 'auto', self.config)
                self.assertEqual(run['mode'], 'answer')
                self.assertTrue(any(event['type'] == 'retrieval.completed' for event in run['events']))
                self.assertEqual(run['answer'], answer)
        self.assertEqual(rag.return_value.retrieve.call_count, 4)

    def test_followups_and_mode_switches_are_decided_with_history(self):
        cases = [('继续', 'general', 'general'), ('继续', 'answer', 'knowledge'),
                 ('那他购买了什么', 'answer', 'knowledge'), ('写一首诗', 'answer', 'general'),
                 ('现在查订单', 'general', 'knowledge'), ('把刚才的回答翻译成英文', 'answer', 'general')]
        for question, previous_mode, decision in cases:
            with self.subTest(question=question, previous=previous_mode):
                run = self.run_record(question, [{'question': '前一个问题', 'answer': '前一轮回答', 'mode': previous_mode}])
                with patch.object(server, 'provider_stream', side_effect=lambda *args, **kwargs: stream(decision)) as provider:
                    mode = server.route_question(run, self.project, self.config)
                data = json.loads(provider.call_args.args[2]['messages'][-1]['content'])
                self.assertEqual(data['history'][0]['mode'], previous_mode)
                self.assertEqual(mode, 'general' if decision == 'general' else 'answer')

    def test_invalid_refused_failed_and_timed_out_classifications_fall_back_once(self):
        outcomes = [lambda: stream('general because it is a greeting'), lambda: stream('general', 'length'),
                    lambda: stream('', 'stop'), lambda: iter([{'choices': None}]),
                    lambda: iter([{'choices': [{'delta': {'refusal': 'no'}}]}])]
        for outcome in outcomes:
            run = self.run_record('不明确的问题')
            with patch.object(server, 'provider_stream', side_effect=lambda *args, **kwargs: outcome()) as provider:
                self.assertEqual(server.route_question(run, self.project, self.config), 'answer')
            self.assertEqual(provider.call_count, 1)
            self.assertEqual(run['routing']['source'], 'fallback')
        for error in [TimeoutError('timeout'), RuntimeError('provider failed')]:
            run = self.run_record('不明确的问题')
            with patch.object(server, 'provider_stream', side_effect=error) as provider:
                self.assertEqual(server.route_question(run, self.project, self.config), 'answer')
            self.assertEqual(provider.call_count, 1)

    def test_cancellation_is_not_swallowed_as_a_fallback(self):
        run = self.run_record('帮我写个函数')
        def provider(*args, **kwargs):
            run['cancel'].set()
            raise server.Cancelled()
        with patch.object(server, 'provider_stream', side_effect=provider):
            with self.assertRaises(server.Cancelled):
                server.route_question(run, self.project, self.config)
        self.assertNotIn('routing', run)

    def test_provider_deadline_and_cancellation_interrupt_a_silent_stream(self):
        for cancel in [False, True]:
            run = self.run_record('test')
            release, entered = threading.Event(), threading.Event()
            response = Mock()
            response.__enter__ = Mock(return_value=response)
            response.__exit__ = Mock(return_value=False)
            def lines(**kwargs):
                entered.set(); release.wait(2)
                return iter([])
            response.iter_lines.side_effect = lines
            def cancel_after_start():
                if entered.wait(1):
                    run['cancel'].set()
            cancel_thread = threading.Thread(target=cancel_after_start) if cancel else None
            if cancel_thread:
                cancel_thread.start()
            try:
                with patch.object(server.requests, 'post', return_value=response):
                    start = time.monotonic()
                    with self.assertRaises(server.Cancelled if cancel else TimeoutError):
                        list(server.provider_stream(run, self.config, {}, deadline=start + (.8 if cancel else .08)))
                    self.assertLess(time.monotonic() - start, 1)
            finally:
                release.set()
                if cancel_thread:
                    cancel_thread.join(2)

    def test_general_continuations_never_reintroduce_source_restrictions(self):
        run = self.run_record('写一个故事', [{'question': '前文', 'answer': '前文回答', 'mode': 'general'}])
        run['mode'] = 'general'
        def provider(_run, _config, payload):
            if len(payload['messages']) == 4:
                yield from stream('上半段', 'length')
            else:
                continuation = payload['messages'][-1]['content']
                self.assertNotIn('CURRENT_QUESTION', continuation)
                self.assertNotIn('资料', continuation)
                yield from stream('下半段')
        with patch.object(server, 'provider_stream', side_effect=provider) as calls:
            answer, _ = server.answer_stream(run, self.config)
        self.assertEqual(answer, '上半段下半段')
        self.assertEqual(calls.call_count, 2)

    def test_auto_endpoint_accepts_unbuilt_project_and_preserves_forced_modes(self):
        with patch.object(server, 'launch') as launch, patch.object(server, 'read_graph') as graph:
            server.query(server.Query(project_id='routing-test', question='你好', mode='auto'))
            graph.assert_not_called()
            self.assertEqual(launch.call_args.args[0]['requested_mode'], 'auto')
            for mode in ['answer', 'retrieve']:
                with self.assertRaises(HTTPException) as error:
                    server.query(server.Query(project_id='routing-test', question='你好', mode=mode))
                self.assertEqual(error.exception.status_code, 409)

    def test_forced_answer_and_retrieve_never_call_router(self):
        self.knowledge_pipeline()
        for mode in ['answer', 'retrieve']:
            run = self.run_record('你好')
            with patch.object(server, 'route_question') as router, \
                 patch.object(server, 'provider_stream', side_effect=lambda *args, **kwargs: stream('模型回答')) as provider:
                server.query_worker(run, mode, self.config)
            router.assert_not_called()
            self.assertEqual(run['mode'], mode)
            self.assertEqual(provider.call_count, int(mode == 'answer'))

    def test_saved_general_history_and_followups_work_without_a_graph(self):
        first = self.run_record()
        first.update(mode='general', model='mock-model', answer='你好', status='completed')
        server.emit(first, 'answer.completed', mode='general', answer='你好')
        with patch.object(server, 'read_graph', side_effect=AssertionError('General history needs no graph')), \
             patch.object(server, 'launch') as launch:
            detail = server.conversation_detail(first['id'])
            self.assertEqual(detail['turns'][0]['mode'], 'general')
            server.query(server.Query(project_id='routing-test', question='继续', mode='auto', parent_run_id=first['id']))
            self.assertEqual(launch.call_args.args[0]['conversation_context'][0]['mode'], 'general')

    def test_legacy_modes_and_source_bound_history_still_validate(self):
        self.assertEqual(question_router.record_mode({'model': 'old-model'}), 'answer')
        self.assertEqual(question_router.record_mode({}), 'retrieve')
        self.assertEqual(question_router.record_mode({'model': 'model', 'events': [{'type': 'answer.completed', 'mode': 'general'}]}), 'general')
        run = self.run_record('订单')
        run.update(status='completed', mode='answer', model='mock-model')
        server.emit(run, 'retrieval.completed', graph={'nodes': [], 'edges': []}, evidence=[])
        with patch.object(server, 'read_graph', side_effect=HTTPException(409, '来源已变更')):
            with self.assertRaises(HTTPException):
                server.history_detail(run['id'])

    def test_mixed_saved_conversation_preserves_modes_in_order_for_next_classification(self):
        first = self.run_record('你好')
        first.update(mode='general', model='mock-model', answer='你好', status='completed')
        server.emit(first, 'answer.completed', mode='general', answer='你好')
        second = self.run_record('查订单')
        second.update(mode='answer', model='mock-model', answer='订单的回答', status='completed', parent_run_id=first['id'])
        server.emit(second, 'retrieval.completed', graph={'nodes': [], 'edges': []}, evidence=[])
        third = self.run_record('把回答翻译成英文')
        third.update(mode='general', model='mock-model', answer='Translation', status='completed', parent_run_id=second['id'])
        server.emit(third, 'answer.completed', mode='general', answer='Translation')
        with patch.object(server, 'read_graph', return_value={}), patch.object(server, 'launch') as launch:
            self.assertEqual([turn['mode'] for turn in server.conversation_detail(third['id'])['turns']],
                             ['general', 'answer', 'general'])
            server.query(server.Query(project_id='routing-test', question='继续', mode='auto', parent_run_id=third['id']))
            history = launch.call_args.args[0]['conversation_context']
            self.assertEqual([turn['mode'] for turn in history], ['general', 'answer', 'general'])


if __name__ == '__main__':
    unittest.main()
