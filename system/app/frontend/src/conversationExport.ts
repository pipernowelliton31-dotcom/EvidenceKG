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
