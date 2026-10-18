"""Atomic JSON snapshots with bounded retries for Windows file sharing locks."""
import json
import os
from pathlib import Path
import tempfile
import time


def atomic_write_json(path, body):
    path = Path(path)
    payload = json.dumps(body, ensure_ascii=False, indent=2, default=str)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        # Unique names prevent separate writers/processes from sharing a .tmp.
        # Close the handle before replacing, as required on Windows.
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent,
                                         prefix=path.name + '.', suffix='.tmp', delete=False) as output:
            temporary = Path(output.name)
            output.write(payload)
        delays = (.01, .02, .04, .08, .16, .2, .25)
        for attempt in range(len(delays) + 1):
            try:
                os.replace(temporary, path)
                return
            except OSError as exc:
                # Readers, antivirus and indexers can briefly deny rename/delete
                # sharing. Permanent failures still surface; never truncate the old file.
                if getattr(exc, 'winerror', None) not in {5, 32, 33} or attempt == len(delays):
                    raise
                time.sleep(delays[attempt])
    finally:
        if temporary is not None:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                # A scanner can also hold the temporary file; keep the original error.
                pass
