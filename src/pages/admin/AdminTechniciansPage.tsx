import React, { useEffect, useState } from 'react';
import { Edit2, Eye, Plus, X } from 'lucide-react';
import { PortalLayout } from '../../components/PortalLayout';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { TechnicianMirrorModal } from '../../components/TechnicianMirrorModal';
import { apiFetch } from '../../lib/api';
import type { Organization, UserProfile } from '../../types/domain';

export function AdminTechniciansPage() {
  const [technicians, setTechnicians] = useState<UserProfile[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTech, setEditingTech] = useState<UserProfile | null>(null);
  const [mirrorTechId, setMirrorTechId] = useState<string | null>(null);
  const [toggleTarget, setToggleTarget] = useState<UserProfile | null>(null);
  const [saving, setSaving] = useState(false);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [nif, setNif] = useState('');
  const [iban, setIban] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [orgId, setOrgId] = useState('org-matrix');
  const [customPct, setCustomPct] = useState('');

  const [editForm, setEditForm] = useState({
    full_name: '',
    phone: '',
    nif: '',
    iban: '',
    emergency_contact: '',
    organization_id: 'org-matrix',
    custom_payout_percentage: '',
    is_paused: false,
    is_active: true,
    mileage_enabled: true,
  });

  async function loadData() {
    setError('');
    try {
      const [t, o] = await Promise.all([
        apiFetch<{ technicians: UserProfile[] }>('/api/technicians'),
        apiFetch<{ organizations: Organization[] }>('/api/organizations'),
      ]);
      setTechnicians(t.technicians);
      setOrgs(o.organizations.filter((org) => org.org_type !== 'partner_client'));
    } catch (err: any) {
      setError(err?.message || 'Erro ao carregar técnicos.');
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiFetch('/api/technicians', {
        method: 'POST',
        body: JSON.stringify({
          full_name: fullName,
          email,
          phone,
          nif,
          iban,
          emergency_contact: emergencyContact,
          organization_id: orgId,
          custom_payout_percentage: customPct,
        }),
      });
      setModalOpen(false);
      setFullName('');
      setEmail('');
      setPhone('');
      setNif('');
      setIban('');
      setEmergencyContact('');
      setCustomPct('');
      await loadData();
    } catch (err: any) {
      setError(err?.message || 'Erro ao registar técnico.');
    } finally {
      setSaving(false);
    }
  }

  function openEditModal(t: UserProfile) {
    setEditingTech(t);
    setEditForm({
      full_name: t.full_name || '',
      phone: t.phone || '',
      nif: t.nif || '',
      iban: t.iban || '',
      emergency_contact: t.emergency_contact || '',
      organization_id: t.organization_id || 'org-matrix',
      custom_payout_percentage:
        t.custom_payout_percentage !== null && t.custom_payout_percentage !== undefined
          ? String(t.custom_payout_percentage)
          : '',
      is_paused: Boolean(t.is_paused),
      is_active: Boolean(t.is_active),
      mileage_enabled: t.mileage_enabled !== false,
    });
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingTech) return;
    setSaving(true);
    setError('');
    try {
      await apiFetch(`/api/technicians/${editingTech.id}`, {
        method: 'PATCH',
        body: JSON.stringify(editForm),
      });
      setEditingTech(null);
      await loadData();
    } catch (err: any) {
      setError(err?.message || 'Erro ao atualizar técnico.');
    } finally {
      setSaving(false);
    }
  }

  async function confirmToggleActive() {
    if (!toggleTarget) return;
    setSaving(true);
    setError('');
    try {
      await apiFetch(`/api/technicians/${toggleTarget.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !toggleTarget.is_active }),
      });
      setToggleTarget(null);
      await loadData();
    } catch (err: any) {
      setError(err?.message || 'Erro ao atualizar estado do técnico.');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdatePct(tech: UserProfile, val: string) {
    setError('');
    try {
      await apiFetch(`/api/technicians/${tech.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ custom_payout_percentage: val }),
      });
      loadData();
    } catch (err: any) {
      setError(err?.message || 'Erro ao atualizar percentagem.');
    }
  }

  return (
    <PortalLayout
      title="Gestão de Técnicos"
      breadcrumb="Equipa Técnica"
      primaryAction={
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Registar Técnico</span>
        </button>
      }
    >
      {error && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
              <tr>
                <th className="px-4 py-3">Técnico</th>
                <th className="px-4 py-3">Vínculo</th>
                <th className="px-4 py-3">NIF / IBAN / Emerg.</th>
                <th className="px-4 py-3 text-right">% Individual</th>
                <th className="px-4 py-3 text-right">% Efetiva</th>
                <th className="px-4 py-3 text-right">Ações & Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {technicians.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">
                      {t.full_name}
                      {t.is_paused && (
                        <span className="ml-2 text-xs font-medium text-amber-700">
                          · Pausado
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500">
                      {t.email} · {t.phone || '—'}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-700">
                    {t.organization_name || 'Autônomo Confiança'}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600 tabular-nums">
                    <div>NIF: {t.nif || '—'}</div>
                    <div>IBAN: {t.iban || '—'}</div>
                    <div className="font-sans text-[11px] text-slate-400">
                      Emerg.: {t.emergency_contact || 'Em falta'}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <input
                      type="number"
                      placeholder="Auto"
                      defaultValue={t.custom_payout_percentage ?? ''}
                      onBlur={(e) => handleUpdatePct(t, e.target.value)}
                      className="w-20 rounded-md border border-slate-200 px-2 py-1 text-right text-xs tabular-nums"
                    />
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900 tabular-nums">
                    {t.effective_payout_percentage}%
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => openEditModal(t)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                        <span>Editar</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setMirrorTechId(t.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>Espelho</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setToggleTarget(t)}
                        className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                          t.is_active
                            ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border border-amber-200 bg-amber-50 text-amber-700'
                        }`}
                      >
                        {t.is_active ? 'Ativo' : 'Pendente'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <TechnicianMirrorModal
        technicianId={mirrorTechId}
        onClose={() => setMirrorTechId(null)}
      />

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-semibold text-slate-900">Registar Novo Técnico</h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-700">Nome Completo</label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">E-mail</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
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
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">% Individual (Opcional)</label>
                  <input
                    type="number"
                    value={customPct}
                    onChange={(e) => setCustomPct(e.target.value)}
                    placeholder="Padrão da empresa"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-700">IBAN</label>
                  <input
                    type="text"
                    value={iban}
                    onChange={(e) => setIban(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-700">Contacto de Emergência</label>
                  <input
                    type="text"
                    value={emergencyContact}
                    onChange={(e) => setEmergencyContact(e.target.value)}
                    placeholder="Nome e telemóvel de familiar"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-700">Empresa / Centro Técnico</label>
                  <select
                    value={orgId}
                    onChange={(e) => setOrgId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    {orgs.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name} ({o.custom_payout_percentage}%)
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
                >
                  Registar Técnico
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingTech && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-semibold text-slate-900">
                Editar Técnico — {editingTech.full_name}
              </h3>
              <button
                type="button"
                onClick={() => setEditingTech(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSaveEdit} className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-700">Nome Completo</label>
                  <input
                    type="text"
                    required
                    value={editForm.full_name}
                    onChange={(e) => setEditForm((f) => ({ ...f, full_name: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Telemóvel</label>
                  <input
                    type="text"
                    value={editForm.phone}
                    onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">NIF</label>
                  <input
                    type="text"
                    value={editForm.nif}
                    onChange={(e) => setEditForm((f) => ({ ...f, nif: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-700">IBAN</label>
                  <input
                    type="text"
                    value={editForm.iban}
                    onChange={(e) => setEditForm((f) => ({ ...f, iban: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-700">Contacto de Emergência</label>
                  <input
                    type="text"
                    value={editForm.emergency_contact}
                    onChange={(e) => setEditForm((f) => ({ ...f, emergency_contact: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Organização</label>
                  <select
                    value={editForm.organization_id}
                    onChange={(e) => setEditForm((f) => ({ ...f, organization_id: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    {orgs.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">% Individual</label>
                  <input
                    type="number"
                    placeholder="Auto"
                    value={editForm.custom_payout_percentage}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, custom_payout_percentage: e.target.value }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
                  />
                </div>
                <div className="col-span-2 flex flex-wrap gap-5 pt-1">
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={editForm.is_active}
                      onChange={(e) => setEditForm((f) => ({ ...f, is_active: e.target.checked }))}
                      className="rounded border-slate-300"
                    />
                    Conta Ativa
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={editForm.is_paused}
                      onChange={(e) => setEditForm((f) => ({ ...f, is_paused: e.target.checked }))}
                      className="rounded border-slate-300"
                    />
                    Disponibilidade Pausada
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={editForm.mileage_enabled}
                      onChange={(e) => setEditForm((f) => ({ ...f, mileage_enabled: e.target.checked }))}
                      className="rounded border-slate-300"
                    />
                    Recebe quilometragem
                  </label>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingTech(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {saving ? 'A guardar...' : 'Guardar Alterações'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(toggleTarget)}
        title={toggleTarget?.is_active ? 'Suspender Técnico?' : 'Ativar Técnico?'}
        description={`Confirma alterar o estado da conta de ${toggleTarget?.full_name || ''} para ${
          toggleTarget?.is_active ? 'Pendente / Inativo' : 'Ativo'
        }?`}
        confirmLabel={toggleTarget?.is_active ? 'Suspender' : 'Ativar'}
        variant={toggleTarget?.is_active ? 'danger' : 'primary'}
        loading={saving}
        onConfirm={confirmToggleActive}
        onCancel={() => setToggleTarget(null)}
      />
    </PortalLayout>
  );
}
