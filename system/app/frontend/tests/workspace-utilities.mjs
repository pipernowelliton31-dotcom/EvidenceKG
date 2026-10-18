import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function moduleFrom(file) {
  const source = await readFile(new URL(`../src/${file}.ts`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const { droppedFiles, validateUpload } = await moduleFrom('uploadFiles');
const { conversationLog, chatMarkdown, conversationHtml } = await moduleFrom('conversationExport');
const file = (name, size = 1) => ({ name, size });
const entry = name => ({ name, isFile: true, file: resolve => resolve(file(name)) });
const directory = (name, batches) => ({ name, isDirectory: true, createReader: () => {
  let i = 0;
  return { readEntries: resolve => resolve(batches[i++] || []) };
} });
const transfer = entries => ({ items: entries.map(item => ({ kind: 'file', webkitGetAsEntry: () => item, getAsFile: () => null })), files: [] });

const nested = await droppedFiles(transfer([directory('资料', [[entry('首页.md'), directory('子目录', [[entry('附件.txt')]])], [entry('末批.pdf')]])]));
assert.deepEqual(nested.map(f => f.name), ['首页.md', '附件.txt', '末批.pdf']);
// Keep reading after Chromium's first 100-entry batch, including unsupported items.
const batches = await droppedFiles(transfer([directory('资料', [Array.from({ length: 100 }, (_, i) => entry(`ignored-${i}.bin`)), [entry('最后.txt')]])]));
assert.equal(batches[0].name, '最后.txt');
assert.deepEqual(await droppedFiles({ items: [], files: [file('兼容.txt')] }), [file('兼容.txt')]);
await assert.rejects(droppedFiles(transfer([directory('太多', [Array.from({ length: 51 }, (_, i) => entry(`${i}.txt`))])])), /50/);
await assert.rejects(droppedFiles(transfer([{ name: '不可读.txt', isFile: true, file: (_, reject) => reject(new Error('permission denied')) }])), /无法读取/);
assert.deepEqual(validateUpload([file('正文.txt'), file('~$临时.docx'), file('Thumbs.db'), file('other.exe')]), { files: [file('正文.txt')], skipped: 3 });
assert.throws(() => validateUpload([]), /未找到/);
assert.throws(() => validateUpload(Array.from({ length: 51 }, () => file('正文.txt'))), /50/);
assert.throws(() => validateUpload([file('过大.pdf', 81 * 1024 * 1024)]), /80 MB/);
assert.throws(() => validateUpload(Array.from({ length: 4 }, () => file('正文.pdf', 80 * 1024 * 1024))), /300 MB/);
assert.throws(() => validateUpload([file('普通.txt')], true), /ZIP/);
assert.equal(validateUpload([file('备份.zip')], true).files.length, 1);
assert.equal(validateUpload([file('备份.zip', 200 * 1024 * 1024)], true).files.length, 1);
assert.throws(() => validateUpload([file('备份.zip', 301 * 1024 * 1024)], true), /300 MB/);

const records = [{ id: 'run-1', model: 'test-model', question: '原始问题', status: 'completed', created_at: 1, answer: '完整回答\n```md\n内部代码\n```\n结束', usage: { total_tokens: 42 }, events: [{ type: 'retrieval.completed', elapsed_s: .2, stats: { facts: 3 }, evidence: [{ source: '资料.pdf', location: 'page=2', excerpt: '原文全文' }], graph: { nodes: [{ id: 'n1' }], edges: [] }, paths: [{ node_ids: ['n1'] }], context: '完整检索上下文' }, { type: 'answer.delta', text: '保留的流式片段', elapsed_s: .3 }] }, { id: 'run-2', question: '追问', status: 'failed', events: [{ type: 'answer.delta', text: '部分正文', elapsed_s: 1 }, { type: 'run.error', message: '连接中断', elapsed_s: 2 }] }];
const log = JSON.parse(conversationLog(records, { id: 'project-1', name: '测试资料库' }, new Date('2026-10-18T00:00:00Z')));
assert.deepEqual(log.turns, records, 'JSON log must preserve every saved field and all turns');
assert.deepEqual(log.project, { id: 'project-1', name: '测试资料库' });
assert.equal(log.exported_at, '2026-10-18T00:00:00.000Z');
assert.equal(chatMarkdown(records), `## Question\n\n原始问题\n\n## Answer\n\n${records[0].answer}\n\n---\n\n## Question\n\n追问\n\n## Answer\n\n部分正文\n`, 'Chat export must contain only question/answer, without execution metadata or errors');
assert.equal(chatMarkdown([{ question: '只保留问答', events: [{ type: 'answer.completed', answer: '完成的回答' }] }]), '## Question\n\n只保留问答\n\n## Answer\n\n完成的回答\n');
const page = conversationHtml([{ question: '<script>alert(1)</script>', answer: '安全正文' }], { id: 'p', name: '库' }, new Date('2026-10-18T00:00:00Z'));
assert.match(page, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
assert.doesNotMatch(page, /<script>alert\(1\)<\/script>/);
assert.match(page, /安全正文/);
const rich = conversationHtml([{ question: '程序员老王买了啥', model: 'deepseek-flash', answer: '## 1. 结论\n\n**番茄时钟Pro** 于 **2025-10-03** 购买。' }], { id: 'p', name: '库' }, new Date('2026-10-18T00:00:00Z'));
assert.match(rich, /<h2>1\. 结论<\/h2>/);
assert.match(rich, /<strong>番茄时钟Pro<\/strong>/);
assert.match(rich, /class="markdown"/);
assert.doesNotMatch(rich, /<pre>## 1\. 结论/);
console.log('PASS: folder upload, complete JSON logs and question/answer-only Markdown export.');
