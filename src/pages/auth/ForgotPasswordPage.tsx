import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Mail, ArrowRight } from 'lucide-react';
import { apiFetch } from '../../lib/api';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    message: string;
    previewResetToken?: string;
  } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch<{
        ok: boolean;
        message: string;
        previewResetToken?: string;
      }>('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setResult(res);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12">
      <div className="w-full max-w-md space-y-6">
        <div>
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Voltar ao Login</span>
          </Link>
          <h1 className="mt-4 font-display text-2xl font-bold tracking-tight text-slate-900">
            Recuperar Palavra-passe
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Introduza o seu e-mail registado para receber um código temporário de redefinição (válido por 30 minutos).
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        {result ? (
          <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700">
                <Mail className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Pedido Processado</h2>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">{result.message}</p>
              </div>
            </div>

            {result.previewResetToken && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900 space-y-2">
                <div className="font-semibold">Ambiente de Demonstração (E-mail Simulado)</div>
                <p>
                  Em produção o código é enviado via Resend. Para testar agora, clique abaixo para abrir o formulário com o token válido:
                </p>
                <Link
                  to={`/redefinir-senha?token=${encodeURIComponent(result.previewResetToken)}`}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800"
                >
                  <span>Redefinir Palavra-passe Agora</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            )}

            <div className="border-t border-slate-100 pt-3 text-right">
              <Link
                to="/redefinir-senha"
                className="text-xs font-medium text-slate-700 hover:text-slate-900 underline"
              >
                Já tenho um token de recuperação
              </Link>
            </div>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="space-y-4 rounded-xl border border-slate-200 bg-white p-6"
          >
            <div>
              <label className="block text-xs font-medium text-slate-700">E-mail</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nome@empresa.pt"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-slate-900 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              <span>{loading ? 'A processar...' : 'Enviar Instruções'}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
