"""Export the same verified source-bound HTML offered by the Web download."""
import argparse
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.server import export_mindmap

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--project', default='host')
    parser.add_argument('--output', type=Path, default=ROOT / 'output/evidence-mindmap.html')
    args = parser.parse_args()
    response = export_mindmap(args.project)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(response.body)
    print(args.output)
