import React, { useEffect, useState } from 'react';
import { Mail, Send, CheckCircle2, Clock } from 'lucide-react';
import { PortalLayout } from '../../components/PortalLayout';
import { apiFetch, formatDatePT } from '../../lib/api';
import type { EmailLog } from '../../types/domain';

export function AdminBroadcastPage() {
  const [audience, setAudience] = useState('all');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [logs, setLogs] = useState<EmailLog[]>([]);
  const [resendConfigured, setResendConfigured] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadLogs() {
    setError(null);
    try {
      const res = await apiFetch<{ logs: EmailLog[]; resendConfigured: boolean }>(
        '/api/admin/email-logs'
      );
      setLogs(res.logs);
      setResendConfigured(res.resendConfigured);
    } catch (err: any) {
      setError(err?.message || 'Erro ao carregar histórico de e-mails.');
    }
  }

  useEffect(() => {
    void loadLogs();
  }, []);

  async function handleSendBroadcast(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      const res = await apiFetch<{ ok: boolean; sentCount: number }>(
        '/api/admin/broadcast',
        {
          method: 'POST',
          body: JSON.stringify({ audience, subject, message }),
        }
      );
      setSubject('');
      setMessage('');
      setToast(`Comunicado enviado para ${res.sentCount} destinatário(s) via Resend & App.`);
      setTimeout(() => setToast(null), 5000);
      await loadLogs();
    } catch (err: any) {
      setError(err?.message || 'Erro ao enviar comunicado.');
    } finally {
      setSending(false);
    }
  }

  return (
    <PortalLayout title="Comunicações, E-mail (Resend) & Broadcast" breadcrumb="Administração">
      <div className="space-y-6">
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700">
            {error}
          </div>
        )}
        {toast && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800">
            {toast}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Broadcast Composer */}
          <form
            onSubmit={handleSendBroadcast}
            className="rounded-xl border border-slate-200 bg-white p-6 space-y-4 lg:col-span-5"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Send className="h-4 w-4 text-slate-900" />
                <h2 className="text-base font-semibold text-slate-900">
                  Disparo em Massa (Broadcast)
                </h2>
              </div>
              <span
                className={`text-[11px] font-medium ${
                  resendConfigured ? 'text-emerald-700' : 'text-amber-700'
                }`}
              >
                {resendConfigured ? 'Resend API Ativo' : 'Modo Registo (Preview)'}
              </span>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">Público-Alvo</label>
              <select
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="all">Todos os Utilizadores Ativos</option>
                <option value="technicians">Apenas Técnicos</option>
                <option value="customers">Apenas Clientes Finais</option>
                <option value="partners">Apenas Parceiros Contratantes B2B</option>
                <option value="company_admins">Apenas Centros Técnicos</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">Assunto do E-mail</label>
              <input
                type="text"
                required
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Ex: Horário especial ou atualização de tabela..."
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">Mensagem</label>
              <textarea
                rows={5}
                required
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Escreva o comunicado oficial..."
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={sending}
              className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {sending ? 'A enviar...' : 'Enviar Comunicado (E-mail + Notificação)'}
            </button>
          </form>

          {/* Email Audit Log */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden lg:col-span-7">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-slate-700" />
                <h2 className="text-base font-semibold text-slate-900">
                  Histórico de E-mails Transacionais
                </h2>
              </div>
              <span className="text-xs text-slate-500 tabular-nums">{logs.length} registos</span>
            </div>

            <div className="max-h-[480px] divide-y divide-slate-100 overflow-y-auto">
              {logs.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  Ainda não existem envios registados nesta sessão.
                </div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="p-4 text-xs space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">{log.subject}</span>
                      <span
                        className={`inline-flex items-center gap-1 font-medium ${
                          log.status === 'sent'
                            ? 'text-emerald-700'
                            : log.status === 'failed'
                            ? 'text-rose-700'
                            : 'text-slate-500'
                        }`}
                      >
                        {log.status === 'sent' ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : (
                          <Clock className="h-3 w-3" />
                        )}
                        <span>{log.status === 'sent' ? 'Enviado (Resend)' : log.status === 'failed' ? 'Falhou' : 'Preview Log'}</span>
                      </span>
                    </div>
                    <div className="text-slate-500">
                      Para: <span className="font-mono text-slate-700">{log.recipient_email}</span> · Template:{' '}
                      <span className="font-mono">{log.template}</span>
                    </div>
                    <p className="text-slate-600 line-clamp-2">{log.body_preview}</p>
                    <div className="text-[11px] text-slate-400 tabular-nums">
                      {formatDatePT(log.created_at, true)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </PortalLayout>
  );
}
