"""Model response normalization, bounded retries and local failure diagnostics."""
from __future__ import annotations

import copy
import json
from pathlib import Path
import re
import time
import uuid

import requests

EXTRACT_MAX_TOKENS = 32768
ALIGN_MAX_TOKENS = 16384
QA_MAX_TOKENS = 16384
MAX_OUTPUT_TOKENS = 65536


class ModelResponseError(ValueError):
    def __init__(self, message, *, retryable=True, truncated=False):
        super().__init__(message)
        self.retryable = retryable
        self.truncated = truncated


def normalize_content(content):
    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        return copy.deepcopy(content)
    if isinstance(content, list):
        # Concatenate fragments without adding characters that could corrupt JSON strings.
        texts = [part['text'] for part in content if isinstance(part, dict)
                 and part.get('type') in {'text', 'output_text'} and isinstance(part.get('text'), str)]
        if texts:
            return ''.join(texts)
    raise ModelResponseError(f'模型没有可用正文（content_type={type(content).__name__}）')


def parse_content(content):
    content = normalize_content(content)
    if isinstance(content, dict):
        return content
    text = content.strip()
    if not text:
        raise ModelResponseError('模型返回空正文（content_type=str）')
    text = re.sub(r'^```(?:json)?\s*', '', text, flags=re.I)
    text = re.sub(r'\s*```$', '', text)
    try:
        return json.loads(text)
    except ValueError as exc:
        start, end = text.find('{'), text.rfind('}')
        if start >= 0 and end > start:
            try:
                return json.loads(text[start:end + 1])
            except ValueError:
                pass
        raise ModelResponseError('模型正文不是有效 JSON') from exc


def response_summary(body):
    body = body if isinstance(body, dict) else {}
    choices = body.get('choices')
    choice = choices[0] if isinstance(choices, list) and choices and isinstance(choices[0], dict) else {}
    message = choice.get('message')
    message = message if isinstance(message, dict) else {}
    usage = body.get('usage')
    usage = usage if isinstance(usage, dict) else {}
    details = usage.get('completion_tokens_details')
    details = details if isinstance(details, dict) else {}
    return {'generation_id': body.get('id'), 'model': body.get('model'), 'provider': body.get('provider'),
            'content_type': type(message.get('content')).__name__, 'finish_reason': choice.get('finish_reason'),
            'native_finish_reason': choice.get('native_finish_reason'),
            'prompt_tokens': usage.get('prompt_tokens'), 'completion_tokens': usage.get('completion_tokens'),
            'reasoning_tokens': details.get('reasoning_tokens'), 'total_tokens': usage.get('total_tokens')}


def decode_response(body, *, expect_tasks, max_tokens):
    if not isinstance(body, dict):
        raise ModelResponseError('接口响应顶层不是 JSON 对象')
    if body.get('error'):
        raise ModelResponseError(f'模型接口返回错误：{body["error"]}')
    choices = body.get('choices')
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise ModelResponseError('接口响应缺少有效 choices[]')
    choice = choices[0]
    message = choice.get('message')
    if not isinstance(message, dict):
        raise ModelResponseError('接口响应缺少有效 message')
    finish = choice.get('finish_reason')
    if message.get('refusal') or finish == 'content_filter':
        raise ModelResponseError('模型拒绝输出或内容被过滤', retryable=False)
    if choice.get('error') or finish == 'error':
        raise ModelResponseError(f'模型生成失败：{choice.get("error") or finish}')
    if finish == 'length':
        raise ModelResponseError(f'模型输出被截断（max_tokens={max_tokens}）', truncated=True)
    if finish == 'tool_calls':
        raise ModelResponseError('模型返回工具调用，当前任务需要最终正文', retryable=False)
    content = message.get('content')
    if expect_tasks:
        obj = parse_content(content)
        if not isinstance(obj, dict) or not isinstance(obj.get('tasks'), list) or not obj['tasks']:
            raise ModelResponseError('模型结果缺少非空 tasks[]')
        return obj, content
    answer = normalize_content(content)
    if not isinstance(answer, str) or not answer.strip():
        raise ModelResponseError('模型没有返回有效答案正文')
    return answer, content


def redact(value, secret):
    if isinstance(value, str):
        return value.replace(secret, '[redacted]') if secret else value
    if isinstance(value, dict):
        return {k: redact(v, secret) for k, v in value.items()}
    if isinstance(value, list):
        return [redact(v, secret) for v in value]
    return value


def request_model(payload, *, api_key, base_url, output_dir, stage, batch_index=0,
                  task_count=1, timeout=300, retries=2, cap=MAX_OUTPUT_TOKENS,
                  expect_tasks=True, call_logs=None, response_metadata=None):
    """Keep successful checkpoints separate from incomplete/rejected model responses."""
    payload = copy.deepcopy(payload)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    call_logs = call_logs if call_logs is not None else []
    # Respect an explicit larger starting budget; never shrink it on a retry.
    cap = max(int(cap), int(payload['max_tokens']))
    for attempt in range(retries + 1):
        started = time.perf_counter()
        response, body = None, None
        try:
            response = requests.post(base_url.rstrip('/') + '/chat/completions',
                headers={'Authorization': 'Bearer ' + api_key, 'Content-Type': 'application/json'},
                json=payload, timeout=(30, timeout))
            try:
                body = response.json()
            except ValueError:
                body = {'raw_text': response.text}
                response.raise_for_status()
                raise ModelResponseError('接口没有返回 JSON 响应')
            response.raise_for_status()
            obj, content = decode_response(body, expect_tasks=expect_tasks, max_tokens=payload['max_tokens'])
        except (requests.RequestException, ModelResponseError) as exc:
            summary = response_summary(body)
            diagnostic = '; '.join(f'{k}={summary[k]}' for k in
                                  ('content_type', 'finish_reason', 'completion_tokens', 'reasoning_tokens'))
            error = redact(str(exc) + '; ' + diagnostic, api_key)
            failed = output_dir / f'{stage}_b{batch_index:02d}_{uuid.uuid4().hex[:12]}_a{attempt+1}_failed_response.json'
            failed.write_text(json.dumps(redact({'stage': stage, 'batch_index': batch_index,
                'attempt': attempt + 1, 'max_tokens': payload['max_tokens'],
                'http_status': response.status_code if response is not None else None,
                'summary': summary, 'error': error, 'response': body}, api_key),
                ensure_ascii=False, indent=2), encoding='utf-8')
            call_logs.append({'stage': stage, 'batch_index': batch_index, 'tasks': task_count,
                'attempt': attempt + 1, 'status': 'failed', 'elapsed_s': round(time.perf_counter()-started, 3),
                'max_tokens': payload['max_tokens'], 'error': error, 'raw_path': str(failed), **summary})
            retryable = getattr(exc, 'retryable', True)
            if isinstance(exc, requests.HTTPError) and response is not None:
                retryable = response.status_code in {408, 429} or response.status_code >= 500
            next_budget = payload['max_tokens']
            if getattr(exc, 'truncated', False):
                next_budget = min(cap, payload['max_tokens'] * 2)
                retryable = retryable and next_budget > payload['max_tokens']
            if not retryable or attempt >= retries:
                if isinstance(exc, ModelResponseError):
                    raise ModelResponseError(error + f'; 诊断文件={failed}', retryable=False,
                                             truncated=exc.truncated) from exc
                raise
            payload['max_tokens'] = next_budget
            time.sleep(1.5 * (2 ** attempt))
            continue
        elapsed = time.perf_counter() - started
        if isinstance(obj, dict) and response_metadata:
            obj.update(response_metadata)
        summary = response_summary(body)
        stem = f'{stage}_batch_{batch_index:02d}_{time.time_ns()}'
        raw_txt, raw_json = output_dir / (stem + '.txt'), output_dir / (stem + '.json')
        raw_txt.write_text(content if isinstance(content, str) else json.dumps(content, ensure_ascii=False), encoding='utf-8')
        raw_json.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding='utf-8')
        usage = body.get('usage')
        usage = usage if isinstance(usage, dict) else {}
        log = {'stage': stage, 'batch_index': batch_index, 'tasks': task_count, 'attempt': attempt + 1,
               'status': 'ok', 'elapsed_s': round(elapsed, 3), 'max_tokens': payload['max_tokens'],
               'cost': usage.get('cost'), 'raw_path': str(raw_txt), **summary}
        call_logs.append(log)
        return {'response': obj, 'raw_content': content, 'body': body, 'log': log}
