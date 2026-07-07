'use client';

import { ReactNode, useRef, useState } from 'react';

interface DropZoneProps {
  children: ReactNode;
  sessionId?: string | null;
  ws?: WebSocket | null;
  targetDir?: string;
  onUploaded?: (files: { name: string; path: string; size: number }[]) => void;
}

export default function DropZone({ children, sessionId, ws, targetDir, onUploaded }: DropZoneProps) {
  const [isDragActive, setIsDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadResult, setUploadResult] = useState<{ files: { name: string; path: string }[] } | null>(null);
  const dragCounterRef = useRef(0);

  function hasFiles(dt: DataTransfer | null) {
    return dt ? Array.from(dt.types || []).includes('Files') : false;
  }

  function onDragEnter(e: React.DragEvent) {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault(); e.stopPropagation();
    dragCounterRef.current += 1;
    setIsDragActive(true);
  }

  function onDragOver(e: React.DragEvent) {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }

  function onDragLeave(e: React.DragEvent) {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault(); e.stopPropagation();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDragActive(false);
  }

  async function onDrop(e: React.DragEvent) {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault(); e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragActive(false);

    const fileList = e.dataTransfer.files;
    if (!fileList?.length) return;

    const formData = new FormData();
    Array.from(fileList).forEach((f) => formData.append('files', f));
    if (targetDir) formData.append('targetDir', targetDir);

    try {
      setUploading(true); setProgress(0);
      const res = await new Promise<{ ok: boolean; files: { name: string; path: string; size: number }[] }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/upload', true);
        xhr.withCredentials = true;
        xhr.upload.onprogress = (evt) => { if (evt.lengthComputable) setProgress(Math.round((evt.loaded / evt.total) * 100)); };
        xhr.onerror = () => reject(new Error('Upload failed'));
        xhr.onload = () => {
          try { const json = JSON.parse(xhr.responseText); resolve(json); } catch { reject(new Error('Invalid response')); }
        };
        xhr.send(formData);
      });

      if (res.ok && res.files?.length) {
        // Show result notification
        setUploadResult({ files: res.files });
        setTimeout(() => setUploadResult(null), 4000);

        // Notify parent (generic callback)
        onUploaded?.(res.files);

        // Terminal-specific: send file paths as comments (only if terminal context)
        if (ws && ws.readyState === WebSocket.OPEN && sessionId) {
          for (const f of res.files) {
            ws.send(JSON.stringify({ type: 'input', sessionId, data: `# uploaded: ${f.path}\n` }));
          }
        }
      }
    } catch (err) {
      console.error('[DropZone]', err);
    } finally {
      setUploading(false); setProgress(0);
    }
  }

  return (
    <div className="relative h-full w-full" onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      {children}
      {(isDragActive || uploading) && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#40E0D0]/15 backdrop-blur-[1px]">
          <div className="rounded-xl border-2 border-dashed border-[#40E0D0] bg-[#0a0e14]/90 p-6 text-center shadow-2xl">
            <div className="text-3xl mb-2">📤</div>
            <div className="text-lg font-mono text-[#40E0D0]">{uploading ? 'Uploading...' : 'Drop files here'}</div>
            {targetDir && <div className="text-xs text-gray-500 mt-1 font-mono">→ {targetDir}</div>}
            {uploading && (
              <div className="mt-3 w-48">
                <div className="h-1.5 w-full rounded bg-[#1a1e24]">
                  <div className="h-full bg-[#40E0D0] rounded transition-all" style={{ width: `${progress}%` }} />
                </div>
                <div className="mt-1 text-xs text-gray-400">{progress}%</div>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Upload result toast */}
      {uploadResult && (
        <div className="absolute bottom-4 right-4 z-50 rounded-lg border border-[#40E0D0]/30 bg-[#0d1117]/95 p-3 shadow-xl max-w-xs">
          <div className="text-xs font-mono text-[#40E0D0] mb-1">Uploaded {uploadResult.files.length} file{uploadResult.files.length > 1 ? 's' : ''}:</div>
          {uploadResult.files.map((f, i) => (
            <div key={i} className="text-xs font-mono text-gray-400 truncate">→ {f.path}</div>
          ))}
        </div>
      )}
    </div>
  );
}
