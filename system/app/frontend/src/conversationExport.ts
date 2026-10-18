type RecordData = Record<string, any>;
function answerText(record: RecordData): string {
  const events: RecordData[] = record.events || [];
  return record.answer || events.find(event => event.type === 'answer.completed')?.answer || events.filter(event => event.type === 'answer.delta').map(event => event.text || '').join('');
}

export function chatMarkdown(records: RecordData[]): string {
  return records.map(record => `## Question\n\n${record.question || ''}\n\n## Answer\n\n${answerText(record)}`).join('\n\n---\n\n') + '\n';
}

export function conversationLog(records: RecordData[], project: { id: string; name: string }, now = new Date()): string {
  return JSON.stringify({ project, exported_at: now.toISOString(), turns: records }, null, 2) + '\n';
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
}

function inlineMarkdown(text: string): string {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    const href = String(url).trim();
    if (!/^https?:\/\//i.test(href)) return escapeHtml(label);
    return `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
  });
  return html;
}

function markdownToHtml(input: string): string {
  const lines = input.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.startsWith('```')) {
      index += 1;
      const code: string[] = [];
      while (index < lines.length && !lines[index].startsWith('```')) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      out.push('<hr/>');
      index += 1;
      continue;
    }
    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*+]\s+/.test(lines[index])) {
        items.push(`<li>${inlineMarkdown(lines[index].replace(/^[-*+]\s+/, ''))}</li>`);
        index += 1;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        items.push(`<li>${inlineMarkdown(lines[index].replace(/^\d+\.\s+/, ''))}</li>`);
        index += 1;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !/^(#{1,6}\s|[-*+]\s|\d+\.\s|```|---)/.test(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    out.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
  }
  return out.join('\n');
}

const exportStyles = `
  :root { color-scheme: light; --bg:#fcfcfb; --fg:#302e2b; --fg-2:#4a4540; --muted:#716b62; --line:#dedbd3; --soft:#f0eee8; --accent:#9a5848; --accent-line:#d8b4a8; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.85 "Segoe UI","Microsoft YaHei","PingFang SC",sans-serif; }
  header.page-header { max-width: 820px; margin: 0 auto; padding: 48px 28px 28px; border-bottom: 1px solid var(--line); }
  header.page-header strong { display: block; font: 500 30px/1.35 "Palatino Linotype", Palatino, "华文中宋", serif; letter-spacing: .01em; }
  header.page-header p { margin: 12px 0 0; color: var(--muted); font-size: 13px; line-height: 1.7; }
  main { max-width: 820px; margin: 0 auto; padding: 8px 28px 80px; }
  .turn { padding: 36px 0; border-bottom: 1px solid var(--line); }
  .turn:last-child { border-bottom: 0; }
  .turn-head { display: grid; grid-template-columns: auto 1fr; gap: 14px; align-items: start; }
  .label { display: inline-flex; align-items: center; justify-content: center; min-width: 34px; height: 28px; padding: 0 10px; border-radius: 999px; font: 600 12px/1 "Segoe UI","Microsoft YaHei",sans-serif; letter-spacing: .06em; }
  .label-q { background: var(--soft); color: var(--accent); }
  .label-a { background: #ebe8e1; color: var(--fg-2); }
  .question { margin: 2px 0 0; padding: 16px 18px; border-radius: 14px; background: var(--soft); color: var(--fg); font: 500 17px/1.75 "Segoe UI","Microsoft YaHei",sans-serif; overflow-wrap: anywhere; }
  .answer { margin-top: 28px; }
  .answer-head { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
  .answer-head .model { color: var(--muted); font-size: 12px; line-height: 1.4; }
  .markdown { color: var(--fg-2); font: 16px/1.9 "Segoe UI","Microsoft YaHei","PingFang SC",sans-serif; overflow-wrap: anywhere; }
  .markdown > :first-child { margin-top: 0; }
  .markdown > :last-child { margin-bottom: 0; }
  .markdown p { margin: 14px 0; }
  .markdown h1, .markdown h2, .markdown h3, .markdown h4 { margin: 28px 0 12px; color: var(--fg); font-weight: 600; line-height: 1.55; letter-spacing: normal; }
  .markdown h1 { font-size: 24px; }
  .markdown h2 { font-size: 20px; }
  .markdown h3 { font-size: 17px; }
  .markdown h4 { font-size: 15px; }
  .markdown ul, .markdown ol { margin: 14px 0; padding-left: 1.35em; }
  .markdown li { margin: 6px 0; }
  .markdown li > p { margin: 4px 0; }
  .markdown strong { color: var(--fg); font-weight: 600; }
  .markdown a { color: var(--accent); text-underline-offset: 3px; }
  .markdown code { padding: 2px 6px; border-radius: 5px; background: var(--soft); color: var(--fg); font: .9em/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; }
  .markdown pre { margin: 18px 0; padding: 16px 18px; border: 1px solid var(--line); border-radius: 12px; background: var(--soft); overflow: auto; }
  .markdown pre code { padding: 0; background: none; font-size: 13px; line-height: 1.65; white-space: pre-wrap; }
  .markdown hr { margin: 28px 0; border: 0; border-top: 1px solid var(--line); }
  .markdown blockquote { margin: 16px 0; padding: 6px 18px; border-left: 3px solid var(--accent-line); background: var(--soft); color: var(--fg-2); }
  @media (max-width: 640px) {
    header.page-header, main { padding-left: 18px; padding-right: 18px; }
    .turn-head { grid-template-columns: 1fr; gap: 10px; }
    .question { font-size: 16px; }
  }
`;

export function conversationHtml(records: RecordData[], project: { id: string; name: string }, now = new Date()): string {
  const title = (records[0]?.question || '对话').replace(/\s+/g, ' ').slice(0, 80);
  const turns = records.map(record => {
    const model = record.model ? `<span class="model">${escapeHtml(String(record.model))}</span>` : '';
    const answer = markdownToHtml(answerText(record));
    return `<article class="turn">
      <header class="turn-head"><span class="label label-q">问</span><div class="question">${escapeHtml(record.question || '')}</div></header>
      <section class="answer"><header class="answer-head"><span class="label label-a">答</span>${model}</header><div class="markdown">${answer}</div></section>
    </article>`;
  }).join('\n');
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)} · GraphMind</title>
<style>${exportStyles}</style></head>
<body>
  <header class="page-header"><strong>GraphMind</strong><p>${escapeHtml(project.name)} · 导出于 ${escapeHtml(now.toISOString().slice(0, 10))} · ${records.length} 轮对话</p></header>
  <main>${turns}</main>
</body></html>
`;
}
