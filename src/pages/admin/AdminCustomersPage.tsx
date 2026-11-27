import React, { useEffect, useState } from 'react';
import { PortalLayout } from '../../components/PortalLayout';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { apiFetch, formatDatePT, formatEUR } from '../../lib/api';
import type { UserProfile } from '../../types/domain';
import { Edit2, Search, UserCheck, Users, X } from 'lucide-react';

export function AdminCustomersPage() {
  const [customers, setCustomers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filterPartner, setFilterPartner] = useState<'all' | 'partners' | 'standard'>('all');

  const [editing, setEditing] = useState<UserProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [toggleTarget, setToggleTarget] = useState<UserProfile | null>(null);

  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    nif: '',
    address: '',
    city: '',
    postal_code: '',
    billing_name: '',
    billing_nif: '',
    billing_address: '',
    is_partner: false,
    is_active: true,
  });

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch<{ customers: UserProfile[] }>('/api/customers');
      setCustomers(res.customers);
    } catch (err: any) {
      setError(err?.message || 'Erro ao carregar clientes.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openEdit(c: UserProfile) {
    setEditing(c);
    setForm({
      full_name: c.full_name || '',
      phone: c.phone || '',
      nif: c.nif || '',
      address: c.address || '',
      city: c.city || '',
      postal_code: c.postal_code || '',
      billing_name: c.billing_name || '',
      billing_nif: c.billing_nif || '',
      billing_address: c.billing_address || '',
      is_partner: Boolean(c.is_partner),
      is_active: Boolean(c.is_active),
    });
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    setError('');
    try {
      await apiFetch(`/api/customers/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify(form),
      });
      setEditing(null);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Erro ao guardar cliente.');
    } finally {
      setSaving(false);
    }
  }

  async function confirmToggleActive() {
    if (!toggleTarget) return;
    setSaving(true);
    setError('');
    try {
      await apiFetch(`/api/customers/${toggleTarget.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !toggleTarget.is_active }),
      });
      setToggleTarget(null);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Erro ao atualizar estado do cliente.');
    } finally {
      setSaving(false);
    }
  }

  const filtered = customers.filter((c) => {
    if (filterPartner === 'partners' && !c.is_partner) return false;
    if (filterPartner === 'standard' && c.is_partner) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return (
        c.full_name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        (c.phone || '').toLowerCase().includes(q) ||
        (c.nif || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const partnerCount = customers.filter((c) => c.is_partner).length;
  const totalRevenue = customers.reduce((s, c) => s + Number(c.total_spent || 0), 0);

  return (
    <PortalLayout title="Clientes B2C" breadcrumb="Diretório de Clientes">
      {error && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-6">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Total de Clientes</span>
            <Users className="h-4 w-4 text-slate-400" />
          </div>
          <div className="mt-2 font-display text-2xl font-semibold text-slate-900 tabular-nums">
            {customers.length}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Clientes Parceiro VIP</span>
            <UserCheck className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="mt-2 font-display text-2xl font-semibold text-slate-900 tabular-nums">
            {partnerCount}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs text-slate-500">Volume Faturado Concluído</div>
          <div className="mt-2 font-display text-2xl font-semibold text-slate-900 tabular-nums">
            {formatEUR(totalRevenue)}
          </div>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar por nome, e-mail, telefone ou NIF..."
            className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm text-slate-900"
          />
        </div>

        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
          {[
            { id: 'all', label: 'Todos' },
            { id: 'partners', label: 'Parceiro VIP' },
            { id: 'standard', label: 'Particulares' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilterPartner(tab.id as any)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                filterPartner === tab.id
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">Contacto / NIF</th>
                <th className="px-4 py-3 font-medium">Faturação</th>
                <th className="px-4 py-3 font-medium">Ordens</th>
                <th className="px-4 py-3 font-medium">Gasto Total</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    A carregar clientes...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    Nenhum cliente encontrado.
                  </td>
                </tr>
              ) : (
                filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{c.full_name}</div>
                      <div className="text-xs text-slate-500">
                        {c.email}
                        {c.is_partner && ' · Parceiro VIP'}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 tabular-nums">
                      <div>{c.phone || '—'}</div>
                      <div className="text-slate-400">NIF: {c.nif || '—'}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <div>{c.billing_name || c.full_name}</div>
                      <div className="text-slate-400 tabular-nums">
                        NIF Fat.: {c.billing_nif || c.nif || '—'}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-slate-900 tabular-nums">
                      {c.orders_count ?? 0}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm font-semibold text-slate-900 tabular-nums">
                      {formatEUR(c.total_spent || 0)}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <button
                        type="button"
                        onClick={() => setToggleTarget(c)}
                        className={`font-medium underline-offset-2 hover:underline ${
                          c.is_active ? 'text-emerald-700' : 'text-rose-700'
                        }`}
                      >
                        {c.is_active ? 'Ativo' : 'Desativado'}
                      </button>
                      <div className="text-[11px] text-slate-400 tabular-nums">
                        Desde {formatDatePT(c.created_at)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => openEdit(c)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                        Editar
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 overflow-y-auto">
          <form
            onSubmit={handleSave}
            className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl my-8"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Editar Cliente — {editing.full_name}
              </h3>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">Nome Completo</label>
                <input
                  required
                  value={form.full_name}
                  onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Telefone</label>
                <input
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">NIF Pessoal</label>
                <input
                  value={form.nif}
                  onChange={(e) => setForm((f) => ({ ...f, nif: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">Morada</label>
                <input
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Localidade</label>
                <input
                  value={form.city}
                  onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Código Postal</label>
                <input
                  value={form.postal_code}
                  onChange={(e) => setForm((f) => ({ ...f, postal_code: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="sm:col-span-2 border-t border-slate-100 pt-3 mt-1">
                <div className="text-xs font-semibold text-slate-800 mb-2">Dados de Faturação</div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Nome / Firma Fatura</label>
                <input
                  value={form.billing_name}
                  onChange={(e) => setForm((f) => ({ ...f, billing_name: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">NIF Faturação</label>
                <input
                  value={form.billing_nif}
                  onChange={(e) => setForm((f) => ({ ...f, billing_nif: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">Morada Fiscal</label>
                <input
                  value={form.billing_address}
                  onChange={(e) => setForm((f) => ({ ...f, billing_address: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="sm:col-span-2 flex flex-wrap gap-5 pt-2">
                <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.is_partner}
                    onChange={(e) => setForm((f) => ({ ...f, is_partner: e.target.checked }))}
                    className="rounded border-slate-300"
                  />
                  Cliente Parceiro VIP (condições preferenciais)
                </label>
                <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                    className="rounded border-slate-300"
                  />
                  Conta Ativa
                </label>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {saving ? 'A guardar...' : 'Guardar Alterações'}
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(toggleTarget)}
        title={toggleTarget?.is_active ? 'Desativar Cliente?' : 'Reativar Cliente?'}
        description={`Confirma alterar o estado da conta de ${toggleTarget?.full_name || ''} para ${
          toggleTarget?.is_active ? 'Desativado' : 'Ativo'
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
