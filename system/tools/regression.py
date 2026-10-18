"""Reproduce all ten retrievals; optional live QA uses the same LeanGraphRAG caller."""
from __future__ import annotations
import argparse
import hashlib
import json
import re
import sys
import time
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'skill/evidence-kg-builder/scripts'))
from lean_graphrag import LeanGraphRAG
from kg_core import validate_graph


def questions():
    ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
    path = next((ROOT / 'materials').glob('*问题集.docx'))
    xml = ET.fromstring(ZipFile(path).read('word/document.xml'))
    paragraphs = [''.join(t.text or '' for t in p.findall('.//w:t', ns)) for p in xml.findall('.//w:p', ns)]
    result = []
    for i, text in enumerate(paragraphs):
        match = re.match(r'^(Q\d+)\s+(.+)', text)
        if match:
            result.append({'id': match[1], 'title': match[2], 'question': paragraphs[i + 1]})
    if len(result) != 10:
        raise ValueError(f'Expected ten questions, got {len(result)}')
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--work', type=Path, default=ROOT / 'examples/prebuilt/work')
    parser.add_argument('--output', type=Path, default=ROOT / 'runs/regression')
    parser.add_argument('--answer', action='store_true')
    parser.add_argument('--model')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    rag = LeanGraphRAG(args.work, context_chars=18000)
    graph_path = args.work / '04_knowledge_graph.json'
    report = {'mode': 'live_api' if args.answer else 'retrieval_only',
              'graph_sha256': hashlib.sha256(graph_path.read_bytes()).hexdigest(),
              'validation': validate_graph(json.loads(graph_path.read_text(encoding='utf-8'))), 'questions': []}
    for question in questions():
        start = time.perf_counter()
        result = rag.retrieve(question['question'])
        if args.answer:
            result['answer'] = rag.ask(question['question'], model=args.model, env_file=ROOT / '.env')
        (args.output / (question['id'] + '.json')).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        (args.output / (question['id'] + '-context.md')).write_text(result['context'], encoding='utf-8')
        report['questions'].append({**question, 'elapsed_s': round(time.perf_counter() - start, 3),
                                    'intent': result['query_plan']['intent'], 'stats': result['stats']})
        print(question['id'], result['stats'], flush=True)
    (args.output / 'summary.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
