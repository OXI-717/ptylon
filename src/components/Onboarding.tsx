'use client';

import { useState } from 'react';

const ONBOARDING_KEY = 'web-console-onboarding-done';

const TIPS = [
  { title: 'Split panes', text: 'Click ⬌ or ⬍ on any pane to split horizontally/vertically. Ctrl+Shift+H/V also work.' },
  { title: 'Workspaces', text: 'Click ☰ in the status bar (or Ctrl+B) to open the sidebar. Create workspaces with templates like DevOps or Monitoring.' },
  { title: 'Clipboard', text: 'Select text → auto-copied. Right-click → paste. Ctrl+V with image → uploads and injects path.' },
  { title: 'Click to position', text: 'Click on the command line to move cursor to that position.' },
  { title: 'Cross-device', text: 'Your workspace syncs to the server. Close on one device, open on another — everything is there.' },
];

export default function Onboarding() {
  const [visible, setVisible] = useState(() => (
    typeof window !== 'undefined'
    && !window.matchMedia('(max-width: 640px)').matches
    && !localStorage.getItem(ONBOARDING_KEY)
  ));
  const [step, setStep] = useState(0);

  if (!visible) return null;

  function dismiss() {
    localStorage.setItem(ONBOARDING_KEY, '1');
    setVisible(false);
  }

  const tip = TIPS[step];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="border rounded-lg p-6 max-w-sm mx-4 shadow-2xl" style={{ background: 'var(--surface-raised)', borderColor: 'var(--accent)' }}>
        {/* Progress dots */}
        <div className="flex gap-1.5 mb-4">
          {TIPS.map((_, i) => (
            <div key={i} className="w-2 h-2 rounded-full" style={{ background: i === step ? 'var(--accent)' : 'var(--border)' }} />
          ))}
        </div>

        <h3 className="font-mono text-sm font-bold mb-2" style={{ color: 'var(--accent)' }}>{tip.title}</h3>
        <p className="font-mono text-xs leading-relaxed mb-6" style={{ color: 'var(--foreground)' }}>{tip.text}</p>

        <div className="flex justify-between items-center">
          <button
            onClick={dismiss}
            className="font-mono text-xs"
            style={{ color: 'var(--muted)' }}
          >
            Skip all
          </button>
          <div className="flex gap-2">
            {step > 0 && (
              <button
                onClick={() => setStep(step - 1)}
                className="px-3 py-1 text-xs font-mono border rounded"
                style={{ color: 'var(--foreground)', borderColor: 'var(--border)' }}
              >
                Back
              </button>
            )}
            {step < TIPS.length - 1 ? (
              <button
                onClick={() => setStep(step + 1)}
                className="px-3 py-1 text-xs font-mono rounded"
                style={{ color: 'var(--terminal-bg)', background: 'var(--accent)' }}
              >
                Next
              </button>
            ) : (
              <button
                onClick={dismiss}
                className="px-3 py-1 text-xs font-mono rounded"
                style={{ color: 'var(--terminal-bg)', background: 'var(--accent)' }}
              >
                Got it!
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
