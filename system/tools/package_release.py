"""Build a distributable zip from the repo without modifying the live workspace."""
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
import zipfile
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SYSTEM = REPO / 'system'
FRONTEND = SYSTEM / 'app' / 'frontend'
OUTPUT = REPO / 'output'
TEST_SET_A_PREFIX = '测试集A_'
TEST_SET_B_PROJECT = 'a7a75a0d85c04cfcae8aba4c1f6cce15'
SECRET_NAMES = {'.env', 'local_api.json'}
SKIP_DIR_NAMES = {
    '.git', '.vscode', '.playwright-cli', 'node_modules', '__pycache__', '.vite',
    'output', '资料与报告', 'sites',
}
RUNS_SKIP_DIR_PREFIXES = ('ui-change-backup-', 'ui-claude-backup-')
RUNS_SKIP_DIR_EXACT = {'path-check'}


def build_frontend() -> None:
    if not (FRONTEND / 'package.json').is_file():
        raise SystemExit('frontend package.json missing')
    npm = shutil.which('npm') or shutil.which('npm.cmd')
    if not npm:
        raise SystemExit('npm not found; install Node.js or run npm run build manually')
    subprocess.run([npm, 'run', 'build'], cwd=FRONTEND, check=True)


def secret_file(path: Path) -> bool:
    name = path.name.lower()
    if name in SECRET_NAMES:
        return True
    if name.startswith('.env') or name.endswith('.env'):
        return True
    return False


def test_data_allowed(rel: Path) -> bool:
    if rel.parent.as_posix() != '测试数据':
        return True
    return rel.name.startswith(TEST_SET_A_PREFIX)


def runs_web_allowed(rel: Path) -> bool:
    parts = rel.parts
    if len(parts) < 3 or parts[0] != 'system' or parts[1] != 'runs' or parts[2] != 'web':
        return True
    if parts[3:4] == ['runs']:
        return False
    if parts[3:4] == ['projects']:
        if len(parts) < 5:
            return True
        project_id = parts[4]
        if project_id != TEST_SET_B_PROJECT:
            return False
        if 'model_outputs' in parts:
            return False
        if len(parts) == 6 and parts[5].startswith('interactive_') and parts[5].endswith('.json'):
            return False
    return True


def should_skip(rel: Path) -> bool:
    if secret_file(rel):
        return True
    if not test_data_allowed(rel):
        return True
    if not runs_web_allowed(rel):
        return True
    parts = rel.parts
    if 'system' in parts:
        idx = parts.index('system')
        tail = parts[idx + 1:]
        if tail[:1] == ['runs']:
            if len(tail) >= 2 and tail[1] in RUNS_SKIP_DIR_EXACT:
                return True
            if len(tail) >= 2 and any(tail[1].startswith(prefix) for prefix in RUNS_SKIP_DIR_PREFIXES):
                return True
    return False


def iter_files(root: Path):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(
            name for name in dirnames
            if name not in SKIP_DIR_NAMES
            and not name.startswith('.')
            and not any(name.startswith(prefix) for prefix in RUNS_SKIP_DIR_PREFIXES)
            and name not in RUNS_SKIP_DIR_EXACT
        )
        for name in filenames:
            path = Path(dirpath) / name
            rel = path.relative_to(root)
            if should_skip(rel):
                continue
            yield rel, path


def patch_test_set_b(project_dir: Path) -> None:
    project_json = project_dir / 'project.json'
    if not project_json.is_file():
        return
    import json
    data = json.loads(project_json.read_text(encoding='utf-8'))
    data['name'] = '测试集 B · 演示资料'
    data['user_uploaded'] = True
    project_json.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def package_release(out_path: Path, skip_build: bool) -> None:
    if not skip_build:
        build_frontend()
    if not (FRONTEND / 'dist' / 'index.html').is_file():
        raise SystemExit('frontend dist missing; run npm run build in system/app/frontend')

    staging = OUTPUT / '_package_staging'
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True, exist_ok=True)

    include_roots = [
        REPO / '启动系统.bat',
        REPO / '检查运行环境.bat',
        SYSTEM,
        REPO / '测试数据',
    ]
    for src in include_roots:
        if not src.exists():
            if src.name == '测试数据':
                raise SystemExit('测试数据 directory missing')
            continue
        if src.is_file():
            dest = staging / src.name
            shutil.copy2(src, dest)
            continue
        dest = staging / src.name
        shutil.copytree(src, dest, ignore=shutil.ignore_patterns(*SKIP_DIR_NAMES, '*.pyc'))

    # Strip secrets and non-release data from the staging copy only.
    runs_root = staging / 'system' / 'runs'
    if runs_root.is_dir():
        for item in list(runs_root.iterdir()):
            if item.name in RUNS_SKIP_DIR_EXACT or any(item.name.startswith(prefix) for prefix in RUNS_SKIP_DIR_PREFIXES):
                shutil.rmtree(item, ignore_errors=True)

    for path in list(staging.rglob('*')):
        rel = path.relative_to(staging)
        if path.is_file() and should_skip(rel):
            path.unlink(missing_ok=True)
    for path in sorted(staging.rglob('*'), reverse=True):
        if path.is_dir() and not any(path.iterdir()):
            path.rmdir()

    web_projects = staging / 'system' / 'runs' / 'web' / 'projects'
    for item in list(web_projects.iterdir()) if web_projects.is_dir() else []:
        if item.name != TEST_SET_B_PROJECT:
            shutil.rmtree(item, ignore_errors=True)
    runs_dir = staging / 'system' / 'runs' / 'web' / 'runs'
    if runs_dir.is_dir():
        shutil.rmtree(runs_dir)
    runs_dir.mkdir(parents=True, exist_ok=True)
    (runs_dir / '.gitkeep').write_text('', encoding='utf-8')

    b_project = web_projects / TEST_SET_B_PROJECT
    if b_project.is_dir():
        shutil.rmtree(b_project / 'model_outputs', ignore_errors=True)
        for item in b_project.glob('interactive_*.json'):
            item.unlink(missing_ok=True)
        patch_test_set_b(b_project)

    for secret in staging.rglob('local_api.json'):
        secret.unlink(missing_ok=True)
    for secret in staging.rglob('.env*'):
        if secret.is_file():
            secret.unlink(missing_ok=True)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    if out_path.exists():
        out_path.unlink()
    with zipfile.ZipFile(out_path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for path in staging.rglob('*'):
            if path.is_file():
                archive.write(path, path.relative_to(staging).as_posix())

    shutil.rmtree(staging, ignore_errors=True)
    size_mb = out_path.stat().st_size / (1024 * 1024)
    print(f'Created {out_path} ({size_mb:.1f} MB)', flush=True)


def main():
    parser = argparse.ArgumentParser(description='Package GraphMind for distribution')
    parser.add_argument('--skip-build', action='store_true', help='Skip npm run build')
    parser.add_argument('--out', type=Path, help='Output zip path')
    args = parser.parse_args()
    stamp = datetime.now().strftime('%Y%m%d')
    out = args.out or (OUTPUT / f'GraphMind-portable-{stamp}.zip')
    package_release(out.resolve(), skip_build=args.skip_build)


if __name__ == '__main__':
    main()
