import React, { useEffect, useState } from 'react';
import { Edit2, Plus, X } from 'lucide-react';
import { PortalLayout } from '../../components/PortalLayout';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { apiFetch } from '../../lib/api';
import type { OrgType, Organization } from '../../types/domain';

const ORG_TYPE_LABELS: Record<OrgType, string> = {
  matrix: 'Matriz (Confiança)',
  technical_center: 'Centro Técnico Parceiro',
  partner_client: 'Parceiro Contratante (B2B)',
  saas_company: 'Empresa Cliente (SaaS)',
};

export function AdminOrganizationsPage() {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null);
  const [toggleTarget, setToggleTarget] = useState<Organization | null>(null);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [nif, setNif] = useState('');
  const [orgType, setOrgType] = useState<OrgType>('technical_center');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [payoutPct, setPayoutPct] = useState(50);

  const [editForm, setEditForm] = useState({
    name: '',
    nif: '',
    email: '',
    phone: '',
    address: '',
    custom_payout_percentage: 50,
    is_active: true,
  });

  async function loadOrgs() {
    setError('');
    try {
      const res = await apiFetch<{ organizations: Organization[] }>('/api/organizations');
      setOrgs(res.organizations);
    } catch (err: any) {
      setError(err?.message || 'Erro ao carregar organizações.');
    }
  }

  useEffect(() => {
    loadOrgs();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiFetch('/api/organizations', {
        method: 'POST',
        body: JSON.stringify({
          name,
          nif,
          org_type: orgType,
          email,
          phone,
          address,
          custom_payout_percentage: payoutPct,
        }),
      });
      setModalOpen(false);
      setName('');
      setNif('');
      setEmail('');
      setPhone('');
      setAddress('');
      await loadOrgs();
    } catch (err: any) {
      setError(err?.message || 'Erro ao criar organização.');
    } finally {
      setSaving(false);
    }
  }

  function openEdit(o: Organization) {
    setEditingOrg(o);
    setEditForm({
      name: o.name || '',
      nif: o.nif || '',
      email: o.email || '',
      phone: o.phone || '',
      address: o.address || '',
      custom_payout_percentage: Number(o.custom_payout_percentage || 50),
      is_active: Boolean(o.is_active),
    });
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingOrg) return;
    setSaving(true);
    setError('');
    try {
      await apiFetch(`/api/organizations/${editingOrg.id}`, {
        method: 'PATCH',
        body: JSON.stringify(editForm),
      });
      setEditingOrg(null);
      await loadOrgs();
    } catch (err: any) {
      setError(err?.message || 'Erro ao atualizar organização.');
    } finally {
      setSaving(false);
    }
  }

  async function confirmToggleActive() {
    if (!toggleTarget) return;
    setSaving(true);
    setError('');
    try {
      await apiFetch(`/api/organizations/${toggleTarget.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !toggleTarget.is_active }),
      });
      setToggleTarget(null);
      await loadOrgs();
    } catch (err: any) {
      setError(err?.message || 'Erro ao alterar estado.');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdatePct(id: string, pct: number) {
    setError('');
    try {
      await apiFetch(`/api/organizations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ custom_payout_percentage: pct }),
      });
      loadOrgs();
    } catch (err: any) {
      setError(err?.message || 'Erro ao atualizar percentagem.');
    }
  }

  return (
    <PortalLayout
      title="Empresas, Centros Técnicos & Parceiros"
      breadcrumb="Multi-Empresa"
      primaryAction={
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Nova Empresa</span>
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
                <th className="px-4 py-3">Empresa</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">NIF</th>
                <th className="px-4 py-3">Contacto</th>
                <th className="px-4 py-3 text-right">% Repasse</th>
                <th className="px-4 py-3 text-center">Estado</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orgs.map((o) => (
                <tr key={o.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{o.name}</div>
                    <div className="text-xs text-slate-500">{o.address || '—'}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-700">
                    {ORG_TYPE_LABELS[o.org_type]}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600 tabular-nums">
                    {o.nif || '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    <div>{o.email || '—'}</div>
                    <div>{o.phone || '—'}</div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {o.org_type === 'partner_client' ? (
                      <span className="text-xs text-slate-400">Contratante</span>
                    ) : (
                      <input
                        type="number"
                        min={10}
                        max={95}
                        defaultValue={o.custom_payout_percentage}
                        onBlur={(e) => handleUpdatePct(o.id, Number(e.target.value))}
                        className="w-20 rounded-md border border-slate-200 px-2 py-1 text-right text-xs font-semibold tabular-nums"
                      />
                    )}
                  </td>
                  <td className="px-4 py-3 text-center text-xs font-medium">
                    <button
                      type="button"
                      onClick={() => setToggleTarget(o)}
                      className={`underline-offset-2 hover:underline ${
                        o.is_active ? 'text-emerald-700' : 'text-rose-700'
                      }`}
                    >
                      {o.is_active ? 'Ativa' : 'Inativa'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => openEdit(o)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-semibold text-slate-900">Registar Organização</h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700">Nome</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Tipo</label>
                  <select
                    value={orgType}
                    onChange={(e) => setOrgType(e.target.value as OrgType)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value="technical_center">Centro Técnico Parceiro</option>
                    <option value="partner_client">Parceiro Contratante (B2B)</option>
                    <option value="saas_company">Empresa Cliente (SaaS)</option>
                  </select>
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
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">E-mail</label>
                  <input
                    type="email"
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
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">% Repasse</label>
                  <input
                    type="number"
                    value={payoutPct}
                    onChange={(e) => setPayoutPct(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Morada</label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
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
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingOrg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-semibold text-slate-900">
                Editar Organização — {editingOrg.name}
              </h3>
              <button
                type="button"
                onClick={() => setEditingOrg(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSaveEdit} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700">Nome</label>
                <input
                  type="text"
                  required
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">NIF</label>
                  <input
                    type="text"
                    value={editForm.nif}
                    onChange={(e) => setEditForm((f) => ({ ...f, nif: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">% Repasse</label>
                  <input
                    type="number"
                    min={10}
                    max={95}
                    value={editForm.custom_payout_percentage}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        custom_payout_percentage: Number(e.target.value),
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">E-mail</label>
                  <input
                    type="email"
                    value={editForm.email}
                    onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
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
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Morada</label>
                <input
                  type="text"
                  value={editForm.address}
                  onChange={(e) => setEditForm((f) => ({ ...f, address: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 pt-1">
                <input
                  type="checkbox"
                  checked={editForm.is_active}
                  onChange={(e) => setEditForm((f) => ({ ...f, is_active: e.target.checked }))}
                  className="rounded border-slate-300"
                />
                Organização Ativa
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingOrg(null)}
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
        title={toggleTarget?.is_active ? 'Desativar Organização?' : 'Reativar Organização?'}
        description={`Confirma alterar o estado de ${toggleTarget?.name || ''} para ${
          toggleTarget?.is_active ? 'Inativa' : 'Ativa'
        }?`}
        confirmLabel={toggleTarget?.is_active ? 'Desativar' : 'Reativar'}
        variant={toggleTarget?.is_active ? 'danger' : 'primary'}
        loading={saving}
        onConfirm={confirmToggleActive}
        onCancel={() => setToggleTarget(null)}
      />
    </PortalLayout>
  );
}
