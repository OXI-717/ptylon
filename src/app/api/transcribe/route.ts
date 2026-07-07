import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';

export async function POST(req: NextRequest) {
  // Auth check
  const token = req.cookies.get('wc-token')?.value;
  if (!token || !verifyToken(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GROQ_API_KEY not configured' }, { status: 500 });
  }

  try {
    const formData = await req.formData();
    const audio = formData.get('audio') as File | null;
    const lang = (formData.get('lang') as string) || 'ru';

    if (!audio) {
      return NextResponse.json({ error: 'No audio file' }, { status: 400 });
    }

    // Forward to Groq Whisper API
    const groqForm = new FormData();
    groqForm.append('file', audio, 'recording.webm');
    groqForm.append('model', 'whisper-large-v3');
    groqForm.append('language', lang);
    groqForm.append('response_format', 'json');

    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: groqForm,
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[Transcribe] Groq error:', res.status, errText);
      return NextResponse.json({ error: 'Transcription failed', details: errText }, { status: 502 });
    }

    const data = await res.json();
    return NextResponse.json({ text: data.text || '' });
  } catch (err) {
    console.error('[Transcribe] Error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
