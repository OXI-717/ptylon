import type { SessionMetadata } from '@/stores/workspace-store';

export function basename(input?: string) {
  if (!input) return '';
  const normalized = input.replace(/\/+$/, '');
  return normalized.split('/').pop() || normalized || '/';
}

export function metadataPrimary(metadata?: SessionMetadata) {
  if (!metadata) return '';
  if (metadata.git?.root) {
    return `${basename(metadata.git.root)} · ${metadata.git.branch || 'git'}${metadata.git.dirty ? '*' : ''}`;
  }
  return basename(metadata.cwd);
}

export function metadataSecondary(metadata?: SessionMetadata) {
  if (!metadata) return '';
  const command = metadata.activeCommand && metadata.activeCommand !== 'bash' ? metadata.activeCommand : '';
  if (command && metadata.cwd) return `${command} · ${basename(metadata.cwd)}`;
  return command || metadata.cwd || '';
}
