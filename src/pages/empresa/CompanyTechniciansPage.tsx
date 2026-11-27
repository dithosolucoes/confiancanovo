import React, { useEffect, useState } from 'react';
import { Edit2, Eye, Plus, Power } from 'lucide-react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { PortalLayout } from '../../components/PortalLayout';
import { TechnicianMirrorModal } from '../../components/TechnicianMirrorModal';
import { apiFetch } from '../../lib/api';
import type { UserProfile } from '../../types/domain';

export function CompanyTechniciansPage() {
  const [techs, setTechs] = useState<UserProfile[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTech, setEditingTech] = useState<UserProfile | null>(null);
  const [toggleTarget, setToggleTarget] = useState<UserProfile | null>(null);
  const [mirrorTechId, setMirrorTechId] = useState<string | null>(null);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [nif, setNif] = useState('');
  const [iban, setIban] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  async function loadTechs() {
    setError(null);
    try {
      const res = await apiFetch<{ technicians: UserProfile[] }>('/api/technicians');
      setTechs(res.technicians);
    } catch (err: any) {
      setError(err?.message || 'Erro ao carregar equipa técnica.');
    }
  }

  useEffect(() => {
    void loadTechs();
  }, []);

  function openCreateModal() {
    setEditingTech(null);
    setFullName('');
    setEmail('');
    setPhone('');
    setNif('');
    setIban('');
    setEmergencyContact('');
    setModalError(null);
    setModalOpen(true);
  }

  function openEditModal(t: UserProfile) {
    setEditingTech(t);
    setFullName(t.full_name || '');
    setEmail(t.email || '');
    setPhone(t.phone || '');
    setNif(t.nif || '');
    setIban(t.iban || '');
    setEmergencyContact(t.emergency_contact || '');
    setModalError(null);
    setModalOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setModalError(null);
    try {
      if (editingTech) {
        await apiFetch(`/api/technicians/${editingTech.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            full_name: fullName,
            phone,
            nif,
            iban,
            emergency_contact: emergencyContact,
          }),
        });
      } else {
        await apiFetch('/api/technicians', {
          method: 'POST',
          body: JSON.stringify({
            full_name: fullName,
            email,
            phone,
            nif,
            iban,
            emergency_contact: emergencyContact,
          }),
        });
      }
      setModalOpen(false);
      setEditingTech(null);
      await loadTechs();
    } catch (err: any) {
      setModalError(err?.message || 'Erro ao guardar técnico.');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive() {
    if (!toggleTarget) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/technicians/${toggleTarget.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !toggleTarget.is_active }),
      });
      setToggleTarget(null);
      await loadTechs();
    } catch (err: any) {
      setToggleTarget(null);
      setError(err?.message || 'Erro ao atualizar estado do técnico.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <PortalLayout
      title="Equipa de Técnicos da Empresa"
      breadcrumb="Recursos"
      primaryAction={
        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Adicionar Técnico</span>
        </button>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-800">
            {error}
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <tr>
                  <th className="px-4 py-3">Nome</th>
                  <th className="px-4 py-3">Contacto</th>
                  <th className="px-4 py-3">NIF / IBAN</th>
                  <th className="px-4 py-3 text-center">Estado</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {techs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-xs text-slate-500">
                      Nenhum técnico registado neste centro técnico.
                    </td>
                  </tr>
                ) : (
                  techs.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{t.full_name}</div>
                        {t.emergency_contact && (
                          <div className="text-[11px] text-slate-400">
                            Emergência: {t.emergency_contact}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        <div>{t.email}</div>
                        <div>{t.phone || '—'}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600 tabular-nums">
                        <div>{t.nif || '—'}</div>
                        <div className="text-[11px] text-slate-400 truncate max-w-[190px]">
                          {t.iban || 'IBAN por definir'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center text-xs font-medium">
                        <span className={t.is_active ? 'text-emerald-700' : 'text-rose-700'}>
                          {t.is_active ? (t.is_paused ? 'Em Pausa' : 'Ativo') : 'Inativo'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
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
                            onClick={() => openEditModal(t)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                            <span>Editar</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setToggleTarget(t)}
                            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium whitespace-nowrap ${
                              t.is_active
                                ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                                : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            }`}
                          >
                            <Power className="h-3.5 w-3.5" />
                            <span>{t.is_active ? 'Desativar' : 'Ativar'}</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <TechnicianMirrorModal
        technicianId={mirrorTechId}
        onClose={() => setMirrorTechId(null)}
      />

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">
              {editingTech ? `Editar Técnico · ${editingTech.full_name}` : 'Novo Técnico Interno'}
            </h3>
            {modalError && (
              <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
                {modalError}
              </div>
            )}
            <form onSubmit={handleSubmit} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700">Nome</label>
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
                  disabled={Boolean(editingTech)}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
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
              <div>
                <label className="block text-xs font-medium text-slate-700">IBAN (Repasses)</label>
                <input
                  type="text"
                  value={iban}
                  onChange={(e) => setIban(e.target.value)}
                  placeholder="PT50 ..."
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Contacto de Emergência
                </label>
                <input
                  type="text"
                  value={emergencyContact}
                  onChange={(e) => setEmergencyContact(e.target.value)}
                  placeholder="Nome e telefone"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
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
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {saving ? 'A guardar...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(toggleTarget)}
        title={toggleTarget?.is_active ? 'Desativar Técnico?' : 'Ativar Técnico?'}
        description={
          toggleTarget?.is_active
            ? `${toggleTarget.full_name} deixará de poder iniciar sessão na plataforma até ser reativado.`
            : `${toggleTarget?.full_name || ''} voltará a ter acesso ativo ao Portal do Técnico.`
        }
        confirmLabel={toggleTarget?.is_active ? 'Desativar' : 'Ativar'}
        variant={toggleTarget?.is_active ? 'danger' : 'primary'}
        loading={saving}
        onCancel={() => setToggleTarget(null)}
        onConfirm={() => void handleToggleActive()}
      />
    </PortalLayout>
  );
}
