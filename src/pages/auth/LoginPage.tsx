import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { ROLE_HOME_ROUTES, useAuth } from '../../context/AuthContext';
import { useI18n } from '../../context/I18nContext';
import type { LanguageCode, UserProfile } from '../../types/domain';

const DEMO_PORTALS = [
  {
    id: 'user-admin-diego',
    title: 'Super Admin · Confiança',
    subtitle: 'Diego Silva · Gestão total, IVA, repasses & caixa',
  },
  {
    id: 'user-company-ricardo',
    title: 'Centro Técnico · Margem Sul',
    subtitle: 'Ricardo Mendes · Equipa própria e repasse 65%',
  },
  {
    id: 'user-partner-berens',
    title: 'Parceiro · Berens Estate',
    subtitle: 'Ana Berens · Pedidos B2B, aprovação e relatórios',
  },
  {
    id: 'user-tech-joao',
    title: 'Técnico · João Ferreira',
    subtitle: 'Agenda, Km automático, orçamento e ganhos',
  },
  {
    id: 'user-customer-maria',
    title: 'Cliente Particular · Maria',
    subtitle: 'Agendar, mesmo técnico, MB Way / Stripe e avaliação',
  },
];

export function LoginPage() {
  const { login, demoLogin } = useAuth();
  const { lang, setLang } = useI18n();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const user = await login(email, password);
      // C-06: técnico com senha temporária é obrigado a trocá-la antes de entrar (server/routes/auth.ts:108)
      const mustChange = Boolean((user as UserProfile & { must_change_password?: boolean }).must_change_password);
      navigate(mustChange ? '/trocar-senha' : ROLE_HOME_ROUTES[user.role]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDemoClick(userId: string) {
    setError(null);
    setLoading(true);
    try {
      const user = await demoLogin(userId);
      navigate(ROLE_HOME_ROUTES[user.role]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 lg:grid lg:grid-cols-12">
      {/* Left Visual Editorial Column */}
      <div className="relative hidden lg:col-span-5 lg:flex lg:flex-col lg:justify-between bg-slate-900 text-white p-10">
        <div>
          <div className="font-display text-xl font-bold tracking-tight">
            Confiança Repara
          </div>
          <p className="mt-1 text-sm text-slate-400">
            Confiança e Versatilidade Unipessoal Lda · Corroios, Portugal
          </p>
        </div>

        <div className="my-8 overflow-hidden rounded-xl border border-slate-800 bg-slate-800">
          <img
            src="/src/assets/images/service_home_repair_1795289338475.jpg"
            alt="Assistência técnica residencial certificada em Portugal"
            referrerPolicy="no-referrer"
            className="h-72 w-full object-cover"
          />
          <div className="p-6">
            <h2 className="font-display text-lg font-semibold leading-snug text-white">
              Operações técnicas multi-empresa e controlo fiscal num único sistema
            </h2>
            <p className="mt-2 text-sm text-slate-300 leading-relaxed">
              Gestão de ordens de serviço, segregação automática de IVA (6% e 23%),
              fechamento semanal de repasses e controlo de quilometragem.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-400">
          <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>NIF 518646696 · Lisboa e região & Margem Sul</span>
        </div>
      </div>

      {/* Right Login & Multi-Portal Access */}
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12 lg:col-span-7 lg:px-20">
        <div className="mx-auto w-full max-w-lg space-y-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="font-display text-lg font-bold text-slate-900 lg:hidden">
                Confiança Repara
              </div>
              <h1 className="mt-2 font-display text-2xl font-bold tracking-tight text-slate-900">
                {lang === 'en'
                  ? 'Sign in to Platform'
                  : lang === 'es'
                  ? 'Acceder a la Plataforma'
                  : 'Aceder à Plataforma'}
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                {lang === 'en'
                  ? 'Sign in with your credentials or pick any of the 5 demo portals.'
                  : lang === 'es'
                  ? 'Ingresa con tus credenciales o elige uno de los 5 portales demo.'
                  : 'Entre com as suas credenciais ou escolha um dos 5 portais para demonstração imediata.'}
              </p>
            </div>

            <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-0.5 shrink-0">
              {(['pt', 'en', 'es'] as LanguageCode[]).map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setLang(code)}
                  className={`rounded-md px-2 py-1 text-[11px] font-semibold uppercase transition-colors ${
                    lang === code
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {code}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
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

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Palavra-passe
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-3">
                <Link
                  to="/cadastro"
                  className="text-xs font-medium text-slate-600 hover:text-slate-900"
                >
                  Criar nova conta
                </Link>
                <span className="text-slate-300" aria-hidden="true">·</span>
                <Link
                  to="/esqueci-senha"
                  className="text-xs font-medium text-slate-600 hover:text-slate-900"
                >
                  Esqueceu a palavra-passe?
                </Link>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                <span>{loading ? 'A entrar...' : 'Entrar'}</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </form>

          {/* Acesso rápido por perfil: só em desenvolvimento (sem senha, nunca em produção) */}
          {import.meta.env.DEV && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span className="font-medium text-slate-700">
                Acesso Rápido por Perfil (desenvolvimento)
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {DEMO_PORTALS.map((portal) => (
                <button
                  key={portal.id}
                  type="button"
                  disabled={loading}
                  onClick={() => handleDemoClick(portal.id)}
                  className="flex flex-col rounded-xl border border-slate-200 bg-white p-3.5 text-left transition-colors hover:border-slate-900 hover:bg-slate-50"
                >
                  <span className="text-sm font-semibold text-slate-900">
                    {portal.title}
                  </span>
                  <span className="mt-0.5 text-xs text-slate-500">
                    {portal.subtitle}
                  </span>
                </button>
              ))}
            </div>
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
