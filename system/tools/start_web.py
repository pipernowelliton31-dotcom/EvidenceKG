"""Run the local workspace from any current directory."""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)
sys.path.insert(0, str(ROOT))

if not (ROOT / 'app/frontend/dist/index.html').is_file():
    raise SystemExit('Frontend not built. Run: cd app/frontend && npm ci && npm run build')
try:
    import uvicorn
except ImportError:
    raise SystemExit('Web dependencies missing. Run: .venv/Scripts/python.exe -m pip install -r app/requirements.txt')

if __name__ == '__main__':
    port = int(os.environ.get('EVIDENCE_WEB_PORT', '8000'))
    print(f'Evidence workspace: http://127.0.0.1:{port}', flush=True)
    print('Keep this terminal open. Ctrl+C stops the server.', flush=True)
    uvicorn.run('app.server:app', host='127.0.0.1', port=port)
