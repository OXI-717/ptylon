'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';

const Editor = dynamic(() => import('@monaco-editor/react'), { ssr: false });
const DEFAULT_WORKSPACE_ROOT = process.env.NEXT_PUBLIC_WORKSPACE_ROOT || '/';

const LANG_MAP: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
  '.json': 'json', '.md': 'markdown', '.css': 'css', '.html': 'html', '.sh': 'shell',
  '.yml': 'yaml', '.yaml': 'yaml', '.py': 'python', '.go': 'go', '.rs': 'rust', '.sql': 'sql',
  '.env': 'ini', '.toml': 'ini', '.conf': 'ini', '.cfg': 'ini',
};

interface MonacoEditorProps {
  filePath: string;
  value: string;
  onChange: (v: string) => void;
  onSave?: () => void;
  onOpenFile?: (path: string) => void;
}

export default function MonacoEditorPanel({ filePath, value, onChange, onSave, onOpenFile }: MonacoEditorProps) {
  const language = useMemo(() => {
    const i = filePath.lastIndexOf('.');
    return i === -1 ? 'plaintext' : (LANG_MAP[filePath.slice(i).toLowerCase()] ?? 'plaintext');
  }, [filePath]);

  const [saving, setSaving] = useState(false);

  const [dropStatus, setDropStatus] = useState<string | null>(null);
  const [editorTheme, setEditorTheme] = useState<'vs' | 'vs-dark'>('vs-dark');

  useEffect(() => {
    const updateTheme = () => {
      const tone = document.documentElement.getAttribute('data-terminal-tone');
      setEditorTheme(tone === 'light' ? 'vs' : 'vs-dark');
    };
    updateTheme();
    window.addEventListener('circadian-theme-change', updateTheme);
    return () => window.removeEventListener('circadian-theme-change', updateTheme);
  }, []);

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer?.files;
    if (!files?.length) return;

    // Upload file to server, then open in editor
    const formData = new FormData();
    Array.from(files).forEach((f) => formData.append('files', f));
    // Upload to same directory as current file
    const dir = filePath.substring(0, filePath.lastIndexOf('/')) || DEFAULT_WORKSPACE_ROOT;
    formData.append('targetDir', dir);

    try {
      setDropStatus('Uploading...');
      const res = await fetch('/api/upload', { method: 'POST', body: formData, credentials: 'include' });
      const json = await res.json();
      if (json.ok && json.files?.length && onOpenFile) {
        // Open first uploaded file in new editor tab
        onOpenFile(json.files[0].path);
        setDropStatus(`Uploaded: ${json.files[0].path}`);
      } else {
        setDropStatus('Upload failed');
      }
    } catch {
      setDropStatus('Upload error');
    }
    setTimeout(() => setDropStatus(null), 3000);
  }

  return (
    <div className="h-full w-full flex flex-col" onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }} onDrop={handleDrop}>
      {/* Toolbar */}
      <div className="h-8 flex items-center justify-between px-3 border-b shrink-0" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
        <span className="text-xs font-mono truncate" style={{ color: 'var(--muted)' }}>{filePath}</span>
        <div className="flex gap-2">
          {dropStatus && <span className="text-[10px] font-mono" style={{ color: 'var(--accent)' }}>{dropStatus}</span>}
          <span className="text-[10px] font-mono" style={{ color: 'var(--muted)' }}>{language}</span>
          {onSave && (
            <button
              onClick={async () => { setSaving(true); await onSave(); setSaving(false); }}
              className="text-xs px-2 py-0.5 rounded"
              style={{ color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 12%, transparent)' }}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}
        </div>
      </div>
      {/* Editor */}
      <div className="flex-1">
        <Editor
          height="100%"
          language={language}
          value={value}
          onChange={(v) => onChange(v ?? '')}
          theme={editorTheme}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            automaticLayout: true,
            scrollBeyondLastLine: false,
            padding: { top: 8 },
          }}
        />
      </div>
    </div>
  );
}
