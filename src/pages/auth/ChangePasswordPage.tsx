import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { ROLE_HOME_ROUTES, useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../lib/api';

export function ChangePasswordPage() {
  const { user, loading, refreshUser } = useAuth();
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        A carregar...
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 6) {
      setError('A nova palavra-passe deve ter pelo menos 6 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('As palavras-passe não coincidem.');
      return;
    }
    if (newPassword === currentPassword) {
      setError('A nova palavra-passe tem de ser diferente da atual.');
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch('/api/profile/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      await refreshUser();
      navigate(ROLE_HOME_ROUTES[user!.role], { replace: true });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12">
      <div className="w-full max-w-md space-y-6">
        <div>
          <div className="font-display text-lg font-bold text-slate-900">Confiança Repara</div>
          <h1 className="mt-4 font-display text-2xl font-bold tracking-tight text-slate-900">
            Trocar Palavra-passe
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Por segurança, a palavra-passe temporária tem de ser trocada antes de continuar. Use a palavra-passe
            temporária recebida da gestão como palavra-passe atual.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
          <div>
            <label className="block text-xs font-medium text-slate-700">Palavra-passe atual</label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-slate-900 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">Nova palavra-passe</label>
            <input
              type="password"
              required
              minLength={6}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Mínimo 6 caracteres"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-slate-900 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">Confirmar nova palavra-passe</label>
            <input
              type="password"
              required
              minLength={6}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-slate-900 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            <KeyRound className="h-4 w-4" />
            <span>{submitting ? 'A atualizar...' : 'Guardar nova palavra-passe'}</span>
          </button>
        </form>
      </div>
    </div>
  );
}
