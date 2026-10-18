const supported = /\.(pdf|docx|xlsx|pptx|png|jpe?g|webp|txt|md)$/i;
const ignored = (name: string) => name.startsWith('.') || name.startsWith('~$') || name.toLowerCase() === 'thumbs.db';

// Capture entries during the drop event: the browser clears DataTransfer afterwards.
export function droppedFiles(transfer: DataTransfer): Promise<File[]> {
  const items = Array.from(transfer.items || []).filter(item => item.kind === 'file');
  const entries = items.map(item => item.webkitGetAsEntry?.());
  if (!entries.some(Boolean)) return Promise.resolve(Array.from(transfer.files));
  const fallback = items.map(item => item.getAsFile());
  const files: File[] = [];
  async function walk(entry: FileSystemEntry): Promise<void> {
    if (ignored(entry.name)) return;
    if (entry.isFile) {
      // Avoid opening unsupported system files or directory placeholders.
      if (!supported.test(entry.name)) return;
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      files.push(file);
      if (files.length > 50) throw new Error('每次最多上传 50 个受支持文件，请分批上传文件夹。');
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // Chromium may return only 100 entries per readEntries call.
      while (true) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const child of batch) await walk(child);
      }
    }
  }
  return (async () => {
    try {
      for (let i = 0; i < entries.length; i++) {
        if (entries[i]) await walk(entries[i]!);
        else if (fallback[i]) files.push(fallback[i]!);
      }
      return files;
    } catch (error) {
      if (error instanceof Error && error.message.includes('50')) throw error;
      throw new Error('无法读取拖入的文件夹，请确认文件可访问，或使用「选择文件夹」重新上传。');
    }
  })();
}

export function validateUpload(files: File[], importing = false): { files: File[]; skipped: number } {
  const chosen = importing ? files : files.filter(file => !ignored(file.name) && supported.test(file.name));
  if (importing && (chosen.length !== 1 || !/\.zip$/i.test(chosen[0].name))) throw new Error('请选择一个本系统导出的 ZIP 备份。');
  if (importing) {
    if (chosen[0].size > 300 * 1024 * 1024) throw new Error('备份文件大小上限为 300 MB。');
    return { files: chosen, skipped: 0 };
  }
  if (!chosen.length) throw new Error('未找到可上传的文件。支持 PDF、DOCX、XLSX、PPTX、图片、Markdown 和 TXT。');
  if (chosen.length > 50) throw new Error('每次最多上传 50 个文件，请分批上传文件夹。');
  if (chosen.some(file => file.size > 80 * 1024 * 1024) || chosen.reduce((size, file) => size + file.size, 0) > 300 * 1024 * 1024) throw new Error('单文件上限 80 MB，每批总大小上限 300 MB，请分批上传。');
  return { files: chosen, skipped: files.length - chosen.length };
}
