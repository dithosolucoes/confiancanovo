import { useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, X } from 'lucide-react';
import { apiFetch } from '../lib/api';

interface ChatMessage {
  role: 'customer' | 'ai';
  text: string;
}

// Assistente IA (Gemini). Fica disponível em todos os portais, exceto no do gestor,
// que recebe as conversas encaminhadas.
export function AiAssistant() {
  const [open, setOpen] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [escalated, setEscalated] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'ai', text: 'Olá! Sou o assistente da Confiança Repara. Em que posso ajudar?' },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiFetch<{ configured: boolean }>('/api/ai/status')
      .then((r) => setConfigured(r.configured))
      .catch(() => setConfigured(false));
  }, []);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setError(null);
    setBusy(true);
    setMessages((m) => [...m, { role: 'customer', text }]);
    try {
      const res = await apiFetch<{ conversationId: string; response: string; escalated: boolean }>('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ message: text, conversationId }),
      });
      setConversationId(res.conversationId);
      if (res.escalated) setEscalated(true);
      setMessages((m) => [...m, { role: 'ai', text: res.response }]);
    } catch (err: any) {
      setError(err?.message || 'Não foi possível enviar a mensagem.');
    } finally {
      setBusy(false);
    }
  }

  function startNewConversation() {
    setConversationId(null);
    setEscalated(false);
    setError(null);
    setMessages([{ role: 'ai', text: 'Nova conversa. Em que posso ajudar?' }]);
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-3">
      {open && (
        <div className="flex h-[480px] w-[340px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-900 px-4 py-3 text-white">
            <div>
              <div className="text-sm font-semibold">Assistente Confiança</div>
              <div className="text-[11px] text-slate-300">
                {escalated ? 'Encaminhado ao gestor' : 'Respostas automáticas'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={startNewConversation}
                className="rounded-md px-2 py-1 text-[11px] text-slate-200 hover:bg-white/10"
              >
                Nova conversa
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar"
                className="rounded-md p-1 text-slate-200 hover:bg-white/10"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {configured === false && (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-[11px] text-amber-900">
              O assistente ainda não está ativo. Fale com a Confiança pelo telefone ou WhatsApp.
            </div>
          )}

          <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'customer' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-xs leading-relaxed ${
                    m.role === 'customer' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-800'
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}
            {busy && <div className="text-[11px] text-slate-500">A responder...</div>}
            {error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
                {error}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={send} className="flex items-center gap-2 border-t border-slate-200 p-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={2000}
              placeholder="Escreva a sua dúvida..."
              className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              aria-label="Enviar"
              className="rounded-lg bg-slate-900 p-2 text-white disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-3 text-xs font-semibold text-white shadow-lg hover:bg-slate-800"
      >
        <MessageCircle className="h-4 w-4" />
        <span>{open ? 'Fechar' : 'Ajuda'}</span>
      </button>
    </div>
  );
}
