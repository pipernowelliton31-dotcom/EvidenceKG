"""Relocatable Windows launcher. Uses only the Python runtime shipped beside the app."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import socket
import sys
import threading
import time
import urllib.request
import webbrowser

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)
sys.path.insert(0, str(ROOT))


def check():
    from app.server import projects, project_detail, source_scope, read_json, host_session, document_preview
    from lean_graphrag import LeanGraphRAG
    project = projects['host']
    parsed = read_json(project['work'] / '00_document_units.json')
    graph = read_json(project['work'] / '04_knowledge_graph.json')
    scope = source_scope(project, graph, parsed)
    assert scope['verified'], scope['issues']
    assert (ROOT / 'app/frontend/dist/index.html').is_file()
    session = host_session(project)
    assert session.runtime['SKILL_DIR'].is_relative_to(ROOT)
    detail = project_detail('host')
    for doc in parsed['documents']:
        document_preview('host', doc['document_id'])
    result = LeanGraphRAG(project['work']).retrieve('code-assist-pro 依赖哪些工具？')
    assert result['stats']['facts'] > 0
    print(json.dumps({'status': 'ok', 'python': sys.version.split()[0],
        'runtime': str(Path(sys.executable).resolve()), 'root': str(ROOT),
        'verified_files': len(scope['files']), 'entities': len(detail['entity_graph']['nodes']),
        'relations': len(detail['entity_graph']['edges']), 'retrieval': result['stats']}, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--port', type=int)
    args = parser.parse_args()
    if args.check:
        check()
        return
    import uvicorn
    candidates = [args.port] if args.port is not None else range(8000, 8020)
    server_socket = None
    for port in candidates:
        candidate = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            candidate.bind(('127.0.0.1', port))
            candidate.listen(128)
            server_socket = candidate
            break
        except OSError:
            candidate.close()
    if server_socket is None:
        raise SystemExit('Ports 8000-8019 are busy. Close an older instance, then try again.')
    url = f'http://127.0.0.1:{server_socket.getsockname()[1]}/'
    print('Evidence KG | Portable Windows x64', flush=True)
    print('URL: ' + url, flush=True)
    print('Keep this window open. Press Ctrl+C to stop.', flush=True)
    if not args.no_browser:
        def open_when_ready():
            for _ in range(100):
                try:
                    with urllib.request.urlopen(url + 'api/bootstrap', timeout=1) as response:
                        if response.status == 200:
                            webbrowser.open(url)
                            return
                except (OSError, ValueError):
                    time.sleep(.25)
            print('Browser did not open. Open the URL above manually.', flush=True)
        threading.Thread(target=open_when_ready, daemon=True).start()
    try:
        uvicorn.Server(uvicorn.Config('app.server:app', host='127.0.0.1', log_level='info')).run(sockets=[server_socket])
    finally:
        server_socket.close()


if __name__ == '__main__':
    main()
