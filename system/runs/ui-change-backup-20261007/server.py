"""FastAPI transport; all parsing, alignment and retrieval stay in the existing skill."""
from __future__ import annotations
import asyncio
import base64
import mimetypes
import io
import hashlib
import json
import os
import queue
import re
import sys
import threading
import tempfile
import shutil
import time
import uuid
import zipfile
from pathlib import Path

import requests
from dotenv import dotenv_values
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from urllib.parse import urlsplit
from xml.etree import ElementTree as ET
from app.api_config import public_settings, save_settings, stored_settings
from app.graph_views import RELATIONS, entity_network, mindmap_html

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / 'skill/evidence-kg-builder/scripts'
sys.path[:0] = [str(ROOT), str(SCRIPTS)]
from interactive_kg import InteractiveKGSession, _validate_query_graph, SUPPORTED
from model_response import QA_MAX_TOKENS, MAX_OUTPUT_TOKENS, normalize_content
from lean_graphrag import LeanGraphRAG, ANSWER_PROMPT, locator_text
from tools.regression import questions
from parse_documents import Adapter, CONFIG
from kg_core import ident

DATA = ROOT / 'runs/web'
DATA.mkdir(parents=True, exist_ok=True)
app = FastAPI(title='Evidence KG Workspace', version='0.1.0')
MAX_FILE = 80 * 1024 * 1024
MAX_TOTAL = 300 * 1024 * 1024
lock = threading.RLock()
runs: dict[str, dict] = {}
projects = {'sample': {'id': 'sample', 'name': '仓库旧示例 · 测试集 A', 'work': ROOT / 'examples/prebuilt/work',
                       'materials': ROOT / 'materials', 'read_only': True, 'hidden': True}}


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def write_json(path, body):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(body, ensure_ascii=False, indent=2, default=str), encoding='utf-8')
    temp.replace(path)


for path in DATA.glob('projects/*/project.json'):
    item = read_json(path)
    project_id = item['id']
    work_dir = item.get('work_dir', 'work')
    if not re.fullmatch(r'work(?:-[a-f0-9]{32})?', work_dir):
        raise ValueError('Invalid project work directory')
    projects[project_id] = {**item, 'work': path.parent / work_dir, 'materials': path.parent / 'materials', 'read_only': False}
    # Legacy developer fixtures are retained on disk, but are not user uploads.
    projects[project_id]['hidden'] = not (item.get('user_uploaded') or item.get('imported'))
host_work = ROOT / 'runs/codex-host/work'
if (host_work / '04_knowledge_graph.json').is_file():
    documents = read_json(host_work / '00_document_units.json')['documents']
    allowed_names = ('测试集A_产品架构图.png', '测试集A_产品规格与定价文档.pdf', '测试集A_产品运营分析报告.pptx',
                     '测试集A_分析问题集.docx', '测试集A_工作室运营手册.docx', '测试集A_运营数据记录.xlsx')
    hashes = {d['path']: d['sha256'] for d in documents}
    projects['host'] = {'id': 'host', 'name': '测试集 A · 我的测试数据', 'work': host_work,
                        'materials': ROOT.parent / '测试数据', 'read_only': True,
                        'source_binding': {name: hashes.get(name, '') for name in allowed_names}}


def default_project_id():
    return 'host' if 'host' in projects and not projects['host'].get('hidden') else next(
        (p['id'] for p in projects.values() if not p.get('hidden')), '')


def save_project(project):
    write_json(project['work'].parent / 'project.json', {k: project[k] for k in
               ('id', 'name', 'roles', 'source_binding', 'user_uploaded', 'imported', 'work_dir') if k in project})


def source_scope(project, graph=None, parsed=None):
    """Bind a graph snapshot to the user's exact files, roles and evidence chain."""
    parsed_path = project['work'] / '00_document_units.json'
    parsed = parsed if parsed is not None else (read_json(parsed_path) if parsed_path.is_file() else {})
    documents = parsed.get('documents', [])
    binding = project.get('source_binding', {})
    issues, files = [], []
    by_id = {d['document_id']: d for d in documents}
    if binding and documents and set(binding) != {d['path'] for d in documents}:
        issues.append('构图文件清单与收录清单不一致')
    doc_by_name = {d['path']: d for d in documents}
    for name, expected in binding.items():
        path = (project['materials'] / name).resolve()
        exists = path.is_relative_to(project['materials'].resolve()) and path.is_file()
        actual = hashlib.sha256(path.read_bytes()).hexdigest() if exists else ''
        doc = doc_by_name.get(name, {})
        verified = actual == expected and (not documents or doc.get('sha256') == expected)
        if not verified:
            issues.append(f'{name}：文件缺失或内容已变更')
        files.append({'path': name, 'sha256': expected, 'verified': verified,
                      'role': doc.get('role', project.get('roles', {}).get(name, default_role(name)))})
        if documents and doc.get('role') != project.get('roles', {}).get(name, default_role(name)):
            issues.append(f'{name}：资料角色与收录设置不一致')
    if graph is not None and binding:
        graph_docs = {d['document_id']: d for d in graph.get('documents', [])}
        if set(graph_docs) != set(by_id) or any(
                graph_docs.get(i, {}).get('sha256') != d['sha256'] or
                graph_docs.get(i, {}).get('role') != d['role'] for i, d in by_id.items()):
            issues.append('图谱来源清单与解析清单不一致')
        units = {u['unit_id']: u for u in parsed.get('units', [])}
        if any(by_id.get(u['document_id'], {}).get('role') != 'corpus' for u in units.values()):
            issues.append('发现未收录的解析单元或排除资料参与构图')
        evidence = {e['evidence_id']: e for e in graph.get('evidence', [])}
        for ev in evidence.values():
            doc = by_id.get(ev.get('document_id'), {})
            unit = units.get(ev.get('unit_id'), {})
            if (doc.get('role') != 'corpus' or ev.get('source') not in binding or
                    ev.get('source') != doc.get('path') or ev.get('file_sha256') != doc.get('sha256') or
                    unit.get('document_id') != ev.get('document_id')):
                issues.append('存在无法追溯到收录业务文件的证据')
                break
        facts = {f['fact_id']: f for f in graph.get('facts', [])}
        if any(not f.get('evidence_ids') or not set(f['evidence_ids']) <= set(evidence) for f in facts.values()):
            issues.append('存在缺少来源支持的事实')
        nodes = {n['id']: n for n in graph.get('nodes', [])}
        for node in nodes.values():
            ids = {e for c in node.get('attribute_claims', []) for e in c.get('evidence_ids', [])}
            if not ids or not ids <= set(evidence):
                issues.append('存在缺少来源支持的实体')
                break
        if any(e.get('source') not in nodes or e.get('target') not in nodes or
               not e.get('fact_ids') or not set(e['fact_ids']) <= set(facts) for e in graph.get('edges', [])):
            issues.append('存在缺少事实支持的关系')
    return {'status': 'changed' if issues else 'verified' if binding else 'archive' if project.get('imported') else 'unbound',
            'verified': bool(binding) and not issues, 'issues': list(dict.fromkeys(issues)), 'files': files,
            'root': str(project['materials']) if binding else '',
            'corpus_count': sum(f['role'] == 'corpus' for f in files),
            'excluded_count': sum(f['role'] != 'corpus' for f in files)}


def read_graph(project):
    path = project['work'] / '04_knowledge_graph.json'
    if not path.is_file():
        raise HTTPException(409, '请先完成构图或导入知识库')
    graph = read_json(path)
    scope = source_scope(project, graph)
    if scope['issues']:
        raise HTTPException(409, '来源核验未通过，已停止显示旧图谱。' + '；'.join(scope['issues']))
    return graph


def settings():
    values = {**dotenv_values(ROOT / '.env'), **os.environ}
    defaults = {'key': str(values.get('OPENROUTER_API_KEY') or '').strip(),
            'model': str(values.get('LLM_MODEL') or 'stealth/space-bunny-alpha'),
            'base': str(values.get('OPENROUTER_BASE_URL') or 'https://openrouter.ai/api/v1').rstrip('/'),
            'effort': str(values.get('LLM_REASONING_EFFORT') or 'medium'),
            'max_tokens': QA_MAX_TOKENS, 'auto_continue': 2}
    return {**defaults, **stored_settings(DATA)}


@app.middleware('http')
async def local_origin_guard(request: Request, call_next):
    if request.method not in {'GET', 'HEAD', 'OPTIONS'} and request.url.path.startswith('/api'):
        origin = request.headers.get('origin')
        if origin and urlsplit(origin).netloc != request.headers.get('host'):
            return Response('仅接受当前本地页面的操作', status_code=403)
    return await call_next(request)


class APISettings(BaseModel):
    base: str = Field(max_length=500)
    model: str = Field(max_length=200)
    key: str = Field(default='', max_length=4000)
    effort: str = Field(default='', pattern='^(|none|low|medium|high)$')
    clear_key: bool = False
    max_tokens: int = Field(default=QA_MAX_TOKENS, ge=1024, le=MAX_OUTPUT_TOKENS)
    auto_continue: int = Field(default=2, ge=0, le=3)


@app.get('/api/settings')
def get_settings():
    return public_settings(settings())


@app.post('/api/settings')
def update_settings(body: APISettings):
    try:
        with lock:
            config = save_settings(DATA, settings(), body)
        return public_settings(config)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post('/api/settings/test')
def test_connection():
    config = settings()
    if not config['key']:
        raise HTTPException(400, '请先填写并保存 API Key')
    try:
        response = requests.post(config['base'] + '/chat/completions',
            headers={'Authorization': 'Bearer ' + config['key']},
            json={'model': config['model'], 'messages': [{'role': 'user', 'content': 'Reply with OK.'}],
                  'max_tokens': 64, 'stream': False}, timeout=(10, 30))
        response.raise_for_status()
        content = response.json().get('choices', [{}])[0].get('message', {}).get('content', '')
        if not content:
            raise ValueError('模型未返回文本；请检查模型 ID 和接口兼容性')
        return {'ok': True, 'model': config['model'], 'vision_tested': False,
                'message': f"文本连接成功 · {config['model']} 已返回有效回答。尚未验证视觉能力；含图片构图需使用支持图片输入的多模态模型及 API 路由。"}
    except (requests.RequestException, ValueError, KeyError, IndexError) as exc:
        message = str(exc).replace(config['key'], '[redacted]')
        if isinstance(exc, requests.HTTPError) and exc.response is not None and exc.response.status_code == 404:
            message = '服务商返回 404，请检查 API 地址、模型 ID 及可用路由。含图片构图还需确认模型和路由支持图片输入。原始错误：' + message
        raise HTTPException(502, '接口连接失败：' + message[:300]) from exc


def project_for(project_id):
    if project_id not in projects or projects[project_id].get('hidden'):
        raise HTTPException(404, '知识库不存在')
    return projects[project_id]


def run_for(run_id):
    if run_id not in runs:
        raise HTTPException(404, '运行不存在；服务重启后的记录请在历史中查看')
    return runs[run_id]


def emit(run, kind, **data):
    with lock:
        event = {'id': len(run['events']) + 1, 'type': kind, 'elapsed_s': round(time.monotonic() - run['started'], 1), **data}
        run['events'].append(event)
        write_json(DATA / 'runs' / (run['id'] + '.json'), public_run(run))


def public_run(run):
    return {k: v for k, v in run.items() if k not in {'cancel', 'started', 'thread'}}


class Cancelled(Exception):
    pass


def check_cancel(run):
    if run['cancel'].is_set():
        raise Cancelled()


def new_run(project_id, kind, question=''):
    run = {'id': uuid.uuid4().hex, 'project_id': project_id, 'kind': kind, 'question': question,
           'status': 'running', 'events': [], 'started': time.monotonic(), 'created_at': time.time(), 'cancel': threading.Event()}
    with lock:
        runs[run['id']] = run
    emit(run, 'run.started', message='已创建运行')
    return run


def launch(run, worker):
    def guarded():
        try:
            worker(run)
            check_cancel(run)
            run['status'] = 'completed'
            emit(run, 'run.completed', message='运行完成')
        except Cancelled:
            run['status'] = 'cancelled'
            emit(run, 'run.cancelled', message='运行已停止，已完成的检查点保留')
        except Exception as exc:
            run['status'] = 'failed'
            # HTTP error text may contain provider messages; never expose authorization headers.
            message = str(exc)
            secret = settings()['key']
            if secret:
                message = message.replace(secret, '[redacted]')
            if run['kind'] == 'build' and re.search(r'\b404\b|vision|multimodal|image.*(?:support|invalid)', message, re.I):
                message = ('构图接口请求失败：请核对 API 地址、模型 ID 和可用路由；含图片资料需使用支持图片输入的多模态模型及视觉路由。'
                           '文本连接测试通过不代表视觉可用。原始错误：' + message)
            emit(run, 'run.error', message=message[:2000])
    thread = threading.Thread(target=guarded, daemon=True)
    run['thread'] = thread
    thread.start()


def graph_bundle(project, retrieval=None):
    graph = read_graph(project)
    nodes = {n['id']: n for n in graph['nodes']}
    edges = {e['id']: e for e in graph['edges']}
    selected_nodes, selected_edges = set(), set()
    if retrieval:
        for path in retrieval.get('paths', []):
            selected_nodes.update(path['node_ids'])
            selected_edges.update(step['edge_id'] for step in path['steps'])
        selected_nodes.update(p['node_id'] for p in retrieval.get('entity_candidates', [])[:6])
    else:
        image_ids = {e['evidence_id'] for e in graph['evidence']
                     if Path(e.get('source', '')).suffix.lower() in {'.png', '.jpg', '.jpeg', '.webp'}}
        core = [n for n in nodes.values() if n['type'] in {'Product', 'AITool'}]
        supported = [n for n in core if any(image_ids.intersection(c.get('evidence_ids', []))
                                           for c in n.get('attribute_claims', []))]
        selected_nodes.update(n['id'] for n in (supported or core or list(nodes.values())[:36]))
        selected_edges.update(e['id'] for e in edges.values()
                              if e['source'] in selected_nodes and e['target'] in selected_nodes)
    return {'nodes': [nodes[n] for n in sorted(selected_nodes) if n in nodes],
            'edges': [edges[e] for e in sorted(selected_edges) if e in edges],
            'layout': 'network' if retrieval else 'architecture'}


def evidence_cards(project, retrieval):
    graph = read_graph(project)
    evidence = {e['evidence_id']: e for e in graph['evidence']}
    facts = {f['fact_id']: f for f in graph['facts']}
    cards, seen = [], set()
    for table in retrieval.get('table_hits', []):
        header = table['header']
        rows = [' | '.join(str(v).replace('\n', ' ') for v in row) for row in table['records']]
        cards.append({'id': 'table:' + table['unit_id'], 'source': table['source'], 'locator': table['locator'],
                      'location': locator_text(table['locator']),
                      'excerpt': ' | '.join(header) + '\n' + '\n'.join(rows)})
    for hit in retrieval.get('structured_hits', []):
        seen.add(hit['id'])
        cards.append({'id': hit['id'], 'source': hit['source'], 'locator': hit['locator'],
                      'location': locator_text(hit['locator']), 'excerpt': f"{hit['field']}: {hit['value']}"})
    for path in retrieval.get('paths', []):
        for step in path['steps']:
            for fid in step.get('fact_ids', []):
                for eid in facts.get(fid, {}).get('evidence_ids', []):
                    ev = evidence.get(eid)
                    if ev and eid not in seen:
                        seen.add(eid)
                        cards.append({'id': eid, 'fact_id': fid, 'edge_id': step['edge_id'], 'source': ev.get('source', ''),
                                      'locator': ev.get('locator', {}), 'location': locator_text(ev.get('locator', {})), 'excerpt': ev.get('quote', '')})
    for unit in retrieval.get('raw_units', []):
        if unit['unit_id'] not in seen:
            seen.add(unit['unit_id'])
            cards.append({'id': unit['unit_id'], 'source': unit['source'], 'locator': unit['locator'],
                          'location': locator_text(unit['locator']), 'excerpt': unit['content_md']})
    return cards


def enrich_evidence(project, evidence):
    """Inherited locators can lack a short quote; preserve the original unit instead."""
    parsed = read_json(project['work'] / '00_document_units.json')
    units = {u['unit_id']: u for u in parsed['units']}
    return [{**e, 'quote': e.get('quote') or ('图像证据：请核对原图中的实体标签、连线与图例。'
             if Path(e.get('source', '')).suffix.lower() in {'.png', '.jpg', '.jpeg', '.webp'} else
             units.get(e.get('unit_id'), {}).get('content_md', ''))} for e in evidence]


def source_urls(project):
    parsed = read_json(project['work'] / '00_document_units.json')
    return {d['path']: f"/api/projects/{project['id']}/source/{d['document_id']}"
            for d in parsed['documents'] if (project['materials'] / d['path']).is_file()}


def retrieval_answer(result):
    return ('## 结论\n已完成真实多通道检索。当前未接入模型，下面展示召回证据，尚未生成自然语言结论。\n\n'
            '## 推理路径\n在「图谱」中查看检索候选路径，点击节点或连线打开来源。候选路径仍需结合原文判断，不能直接视为因果结论。\n\n'
            '## 不确定项\n未配置在线模型。可在右侧查阅原文，并导出检索上下文供宿主模型回答。')


def provider_stream(run, config, payload):
    # A provider can remain silent before its first token. Keep cancellation responsive
    # while a bounded background reader waits on the network; only this thread emits events.
    incoming = queue.Queue(maxsize=256)
    stopped = threading.Event()
    def deliver(value):
        while not run['cancel'].is_set() and not stopped.is_set():
            try:
                incoming.put(value, timeout=.2)
                return
            except queue.Full:
                pass
    def read_provider():
        try:
            with requests.post(config['base'] + '/chat/completions', json=payload,
                               headers={'Authorization': 'Bearer ' + config['key']}, stream=True, timeout=(15, 120)) as response:
                response.raise_for_status()
                for line in response.iter_lines(chunk_size=1):
                    if run['cancel'].is_set() or stopped.is_set():
                        break
                    if line.startswith(b'data:'):
                        data = line[5:].strip()
                        if data == b'[DONE]':
                            break
                        deliver(json.loads(data))
        except Exception as exc:
            deliver(exc)
        finally:
            deliver(None)
    threading.Thread(target=read_provider, daemon=True).start()
    try:
        while True:
            check_cancel(run)
            try:
                body = incoming.get(timeout=.2)
            except queue.Empty:
                continue
            if body is None:
                break
            if isinstance(body, Exception):
                raise RuntimeError(str(body).replace(config['key'], '[redacted]')) from body
            if not isinstance(body, dict):
                raise RuntimeError('模型返回了无效的流式数据')
            if body.get('error'):
                raise RuntimeError(str(body['error']).replace(config['key'], '[redacted]'))
            yield body
    finally:
        stopped.set()


def answer_stream(run, config, result):
    messages = [{'role': 'system', 'content': ANSWER_PROMPT + '\n历史对话仅用于理解追问，不是事实依据。只用本轮来源支持结论；请回答 CURRENT_QUESTION。'}]
    for previous in run.get('conversation_context', [])[-6:]:
        messages.extend([{'role': 'user', 'content': previous['question'][:3000]},
                         {'role': 'assistant', 'content': previous['answer'][:6000]}])
    messages.append({'role': 'user', 'content': 'CURRENT_QUESTION\n' + run['question'] + '\n\n' + result['context']})
    budget = max(1024, min(MAX_OUTPUT_TOKENS, int(config.get('max_tokens', QA_MAX_TOKENS))))
    continuations = max(0, min(3, int(config.get('auto_continue', 2))))
    answer, usage = '', {}
    for attempt in range(continuations + 1):
        check_cancel(run)
        payload = {'model': config['model'], 'messages': list(messages), 'max_tokens': budget,
                   'stream': True, 'stream_options': {'include_usage': True}}
        if config['effort']:
            payload['reasoning'] = {'effort': config['effort']}
        segment, segment_usage, finish_reason = '', {}, None
        for body in provider_stream(run, config, payload):
            if isinstance(body.get('usage'), dict):
                segment_usage = body['usage']
            for choice in body.get('choices', []):
                if choice.get('index', 0) != 0:
                    continue
                if choice.get('finish_reason'):
                    finish_reason = choice['finish_reason']
                delta_body = choice.get('delta') or {}
                if choice.get('error') or delta_body.get('refusal'):
                    raise RuntimeError('模型生成失败或拒绝回答；已保留已返回的正文')
                delta = delta_body.get('content')
                if isinstance(delta, list):
                    delta = normalize_content(delta) if delta else ''
                if isinstance(delta, str) and delta:
                    if not answer:
                        emit(run, 'stage.progress', stage='answer', message='模型已开始返回正文，正在生成回答')
                    answer += delta
                    segment += delta
                    run['answer'] = answer
                    emit(run, 'answer.delta', text=delta)
        for key in ('prompt_tokens', 'completion_tokens', 'total_tokens', 'cost'):
            if isinstance(segment_usage.get(key), (int, float)):
                usage[key] = usage.get(key, 0) + segment_usage[key]
        run['usage'], run['finish_reason'], run['continuations'] = usage.copy(), finish_reason, attempt
        check_cancel(run)
        if finish_reason == 'length':
            if attempt == continuations:
                raise RuntimeError(f'回答仍被截断（每次输出上限 {budget} tokens，已续写 {attempt} 次）；正文已保留。可在模型设置中提高输出上限，或缩小问题范围后重试。')
            emit(run, 'stage.progress', stage='answer', message=f'回答较长，正在接续生成（{attempt + 1}/{continuations}）', continuation=attempt + 1)
            if segment:
                messages.extend([{'role': 'assistant', 'content': segment}, {'role': 'user', 'content':
                    '上条回答因输出长度限制中断。请从断点直接继续，补完剩余正文；不要重复已写内容，不要重新开头，表格或句子中断时接上原内容。仍只使用 CURRENT_QUESTION 对应的资料，完成后正常结束。'}])
            else:
                # Reasoning can consume a segment before any visible text is returned.
                budget = min(MAX_OUTPUT_TOKENS, budget * 2)
            continue
        if finish_reason in {'content_filter', 'error', 'tool_calls'}:
            raise RuntimeError(f'模型没有完成有效回答（finish_reason={finish_reason}）')
        if finish_reason != 'stop':
            raise RuntimeError(f'模型流式响应缺少有效结束标记（finish_reason={finish_reason}）；已保留返回的正文，请重试')
        if not answer.strip():
            raise RuntimeError('模型未返回回答正文')
        return answer, usage


class Query(BaseModel):
    project_id: str = Field(default_factory=default_project_id)
    question: str = Field(min_length=1, max_length=6000)
    mode: str = 'answer'
    parent_run_id: str | None = Field(default=None, pattern='^[a-f0-9]{32}$')


def query_worker(run, mode, config=None):
    project = project_for(run['project_id'])
    check_cancel(run)
    emit(run, 'stage.started', stage='validate', message='检查并复用已有知识图谱')
    _validate_query_graph(project['work'])
    read_graph(project)
    emit(run, 'stage.completed', stage='validate', message='知识库通过完整性校验，无需重新构图')
    emit(run, 'stage.started', stage='retrieve', message='检索结构化记录、事实、实体档案、图路径与原文')
    question = run['question']
    if run.get('conversation_context'):
        question = '\n'.join(['当前问题：' + question, '前文问题（用于理解指代）：',
                              *[p['question'][:1000] for p in run['conversation_context'][-2:]]])
    def progress(stage, message, details):
        check_cancel(run)
        emit(run, 'tool.completed', stage=stage, message=message, details=details)
    result = LeanGraphRAG(project['work'], context_chars=18000).retrieve(question, progress=progress)
    check_cancel(run)
    run['retrieval'] = result
    bundle = graph_bundle(project, result)
    cards = evidence_cards(project, result)
    original = {e['evidence_id']: e for e in enrich_evidence(project, read_graph(project)['evidence'])}
    urls = source_urls(project)
    for card in cards:
        if not card['excerpt']:
            card['excerpt'] = original.get(card['id'], {}).get('quote', '')
        card['source_url'] = urls.get(card['source'])
    emit(run, 'retrieval.completed', stage='retrieve', stats=result['stats'], plan=result['query_plan'],
         graph=bundle, evidence=cards, paths=result['paths'], context=result['context'],
         message=f"召回 {len(cards)} 处证据，{len(result['paths'])} 条候选路径")
    if mode == 'answer':
        config = config or settings()
        if not config['key']:
            raise RuntimeError('请点击页面顶部「配置模型」，保存 API Key 后开始问答。')
        emit(run, 'stage.started', stage='answer', model=config['model'], message=f"正在调用 {config['model']}，等待回答正文")
        answer, usage = answer_stream(run, config, result)
        run['model'] = config['model']
        missing = [section for section in ('结论', '推理路径', '不确定项') if not re.search(r'(?m)^\s*(?:#{1,6}\s*|\*\*)' + section, answer)]
        if missing:
            emit(run, 'format.warning', missing_sections=missing, message='模型回答缺少规范段落：' + '、'.join(missing))
    else:
        answer, usage = retrieval_answer(result), {}
    run['answer'] = answer
    emit(run, 'answer.completed', answer=answer, usage=usage, mode=mode, model=run.get('model'), message='回答已生成' if mode == 'answer' else '检索已完成')


def build_worker(run):
    project = project_for(run['project_id'])
    config = settings()
    def progress(message):
        check_cancel(run)
        emit(run, 'stage.progress', message=message)
    session = InteractiveKGSession(ROOT / 'evidence_kg_openrouter_debug.ipynb',
        overrides={'MATERIALS_ROOT': project['materials'], 'RUN_ROOT': project['work'].parent,
                   'WORK_DIR': project['work'], 'MODEL_OUTPUT_DIR': project['work'].parent / 'model_outputs',
                   'MANIFEST_PATH': project['work'].parent / 'inputs.json', 'MODEL': config['model'],
                   'OPENROUTER_API_KEY': config['key'], 'OPENROUTER_BASE_URL': config['base'],
                   'EXTRACT_REASONING': config['effort'], 'ALIGN_REASONING': config['effort'],
                   'QA_REASONING': config['effort'], 'ROLE_OVERRIDES': project.get('roles', {})}, progress=progress)
    if not config['key']:
        emit(run, 'stage.started', stage='parse', message='本地解析上传资料')
        for name in ('RUN_ROOT', 'WORK_DIR', 'MODEL_OUTPUT_DIR'):
            Path(session.runtime[name]).mkdir(parents=True, exist_ok=True)
        session._manifest()
        parsed = session._cli('parse', '--manifest', session.runtime['MANIFEST_PATH'], '--work', project['work'])
        if not parsed.get('ok'):
            raise RuntimeError('资料解析失败，请查看 DocumentUnit 的 parse_error')
        prepared = session._cli('prepare', '--work', project['work'])
        host_next(project, session)
        emit(run, 'stage.completed', stage='parse', message=f"已解析 {parsed['unit_count']} 个单元；待宿主处理 {prepared.get('pending_llm_units', 0)} 个单元")
        if (project['work'] / '04_knowledge_graph.json').is_file():
            emit(run, 'graph.updated', message='图谱已构建并通过校验')
        else:
            emit(run, 'host.required', message='已导出宿主任务。由当前对话的模型处理后导入响应，或配置在线模型继续构图。')
    else:
        session.ensure_graph()
        emit(run, 'graph.updated', graph=graph_bundle(project), message='图谱已构建并通过校验')


@app.get('/api/bootstrap')
def bootstrap():
    config = settings()
    return {'model': config['model'], 'api_configured': bool(config['key']), 'default_project': default_project_id(),
            'questions': questions(), 'projects': [project_summary(p) for p in projects.values() if not p.get('hidden')]}


def project_summary(project):
    work = project['work']
    ready = (work / '04_knowledge_graph.json').is_file()
    graph = read_json(work / '04_knowledge_graph.json') if ready else {}
    parsed = read_json(work / '00_document_units.json') if (work / '00_document_units.json').is_file() else {}
    scope = source_scope(project, graph if ready else None, parsed)
    if scope['issues']:
        ready, graph = False, {}
    files = project_documents(project, parsed)
    return {'id': project['id'], 'name': project['name'], 'ready': ready, 'read_only': project['read_only'],
            'can_append': not project['read_only'] and not project.get('imported', False),
            'files': files, 'counts': {k: len(graph.get(k, [])) for k in ('nodes', 'edges', 'facts', 'evidence')},
            'units': len(parsed.get('units', [])), 'source_scope': scope,
            'host_review': (work.parent / 'qa/host-review.md').is_file(),
            'benchmark_demo': any(f['path'].startswith('测试集A_') for f in files)}


def project_documents(project, parsed=None):
    if parsed is None:
        path = project['work'] / '00_document_units.json'
        parsed = read_json(path) if path.is_file() else {}
    if parsed.get('documents'):
        return parsed['documents']
    files = []
    for path in project['materials'].glob('*'):
        if not path.is_file():
            continue
        sha = project.get('source_binding', {}).get(path.name) or hashlib.sha256(path.read_bytes()).hexdigest()
        files.append({'document_id': ident('doc', [path.name, sha]), 'path': path.name, 'sha256': sha,
                      'format': path.suffix.lstrip('.').lower(), 'role': project.get('roles', {}).get(path.name, default_role(path.name)),
                      'parse_status': 'pending'})
    return files


@app.get('/api/projects/{project_id}')
def project_detail(project_id):
    project = project_for(project_id)
    summary = project_summary(project)
    return {**summary, 'graph': graph_bundle(project) if summary['ready'] else {'nodes': [], 'edges': []},
            'entity_graph': entity_network(read_graph(project)) if summary['ready'] else {'nodes': [], 'edges': []}}


@app.get('/api/projects/{project_id}/entity-graph')
def subjects(project_id):
    return entity_network(read_graph(project_for(project_id)))


@app.get('/api/projects/{project_id}/graph')
def full_graph(project_id):
    project = project_for(project_id)
    graph_file = project['work'] / '04_knowledge_graph.json'
    if not graph_file.is_file():
        raise HTTPException(409, '请先完成构图或导入知识库')
    graph = read_graph(project)
    return {'nodes': graph['nodes'], 'edges': graph['edges'], 'layout': 'network'}


@app.get('/api/projects/{project_id}/source-status')
def source_status(project_id):
    summary = project_summary(project_for(project_id))
    return {'ready': summary['ready'], 'source_scope': summary['source_scope']}


@app.post('/api/runs')
def query(query: Query):
    with lock:
        project = project_for(query.project_id)
        if not query.question.strip():
            raise HTTPException(400, '请输入问题')
        if query.mode not in {'retrieve', 'answer'}:
            raise HTTPException(400, '非法问答模式')
        if not (project['work'] / '04_knowledge_graph.json').is_file():
            raise HTTPException(409, '请先完成构图或导入知识库')
        read_graph(project)
        config = settings()
        if query.mode == 'answer' and not config['key']:
            raise HTTPException(400, '请先在「配置模型」中保存 API Key；未配置时可浏览离线图谱和原始资料。')
        ancestors = []
        if query.parent_run_id:
            ancestors = conversation_records(query.parent_run_id, query.project_id)
            if ancestors[-1]['status'] != 'completed':
                raise HTTPException(409, '上一轮尚未完成，请完成后再继续对话或新建对话')
        run = new_run(query.project_id, 'query', query.question.strip())
        run['parent_run_id'] = query.parent_run_id
        run['conversation_id'] = ancestors[0].get('conversation_id') or ancestors[0]['id'] if ancestors else run['id']
        run['conversation_context'] = [{'question': p.get('question', ''), 'answer': p.get('answer', '')}
                                        for p in ancestors[-6:] if p.get('answer')]
        run['model'] = config['model'] if query.mode == 'answer' else None
        launch(run, lambda run: query_worker(run, query.mode, config))
        return {'run_id': run['id']}


@app.post('/api/projects/{project_id}/build')
def build(project_id):
    project = project_for(project_id)
    if project['read_only']:
        raise HTTPException(400, '当前知识库只读，更新资料请重新收录')
    with lock:
        if any(r['project_id'] == project_id and r['kind'] == 'build' and r['status'] == 'running' for r in runs.values()):
            raise HTTPException(409, '该知识库正在构建')
        run = new_run(project_id, 'build')
    launch(run, build_worker)
    return {'run_id': run['id']}


@app.get('/api/runs/{run_id}/events')
async def events(run_id, request: Request):
    run = run_for(run_id)
    try:
        cursor = max(0, int(request.headers.get('last-event-id', '0')))
    except ValueError:
        cursor = 0
    async def stream():
        nonlocal cursor
        heartbeat = 0.0
        while True:
            if await request.is_disconnected():
                break
            with lock:
                pending = run['events'][cursor:]
            for event in pending:
                yield f"id: {event['id']}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
                cursor = event['id']
            # A worker may update status before publishing its terminal event.
            # Close only after that event has actually been delivered.
            with lock:
                finished = bool(run['events']) and run['events'][-1]['type'] in {'run.completed', 'run.cancelled', 'run.error'} and cursor >= len(run['events'])
            if finished:
                break
            if time.monotonic() - heartbeat >= 3:
                heartbeat = time.monotonic()
                yield 'event: heartbeat\ndata: ' + json.dumps({'elapsed_s': round(heartbeat - run['started'], 1)}) + '\n\n'
            await asyncio.sleep(.15)
    return StreamingResponse(stream(), media_type='text/event-stream', headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})


@app.post('/api/runs/{run_id}/cancel')
def cancel(run_id):
    run = run_for(run_id)
    if run['status'] == 'running':
        run['cancel'].set()
        emit(run, 'cancel.requested', message='正在停止生成…' if run['kind'] == 'query' else '已请求停止；等待当前构图批次退出')
    return {'status': run['status']}


@app.get('/api/history')
def history(project_id: str | None = None):
    project_id = project_id or default_project_id()
    project_for(project_id)
    items = [read_json(p) for p in (DATA / 'runs').glob('*.json')]
    for item in items:
        if item['status'] == 'running' and item['id'] not in runs:
            item['status'] = 'interrupted'
    return [{k: r.get(k) for k in ('id', 'kind', 'question', 'status', 'created_at', 'conversation_id', 'parent_run_id', 'model')}
            for r in sorted(items, key=lambda r: -r['created_at']) if r['project_id'] == project_id][:150]


def conversation_records(run_id, project_id=None):
    records, visited = [], set()
    while run_id:
        if run_id in visited or len(records) >= 100:
            raise HTTPException(409, '对话记录链不完整，请新建对话')
        visited.add(run_id)
        item = history_detail(run_id)
        project_id = project_id or item['project_id']
        if item['project_id'] != project_id or item.get('kind') != 'query':
            raise HTTPException(409, '对话不属于当前知识库')
        records.append(item)
        run_id = item.get('parent_run_id')
    return list(reversed(records))


@app.get('/api/conversations/{run_id}')
def conversation_detail(run_id):
    return {'turns': conversation_records(run_id)}


@app.get('/api/history/{run_id}')
def history_detail(run_id):
    if not re.fullmatch('[a-f0-9]{32}', run_id):
        raise HTTPException(404)
    path = DATA / 'runs' / (run_id + '.json')
    if not path.is_file():
        raise HTTPException(404)
    item = read_json(path)
    project = project_for(item['project_id'])
    graph = read_graph(project)
    # Saved query snapshots must obey the same current source scope as live graphs.
    if project.get('source_binding'):
        nodes = {n['id']: n for n in graph['nodes']}
        edges = {e['id']: e for e in graph['edges']}
        corpus = {d['path'] for d in graph['documents'] if d['role'] == 'corpus'}
        for event in item.get('events', []):
            snapshot = event.get('graph') or {}
            if (any(n != nodes.get(n.get('id')) for n in snapshot.get('nodes', [])) or
                    any(e != edges.get(e.get('id')) for e in snapshot.get('edges', [])) or
                    any(e.get('source') not in corpus for e in event.get('evidence', []))):
                raise HTTPException(409, '历史图谱与当前收录资料不一致，请重新检索')
    if item['status'] == 'running' and run_id not in runs:
        item['status'] = 'interrupted'
    return item


@app.get('/api/projects/{project_id}/evidence/{item_id}')
def detail(project_id, item_id):
    project = project_for(project_id)
    graph = read_graph(project)
    facts = {f['fact_id']: f for f in graph['facts']}
    found = next((e for e in graph['edges'] if e['id'] == item_id), None)
    if found:
        chosen = [facts[f] for f in found['fact_ids'] if f in facts]
    else:
        node = next((n for n in graph['nodes'] if n['id'] == item_id), None)
        if not node:
            raise HTTPException(404)
        found = node
        chosen = [f for f in graph['facts'] if f['subject'] == item_id or f.get('object') == item_id]
    count = len(chosen)
    chosen = sorted(chosen, key=lambda f: (not bool(f.get('object')), f['predicate'], f['fact_id']))[:40]
    names = {n['id']: n['name'] for n in graph['nodes']}
    chosen = [{**f, 'predicate_label': RELATIONS.get(f['predicate'], '资料属性'),
               'subject_name': names.get(f['subject']), 'object_name': names.get(f.get('object'))} for f in chosen]
    ids = {e for f in chosen for e in f.get('evidence_ids', [])}
    evidence = enrich_evidence(project, [e for e in graph['evidence'] if e['evidence_id'] in ids])
    urls = source_urls(project)
    return {'item': found, 'facts': chosen, 'fact_count': count, 'facts_omitted': max(0, count - len(chosen)),
            'relation': {'source': names.get(found.get('source')), 'target': names.get(found.get('target')),
                         'label': RELATIONS.get(found.get('predicate'), '其他关联')} if 'source' in found else None,
            'evidence': [{**e, 'source_url': urls.get(e['source']), 'location': locator_text(e.get('locator', {}))} for e in evidence]}


@app.get('/api/projects/{project_id}/source/{document_id}')
def source_file(project_id, document_id):
    project = project_for(project_id)
    scope = source_scope(project)
    if scope['issues']:
        raise HTTPException(409, '原始文件已变更：' + '；'.join(scope['issues']))
    docs = project_documents(project)
    document = next((d for d in docs if d['document_id'] == document_id), None)
    if not document:
        raise HTTPException(404, '原始文件未附带在知识库中')
    path = (project['materials'] / document['path']).resolve()
    if not path.is_relative_to(project['materials'].resolve()) or not path.is_file():
        raise HTTPException(404, '原始文件未附带在知识库中')
    return FileResponse(path, content_disposition_type='inline')


@app.get('/api/projects/{project_id}/preview/{document_id}')
def document_preview(project_id, document_id):
    project = project_for(project_id)
    # Reuse the exact source guard and safe path check for every preview, including questions.
    source_file(project_id, document_id)
    parsed_path = project['work'] / '00_document_units.json'
    parsed = read_json(parsed_path) if parsed_path.is_file() else {}
    document = next(d for d in project_documents(project, parsed) if d['document_id'] == document_id)
    units = [{**u, 'location': locator_text(u.get('locator', {}))} for u in parsed.get('units', [])
             if u['document_id'] == document_id]
    if not units and document['format'] == 'docx':
        with zipfile.ZipFile(project['materials'] / document['path']) as archive:
            root = ET.fromstring(archive.read('word/document.xml'))
        ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
        paragraphs = [''.join(t.text or '' for t in p.findall('.//w:t', ns)) for p in root.findall('.//w:p', ns)]
        units = [{'unit_id': 'original-text', 'location': '原始 DOCX 正文', 'content_md': '\n\n'.join(paragraphs)}]
    elif not units and document['format'] not in {'png', 'jpg', 'jpeg', 'webp'}:
        # Reading pending uploads must not freeze roles or create a knowledge graph.
        cache = DATA / 'previews' / project_id / document_id
        try:
            units = [{**u, 'location': locator_text(u.get('locator', {}))} for u in
                     Adapter(document, project['materials'] / document['path'], cache, dict(CONFIG)).run()]
        except Exception as exc:
            raise HTTPException(422, '正文预览解析失败，请下载原文件查看：' + str(exc)[:200]) from exc
    return {'document': document, 'source_url': f'/api/projects/{project_id}/source/{document_id}',
            'units': units, 'content_note': '正文按解析器保留的页码、表格或段落呈现。原始排版可下载原文件查看。'}


@app.get('/api/projects/{project_id}/benchmark-summary')
def benchmark_summary(project_id):
    project = project_for(project_id)
    read_graph(project)
    path = DATA / 'source-scope-regression/summary.json'
    if project_id != 'host' or not path.is_file():
        return {'available': False}
    report = read_json(path)
    digest = hashlib.sha256((project['work'] / '04_knowledge_graph.json').read_bytes()).hexdigest()
    if report.get('graph_sha256') != digest:
        return {'available': False, 'message': '图谱已更新，请重新运行检索回归'}
    return {**report, 'available': True, 'answer_accuracy': None,
            'note': '本记录是十题检索覆盖回归，不是验证集 B 的问答评分。'}


@app.get('/api/projects/{project_id}/review')
def host_review(project_id):
    project = project_for(project_id)
    path = project['work'].parent / 'qa/host-review.md'
    if not path.is_file():
        raise HTTPException(404, '该知识库没有宿主复核记录')
    return FileResponse(path, filename='host-review.md', media_type='text/markdown')


def default_role(name):
    if '问题集' in name:
        return 'questions'
    if any(word in name for word in ('标准答案', '参考答案', '任务书')):
        return 'reference'
    return 'corpus'


class Roles(BaseModel):
    roles: dict[str, str]


@app.post('/api/projects/{project_id}/roles')
def update_roles(project_id, body: Roles):
    project = project_for(project_id)
    if project['read_only'] or (project['work'] / 'state.json').is_file():
        raise HTTPException(409, '请在首次解析前设置资料角色；更改已解析语料请新建知识库')
    names = {p.name for p in project['materials'].glob('*') if p.is_file()}
    if set(body.roles) != names or any(r not in {'corpus', 'questions', 'reference'} for r in body.roles.values()):
        raise HTTPException(400, '需要为全部资料指定合法角色')
    if any('问题集' in n and r == 'corpus' for n, r in body.roles.items()):
        raise HTTPException(400, '问题集不能参与知识抽取')
    project['roles'] = body.roles
    save_project(project)
    return project_summary(project)


@app.post('/api/projects/upload')
async def upload(files: list[UploadFile] = File(...), project_id: str | None = Form(default=None)):
    if not 1 <= len(files) <= 50:
        raise HTTPException(400, '请上传 1–50 个文件')
    names = [(f.filename or '').replace('\\', '/').rsplit('/', 1)[-1] for f in files]
    if any(not n or re.search(r'[\x00-\x1f<>:"|?*]', n) or n.endswith((' ', '.')) or
           re.fullmatch(r'(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?', n, re.I) or
           Path(n).suffix.lower() not in SUPPORTED for n in names):
        raise HTTPException(400, '支持 PDF、DOCX、XLSX、PPTX、图片、Markdown 和 TXT')
    if project_id:
        target = project_for(project_id)
        if target['read_only'] or target.get('imported'):
            raise HTTPException(409, '此资料库不能追加原文件，请选择新建资料库')
    staging_root = DATA / 'uploads'
    staging_root.mkdir(parents=True, exist_ok=True)
    # Validate the whole batch before touching existing files or graph checkpoints.
    with tempfile.TemporaryDirectory(prefix='batch-', dir=staging_root) as directory:
        staged, total = [], 0
        for index, (file, name) in enumerate(zip(files, names)):
            size, digest = 0, hashlib.sha256()
            path = Path(directory) / str(index)
            with path.open('wb') as output:
                while chunk := await file.read(1024 * 1024):
                    size += len(chunk)
                    total += len(chunk)
                    if size > MAX_FILE or total > MAX_TOTAL:
                        raise HTTPException(413, '单文件上限 80 MB，每批总大小上限 300 MB')
                    output.write(chunk)
                    digest.update(chunk)
            staged.append((name, path, digest.hexdigest()))
        with lock:
            existing = project_for(project_id) if project_id else None
            if existing and any(r['project_id'] == project_id and r['status'] == 'running' for r in runs.values()):
                raise HTTPException(409, '该资料库正在运行任务，请完成或停止后追加文件')
            project_id = project_id or uuid.uuid4().hex
            base = existing['materials'].parent if existing else DATA / 'projects' / project_id
            materials = base / 'materials'
            if existing and source_scope(existing)['issues']:
                raise HTTPException(409, '原资料来源核验未通过，请先恢复原文件或新建资料库')
            binding = dict(existing.get('source_binding', {})) if existing else {}
            roles = dict(existing.get('roles', {})) if existing else {}
            known = {n.casefold(): n for n in binding}
            selected, skipped, renamed = [], [], []
            for name, path, digest in staged:
                original_name, number = name, 2
                while name.casefold() in known:
                    present = known[name.casefold()]
                    if binding[present] == digest:
                        skipped.append(original_name)
                        break
                    name = f'{Path(original_name).stem} ({number}){Path(original_name).suffix}'
                    number += 1
                else:
                    if name != original_name:
                        renamed.append({'from': original_name, 'to': name})
                    binding[name], roles[name], known[name.casefold()] = digest, default_role(original_name), name
                    selected.append((name, path))
            result = {'added': [n for n, _ in selected], 'skipped': skipped, 'renamed': renamed}
            if existing and not selected:
                return {**project_summary(existing), 'upload_result': result}
            # Keep the previous work directory intact, but never serve its stale graph.
            work_dir = 'work-' + uuid.uuid4().hex if existing else 'work'
            project = {**(existing or {}), 'id': project_id,
                       'name': existing['name'] if existing else Path(names[0]).stem + (' 等资料' if len(names) > 1 else ''),
                       'materials': materials, 'work': base / work_dir, 'work_dir': work_dir,
                       'read_only': False, 'roles': roles, 'user_uploaded': True, 'source_binding': binding}
            materials.mkdir(parents=True, exist_ok=True)
            created = []
            try:
                for name, path in selected:
                    target = materials / name
                    # Exclusive creation also protects unregistered files on disk.
                    with target.open('xb') as output, path.open('rb') as source:
                        created.append(target)
                        shutil.copyfileobj(source, output)
                save_project(project)
            except Exception:
                for target in created:
                    target.unlink(missing_ok=True)
                raise
            projects[project_id] = project
            return {**project_summary(project), 'upload_result': result}


@app.get('/api/projects/{project_id}/export')
def export(project_id):
    project = project_for(project_id)
    if not (project['work'] / '04_knowledge_graph.json').is_file():
        raise HTTPException(409, '图谱尚未完成')
    read_graph(project)
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in project['work'].rglob('*'):
            if path.is_file() and (path.name in {'04_knowledge_graph.json', '00_document_units.json', '03_canonical_facts.json'} or 'assets' in path.relative_to(project['work']).parts):
                archive.write(path, path.relative_to(project['work']).as_posix())
    return Response(out.getvalue(), media_type='application/zip', headers={'Content-Disposition': 'attachment; filename="evidence-knowledge-base.zip"'})


@app.get('/api/projects/{project_id}/export/html')
def export_mindmap(project_id, download: bool = True):
    project = project_for(project_id)
    graph = read_graph(project)
    images, image_bytes = {}, 0
    for document in graph['documents']:
        if document.get('role') != 'corpus' or document.get('format') not in {'png', 'jpg', 'jpeg', 'webp'}:
            continue
        path = (project['materials'] / document['path']).resolve()
        if path.is_relative_to(project['materials'].resolve()) and path.is_file() and path.stat().st_size <= 5 * 1024 * 1024:
            payload = path.read_bytes()
            if image_bytes + len(payload) <= 15 * 1024 * 1024:
                image_bytes += len(payload)
                images[document['path']] = 'data:' + (mimetypes.guess_type(path.name)[0] or 'image/png') + ';base64,' + base64.b64encode(payload).decode('ascii')
    html = mindmap_html(project, graph, enrich_evidence(project, graph['evidence']), images)
    return Response(html, media_type='text/html', headers={
        'Content-Disposition': ('attachment' if download else 'inline') + '; filename="evidence-mindmap.html"',
        'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; frame-ancestors 'self'"})


@app.post('/api/projects/import')
async def import_graph(file: UploadFile = File(...)):
    payload = await file.read(MAX_TOTAL + 1)
    if len(payload) > MAX_TOTAL:
        raise HTTPException(413, '知识库过大')
    try:
        archive = zipfile.ZipFile(io.BytesIO(payload))
        if sum(i.file_size for i in archive.infolist()) > MAX_TOTAL:
            raise ValueError('解压大小超过上限')
        names = archive.namelist()
        if not {'00_document_units.json', '04_knowledge_graph.json'} <= set(names):
            raise ValueError('需要完整知识库 ZIP：包含解析单元和知识图谱')
        project_id = uuid.uuid4().hex
        base = DATA / 'projects' / project_id
        work = base / 'work'
        for member in archive.infolist():
            relative = Path(member.filename.replace('\\', '/'))
            destination = (work / relative).resolve()
            if relative.is_absolute() or not destination.is_relative_to(work.resolve()):
                raise ValueError('ZIP 包含非法路径')
            if member.is_dir():
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(archive.read(member))
        _validate_query_graph(work)
        project = {'id': project_id, 'name': '导入的知识库', 'work': work, 'materials': base / 'materials', 'read_only': False, 'imported': True}
        project['materials'].mkdir(exist_ok=True)
        save_project(project)
        projects[project_id] = project
        return project_summary(project)
    except (ValueError, KeyError, RuntimeError, zipfile.BadZipFile) as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get('/api/projects/{project_id}/host-tasks')
def host_tasks(project_id):
    project = project_for(project_id)
    path = project['work'].parent / 'host_tasks.json'
    if not path.is_file():
        raise HTTPException(404, '请先解析资料')
    return FileResponse(path, filename='host_tasks.json')


def host_session(project):
    return InteractiveKGSession(ROOT / 'evidence_kg_openrouter_debug.ipynb', overrides={
        'MATERIALS_ROOT': project['materials'], 'RUN_ROOT': project['work'].parent,
        'WORK_DIR': project['work'], 'MODEL_OUTPUT_DIR': project['work'].parent / 'model_outputs',
        'MANIFEST_PATH': project['work'].parent / 'inputs.json', 'ROLE_OVERRIDES': project.get('roles', {})})


def host_next(project, session):
    state = read_json(project['work'] / 'state.json')
    stage = 'extract' if any(u['unit_id'] not in state['extractions'] for u in state['units']) else 'align'
    target = project['work'].parent / 'host_tasks.json'
    session._cli('tasks', '--stage', stage, '--work', project['work'], '--limit', 5 if stage == 'extract' else 8,
                 '--batch-count', 8, '--output', target)
    exported = read_json(target)
    if stage == 'align' and exported.get('stopped'):
        session._cli('build', '--work', project['work'])
        session._cli('validate', '--work', project['work'], '--require-complete')
    return exported


@app.post('/api/projects/{project_id}/host-response')
async def host_response(project_id, file: UploadFile = File(...)):
    project = project_for(project_id)
    if project['read_only']:
        raise HTTPException(400, '当前知识库只读')
    with lock:
        if any(r['project_id'] == project_id and r['kind'] == 'build' and r['status'] == 'running' for r in runs.values()):
            raise HTTPException(409, '请等待构图运行结束')
    payload = await file.read(8 * 1024 * 1024 + 1)
    if len(payload) > 8 * 1024 * 1024:
        raise HTTPException(413, '响应 JSON 上限 8 MB')
    try:
        body = json.loads(payload.decode('utf-8-sig'))
        exported = read_json(project['work'].parent / 'host_tasks.json')
        response_path = project['work'].parent / ('host_response_' + uuid.uuid4().hex + '.json')
        write_json(response_path, body)
        session = host_session(project)
        accepted = session._cli('accept', '--stage', exported['stage'], '--work', project['work'], '--response', response_path)
        next_export = host_next(project, session)
        return {'accepted': accepted, 'next_stage': next_export['stage'], 'pending': next_export['pending_count'],
                'project': project_summary(project)}
    except (ValueError, RuntimeError, KeyError, FileNotFoundError) as exc:
        raise HTTPException(400, str(exc)) from exc


dist = ROOT / 'app/frontend/dist'
if dist.is_dir():
    app.mount('/', StaticFiles(directory=dist, html=True), name='frontend')
