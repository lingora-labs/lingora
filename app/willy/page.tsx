// app/willy/page.tsx
//
// FREE WILLY — isolated preview interface. See lib/willy-motor.ts for scope
// (branch free-willy-preview, not merged to main). Minimal, self-contained
// client UI talking only to /api/willy — no dependency on app/beta's
// existing state machine (use-beta-page.ts, beta-model.ts, etc.), so nothing
// here touches or risks the existing production UI.
'use client';

import { useState, useRef, useEffect } from 'react';

type Msg = { role: 'user' | 'assistant'; content: string; durationMs?: number };

export default function WillyPreviewPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setError(null);
    const nextHistory = [...messages, { role: 'user' as const, content: text }];
    setMessages(nextHistory);
    setInput('');
    setLoading(true);
    try {
      const res = await fetch('/api/willy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setMessages([...nextHistory, { role: 'assistant', content: data.message, durationMs: data.durationMs }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{
        background: '#fff3cd', border: '1px solid #ffe69c', borderRadius: 8,
        padding: '10px 14px', marginBottom: 16, fontSize: 13, lineHeight: 1.4,
      }}>
        <strong>FREE WILLY — preview aislada.</strong> Rama experimental, sin tocar producción ni `main`.
        WILLY responde con su inteligencia general, sin el pipeline SEEK ni herramientas de escritura.
      </div>

      <h1 style={{ fontSize: 20, marginBottom: 4 }}>LINGORA — WILLY MOTOR</h1>
      <p style={{ color: '#666', fontSize: 13, marginBottom: 20 }}>
        Habla en el idioma que quieras, de español a cualquier otro tema y de vuelta — sin perder el hilo.
      </p>

      <div style={{ border: '1px solid #e2e2e2', borderRadius: 10, minHeight: 320, padding: 16, marginBottom: 16, background: '#fafafa' }}>
        {messages.length === 0 && (
          <p style={{ color: '#999', fontSize: 14 }}>Empieza la conversación abajo.</p>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 14, textAlign: m.role === 'user' ? 'right' : 'left' }}>
            <div style={{
              display: 'inline-block', maxWidth: '80%', textAlign: 'left',
              background: m.role === 'user' ? '#2563eb' : '#fff',
              color: m.role === 'user' ? '#fff' : '#111',
              border: m.role === 'user' ? 'none' : '1px solid #e2e2e2',
              borderRadius: 10, padding: '10px 14px', whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.5,
            }}>
              {m.content}
            </div>
            {m.role === 'assistant' && m.durationMs != null && (
              <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{m.durationMs} ms</div>
            )}
          </div>
        ))}
        {loading && <div style={{ color: '#999', fontSize: 13 }}>WILLY está pensando…</div>}
        {error && <div style={{ color: '#c00', fontSize: 13 }}>Error: {error}</div>}
        <div ref={bottomRef} />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Escribe aquí… (Enter para enviar, Shift+Enter para nueva línea)"
          rows={2}
          style={{ flex: 1, resize: 'none', borderRadius: 8, border: '1px solid #ccc', padding: 10, fontSize: 14 }}
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          style={{
            borderRadius: 8, border: 'none', background: loading ? '#999' : '#2563eb',
            color: '#fff', padding: '0 20px', fontSize: 14, cursor: loading ? 'default' : 'pointer',
          }}
        >
          Enviar
        </button>
      </div>
    </div>
  );
}
