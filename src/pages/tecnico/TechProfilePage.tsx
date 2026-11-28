import React, { useEffect, useState } from 'react';
import { AlertTriangle, Camera, CheckCircle2, PauseCircle, PlayCircle } from 'lucide-react';
import { PortalLayout } from '../../components/PortalLayout';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../lib/api';

async function resizeAvatarToDataUrl(file: File): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Erro ao ler imagem.'));
    reader.readAsDataURL(file);
  });

  return await new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const size = 256;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(raw);
        return;
      }
      const minSide = Math.min(img.width, img.height);
      const sx = (img.width - minSide) / 2;
      const sy = (img.height - minSide) / 2;
      ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => resolve(raw);
    img.src = raw;
  });
}

export function TechProfilePage() {
  const { user, refreshUser } = useAuth();
  const [fullName, setFullName] = useState(user?.full_name || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [nif, setNif] = useState(user?.nif || '');
  const [iban, setIban] = useState(user?.iban || '');
  // A-07: confirmação dupla do IBAN (começa com o IBAN já guardado, para não bloquear quando não muda)
  const [ibanConfirm, setIbanConfirm] = useState(user?.iban || '');
  // O IBAN e os repasses só aparecem se a gestão tiver liberado para o técnico
  const [techSees, setTechSees] = useState(true);
  useEffect(() => {
    apiFetch<{ techSeesPayouts: boolean }>('/api/settings/visibility')
      .then((r) => setTechSees(r.techSeesPayouts))
      .catch(() => setTechSees(true));
  }, []);
  const [emergencyContact, setEmergencyContact] = useState(user?.emergency_contact || '');
  const [address, setAddress] = useState(user?.address || '');
  const [city, setCity] = useState(user?.city || '');
  const [postalCode, setPostalCode] = useState(user?.postal_code || '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url || '');
  const [isPaused, setIsPaused] = useState(Boolean(user?.is_paused));
  const [togglingPause, setTogglingPause] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Password Change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSaved, setPwSaved] = useState(false);

  const isTech = user?.role === 'technician';
  const missingFields: string[] = [];
  if (isTech) {
    if (!nif.trim()) missingFields.push('NIF');
    if (techSees && !iban.trim()) missingFields.push('IBAN');
    if (!emergencyContact.trim()) missingFields.push('Contacto de Emergência');
  }
  // A-05: com repasses ocultos o campo IBAN não aparece, mas o aceite de ordens exige IBAN; mostrar aviso em vez de bloquear em silêncio
  const ibanEmFaltaOculto = isTech && !techSees && !iban.trim();

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const dataUrl = await resizeAvatarToDataUrl(file);
    setAvatarUrl(dataUrl);
  }

  async function handleTogglePause() {
    setTogglingPause(true);
    setError(null);
    const next = !isPaused;
    try {
      await apiFetch('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({ is_paused: next }),
      });
      setIsPaused(next);
      await refreshUser();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setTogglingPause(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // A-04: o IBAN só é enviado quando o campo está visível (senão o servidor responde 403)
    const ibanVisivel = isTech && techSees;
    // A-07: confirmação dupla do IBAN antes de guardar
    if (ibanVisivel && iban.trim() !== ibanConfirm.trim()) {
      setError('Os dois IBAN não coincidem. Digite o mesmo IBAN nos dois campos antes de guardar.');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        full_name: fullName,
        phone,
        nif,
        emergency_contact: emergencyContact || null,
        address,
        city,
        postal_code: postalCode,
        avatar_url: avatarUrl || null,
        is_paused: isPaused,
      };
      if (ibanVisivel) payload.iban = iban;
      await apiFetch('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      await refreshUser();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    setPwSaved(false);
    if (newPassword.length < 6) {
      setPwError('A nova palavra-passe deve ter pelo menos 6 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError('As palavras-passe não coincidem.');
      return;
    }
    try {
      await apiFetch('/api/profile/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPwSaved(true);
      setTimeout(() => setPwSaved(false), 4000);
    } catch (err: any) {
      setPwError(err.message);
    }
  }

  const initials = (fullName || user?.full_name || 'CR')
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();

  return (
    <PortalLayout title="Meu Perfil & Segurança" breadcrumb="Conta">
      <div className="mx-auto max-w-xl space-y-6">
        {isTech && (
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Disponibilidade & Elegibilidade Operacional
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {isPaused
                    ? 'Em pausa: não receberá novos chamados nem poderá aceitar ordens do mural.'
                    : 'Ativo: disponível para receber e aceitar novos serviços no mural.'}
                </p>
              </div>
              <button
                type="button"
                disabled={togglingPause}
                onClick={handleTogglePause}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors ${
                  isPaused
                    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                    : 'border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                }`}
              >
                {isPaused ? (
                  <>
                    <PlayCircle className="h-4 w-4" />
                    <span>Reativar Disponibilidade</span>
                  </>
                ) : (
                  <>
                    <PauseCircle className="h-4 w-4" />
                    <span>Pausar Receção de Chamados</span>
                  </>
                )}
              </button>
            </div>

            {missingFields.length > 0 || ibanEmFaltaOculto ? (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700 mt-0.5" />
                <span>
                  {missingFields.length > 0 && (
                    <>
                      <strong>Cadastro incompleto:</strong> preencha{' '}
                      <strong>{missingFields.join(', ')}</strong> abaixo para desbloquear a aceitação
                      de novos serviços no mural.
                    </>
                  )}
                  {ibanEmFaltaOculto && (
                    <>
                      {missingFields.length > 0 && <br />}
                      <strong>IBAN em falta:</strong> os repasses estão ocultos pela gestão, por isso o
                      campo não aparece aqui. A aceitação de serviços no mural exige IBAN. Peça à gestão
                      para liberar os repasses ou para registar o seu IBAN.
                    </>
                  )}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-medium text-emerald-800">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
                <span>Perfil técnico completo (NIF, IBAN e Contacto de Emergência validados).</span>
              </div>
            )}
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-xl border border-slate-200 bg-white p-6"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div className="flex items-center gap-4">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={fullName}
                  referrerPolicy="no-referrer"
                  className="h-14 w-14 rounded-full border border-slate-200 object-cover"
                />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-sm font-bold text-slate-700">
                  {initials}
                </div>
              )}
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Dados Pessoais & Faturação</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  E-mail registado: <span className="font-mono">{user?.email}</span>
                </p>
              </div>
            </div>

            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap">
              <Camera className="h-3.5 w-3.5" />
              <span>Alterar Foto</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleAvatarChange}
                className="hidden"
              />
            </label>
          </div>

          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-medium text-rose-700">
              {error}
            </div>
          )}

          {saved && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-800">
              Dados atualizados com sucesso.
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700">Nome Completo</label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700">Telemóvel</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">NIF</label>
              <input
                type="text"
                value={nif}
                onChange={(e) => setNif(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
              />
            </div>
          </div>

          {isTech && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {techSees && (
              <>
              <div>
                <label className="block text-xs font-medium text-slate-700">IBAN (Repasses)</label>
                <input
                  type="text"
                  value={iban}
                  onChange={(e) => setIban(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Confirmar IBAN</label>
                <input
                  type="text"
                  value={ibanConfirm}
                  onChange={(e) => setIbanConfirm(e.target.value)}
                  className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm font-mono ${
                    ibanConfirm && ibanConfirm.trim() !== iban.trim()
                      ? 'border-rose-300'
                      : 'border-slate-200'
                  }`}
                />
                {ibanConfirm && ibanConfirm.trim() !== iban.trim() && (
                  <p className="mt-1 text-xs text-rose-600">Os IBAN não coincidem.</p>
                )}
              </div>
              </>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Contacto de Emergência
                </label>
                <input
                  type="text"
                  value={emergencyContact}
                  onChange={(e) => setEmergencyContact(e.target.value)}
                  placeholder="Nome e telemóvel de emergência"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700">Morada</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700">Localidade</label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Código Postal</label>
              <input
                type="text"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? 'A guardar...' : 'Guardar Perfil'}
            </button>
          </div>
        </form>

        {/* Change Password Card */}
        <form
          onSubmit={handlePasswordSubmit}
          className="space-y-4 rounded-xl border border-slate-200 bg-white p-6"
        >
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-sm font-semibold text-slate-900">Alterar Palavra-passe</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Atualize a sua palavra-passe de acesso à plataforma.
            </p>
          </div>

          {pwError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-medium text-rose-700">
              {pwError}
            </div>
          )}

          {pwSaved && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-800">
              Palavra-passe alterada com sucesso.
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700">
              Palavra-passe Atual
            </label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Nova Palavra-passe
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Confirmar Nova
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              className="rounded-lg border border-slate-200 bg-white px-5 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
            >
              Alterar Palavra-passe
            </button>
          </div>
        </form>
      </div>
    </PortalLayout>
  );
}
