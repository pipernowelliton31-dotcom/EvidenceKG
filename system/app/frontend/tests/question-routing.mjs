import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
async function load(source) {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL(source, import.meta.url))], write: false,
    bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime'] });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
}
const { default: ChatTurn, Execution } = await load('../src/ChatTurn.tsx');
const { chatMarkdown, conversationLog } = await load('../src/conversationExport.ts');
const staleRetrieval = { type: 'retrieval.completed', stage: 'retrieve', message: 'PRIVATE_RETRIEVAL', elapsed_s: 1 };
const generation = { type: 'stage.started', stage: 'answer', message: '正在生成回答', elapsed_s: 2, mode: 'general' };
const generic = { id: 'general-turn', question: '你好', answer: '你好！', mode: 'general', model: 'mock-model',
  status: 'completed', events: [staleRetrieval, generation],
  evidence: [{ id: 'stale-evidence', source: '订单.xlsx', excerpt: 'stale source' }], paths: [{ steps: [] }],
  routing: { result: 'general', source: 'rule', elapsed_s: 0, usage: {} } };
const render = turn => renderToStaticMarkup(React.createElement(ChatTurn, { turn, elapsed: 2,
  read() {}, graph() {}, download() {}, sources() {} }));
const generalHTML = render(generic);
assert.match(generalHTML, /回答已完成/);
assert.match(generalHTML, /你好！/);
for (const forbidden of ['已完成本轮检索与回答', 'PRIVATE_RETRIEVAL', '查看来源与原文', '查看关联图谱', 'routing', '分类']) {
  assert.ok(!generalHTML.includes(forbidden), `General UI unexpectedly includes ${forbidden}`);
}
assert.match(generalHTML, /复制回答/);
assert.match(generalHTML, /导出回答/);
const knowledgeHTML = render({ ...generic, mode: 'answer' });
assert.match(knowledgeHTML, /已完成本轮检索与回答/);
assert.match(knowledgeHTML, /PRIVATE_RETRIEVAL/);
assert.match(knowledgeHTML, /查看来源与原文/);
assert.match(knowledgeHTML, /查看关联图谱/);
const waiting = renderToStaticMarkup(React.createElement(Execution, { events: [], mode: 'auto', elapsed: 0, running: true }));
assert.match(waiting, /正在处理问题/);
assert.ok(!waiting.includes('正在准备资料'));
assert.ok(!waiting.includes('0</span> 个步骤'));
const mixed = [generic, { ...generic, question: '查一下订单', answer: '## 结论\n资料回答', mode: 'answer' }];
const markdown = chatMarkdown(mixed);
assert.match(markdown, /## Question\n\n你好\n\n## Answer\n\n你好！/);
assert.match(markdown, /查一下订单/);
assert.ok(!markdown.includes('routing'));
assert.ok(!markdown.includes('stale source'));
const log = JSON.parse(conversationLog(mixed, { id: 'test', name: '测试' }));
assert.equal(log.turns[0].mode, 'general');
assert.equal(log.turns[1].mode, 'answer');
assert.equal(log.turns[0].routing.result, 'general');
console.log('Question routing: general/knowledge UI states and mixed conversation exports passed.');
