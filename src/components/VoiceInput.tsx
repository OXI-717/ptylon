'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

interface VoiceInputProps {
  onTranscript: (text: string) => void;
  lang?: string;
}

export default function VoiceInput({ onTranscript, lang = 'ru' }: VoiceInputProps) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      setRecording(false);
      return;
    }

    return new Promise<void>((resolve) => {
      recorder.onstop = async () => {
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        chunksRef.current = [];

        if (blob.size < 1000) {
          // Too short, skip
          resolve();
          return;
        }

        setTranscribing(true);
        try {
          const form = new FormData();
          form.append('audio', blob, 'recording.webm');
          form.append('lang', lang);

          const res = await fetch('/api/transcribe', { method: 'POST', body: form });
          const data = await res.json();

          if (data.text && data.text.trim()) {
            onTranscript(data.text.trim());
          }
          setError('');
        } catch {
          setError('Transcription failed');
          setTimeout(() => setError(''), 3000);
        } finally {
          setTranscribing(false);
        }
        resolve();
      };
      recorder.stop();
    });
  }, [lang, onTranscript]);

  const start = useCallback(async () => {
    try {
      setError('');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorderRef.current = recorder;
      recorder.start(250); // collect chunks every 250ms
      setRecording(true);
    } catch {
      setError('Mic denied');
      setTimeout(() => setError(''), 3000);
    }
  }, []);

  const toggle = useCallback(async () => {
    if (recording) {
      await stop();
      // Release mic
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    } else {
      await start();
    }
  }, [recording, start, stop]);

  // Alt+M hotkey
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stop();
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  return (
    <>
      <button
        onClick={toggle}
        disabled={transcribing}
        className={`hover:text-[#40E0D0] cursor-pointer flex items-center gap-1 ${
          recording ? 'text-red-400' : transcribing ? 'text-amber-400' : 'text-gray-500'
        }`}
        title={recording ? 'Stop recording (Alt+M)' : transcribing ? 'Transcribing...' : 'Voice input (Alt+M)'}
      >
        {recording ? (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse inline-block" />
            REC
          </span>
        ) : transcribing ? (
          <span className="animate-pulse">...</span>
        ) : (
          '🎤'
        )}
      </button>
      {error && (
        <span className="text-red-400 text-xs">{error}</span>
      )}
    </>
  );
}
