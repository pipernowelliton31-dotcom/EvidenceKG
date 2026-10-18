"""Upload to an isolated temporary store; never change user projects."""
import asyncio
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import server
from fastapi import UploadFile


class FolderUploadTests(unittest.TestCase):
    def test_nested_same_name_files_are_preserved_and_duplicate_content_skipped(self):
        async def exercise():
            with tempfile.TemporaryDirectory() as folder, patch.object(server, 'DATA', Path(folder)), patch.dict(server.projects, {}, clear=True):
                files = [UploadFile(io.BytesIO(content), filename=name) for name, content in [
                    ('资料/甲/记录.txt', b'first document'),
                    ('资料/乙/记录.txt', b'second document'),
                    ('资料/丙/记录.txt', b'first document'),
                    ('资料/笔记.md', b'# notes'),
                ]]
                try:
                    result = await server.upload(files, project_id=None)
                    self.assertEqual(result['upload_result']['added'], ['记录.txt', '记录 (2).txt', '笔记.md'])
                    self.assertEqual(result['upload_result']['skipped'], ['记录.txt'])
                    project = server.projects[result['id']]
                    self.assertEqual((project['materials'] / '记录.txt').read_bytes(), b'first document')
                    self.assertEqual((project['materials'] / '记录 (2).txt').read_bytes(), b'second document')
                    self.assertEqual(len(project['source_binding']), 3)
                    self.assertFalse(result['ready'])
                finally:
                    for file in files:
                        await file.close()
        asyncio.run(exercise())


if __name__ == '__main__':
    unittest.main()
