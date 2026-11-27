import React, { useEffect, useState } from 'react';
import { Edit2, Plus, Save, X } from 'lucide-react';
import { PortalLayout } from '../../components/PortalLayout';
import { apiFetch, formatDatePT, formatEUR } from '../../lib/api';
import type { PayoutRateSetting, ServiceCatalogItem } from '../../types/domain';

export function AdminCatalogPage() {
  const [activeTab, setActiveTab] = useState<'catalog' | 'rates'>('catalog');
  const [catalog, setCatalog] = useState<ServiceCatalogItem[]>([]);
  const [rates, setRates] = useState<PayoutRateSetting[]>([]);
  const [draftAmounts, setDraftAmounts] = useState<Record<string, number>>({});
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ServiceCatalogItem | null>(null);

  const [category, setCategory] = useState('Eletrodomésticos');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [baseFee, setBaseFee] = useState(55);
  const [vatRate, setVatRate] = useState<6 | 23>(23);
  const [isSubscription, setIsSubscription] = useState(false);
  const [warrantyMonths, setWarrantyMonths] = useState(6);

  const [editForm, setEditForm] = useState({
    category: '',
    name: '',
    description: '',
    base_service_fee: 55,
    default_vat_rate: 23 as 6 | 23,
    warranty_months: 6,
    is_subscription: false,
    is_active: true,
  });

  async function loadCatalog() {
    const res = await apiFetch<{ catalog: ServiceCatalogItem[] }>('/api/catalog');
    setCatalog(res.catalog);
  }

  async function loadRates() {
    const res = await apiFetch<{ rates: PayoutRateSetting[] }>('/api/settings/payout-rates');
    setRates(res.rates);
    const initial: Record<string, number> = {};
    res.rates.forEach((r) => {
      initial[r.code] = Number(r.amount);
    });
    setDraftAmounts(initial);
  }

  useEffect(() => {
    loadCatalog();
    loadRates();
  }, []);

  function notify(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await apiFetch('/api/catalog', {
        method: 'POST',
        body: JSON.stringify({
          category,
          name,
          description,
          base_service_fee: baseFee,
          default_vat_rate: vatRate,
          is_subscription: isSubscription,
          subscription_price: isSubscription ? baseFee : null,
          warranty_months: warrantyMonths,
        }),
      });
      setModalOpen(false);
      setName('');
      setDescription('');
      setIsSubscription(false);
      loadCatalog();
      notify('Novo serviço adicionado ao catálogo.');
    } catch (err: any) {
      setError(err?.message || 'Erro ao adicionar serviço.');
    }
  }

  function openEditModal(item: ServiceCatalogItem) {
    setEditingItem(item);
    setEditForm({
      category: item.category,
      name: item.name,
      description: item.description || '',
      base_service_fee: Number(item.base_service_fee),
      default_vat_rate: item.default_vat_rate === 6 ? 6 : 23,
      warranty_months: item.warranty_months ?? 6,
      is_subscription: Boolean(item.is_subscription),
      is_active: Boolean(item.is_active),
    });
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingItem) return;
    setError('');
    try {
      await apiFetch(`/api/catalog/${editingItem.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...editForm,
          subscription_price: editForm.is_subscription ? editForm.base_service_fee : null,
        }),
      });
      setEditingItem(null);
      await loadCatalog();
      notify('Serviço do catálogo atualizado.');
    } catch (err: any) {
      setError(err?.message || 'Erro ao atualizar serviço.');
    }
  }

  async function handleUpdateItem(id: string, patch: Partial<ServiceCatalogItem>) {
    setError('');
    try {
      await apiFetch(`/api/catalog/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      loadCatalog();
      notify('Catálogo atualizado.');
    } catch (err: any) {
      setError(err?.message || 'Erro ao atualizar catálogo.');
    }
  }

  async function handleSaveRate(code: string) {
    setSavingCode(code);
    setError('');
    try {
      await apiFetch(`/api/settings/payout-rates/${code}`, {
        method: 'PATCH',
        body: JSON.stringify({ amount: draftAmounts[code] }),
      });
      await loadRates();
      notify(`Taxa base ${code} atualizada com histórico auditável.`);
    } catch (err: any) {
      setError(err?.message || 'Erro ao guardar taxa base.');
    } finally {
      setSavingCode(null);
    }
  }

  return (
    <PortalLayout
      title="Catálogo & Taxas Base (Portugal)"
      breadcrumb="Configurações"
      primaryAction={
        activeTab === 'catalog' ? (
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Novo Serviço</span>
          </button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-medium text-rose-800">
            {error}
          </div>
        )}
        {toast && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-800">
            {toast}
          </div>
        )}

        {/* Segmented Control */}
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
          <button
            type="button"
            onClick={() => setActiveTab('catalog')}
            className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === 'catalog'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Catálogo de Serviços
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('rates')}
            className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === 'rates'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Taxas Base de Deslocação (WO / SR / CO)
          </button>
        </div>

        {activeTab === 'catalog' ? (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Categoria</th>
                    <th className="px-4 py-3">Serviço</th>
                    <th className="px-4 py-3 text-right">Taxa Deslocação (€)</th>
                    <th className="px-4 py-3 text-right">IVA Padrão PT</th>
                    <th className="px-4 py-3 text-center">Estado</th>
                    <th className="px-4 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {catalog.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 text-xs font-medium text-slate-600">
                        {item.category}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">
                          {item.name}
                          {item.is_subscription && (
                            <span className="ml-2 text-xs font-medium text-sky-700">
                              · Subscrição Mensal
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500">
                          {item.description} · Garantia {item.warranty_months ?? 6} meses
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <input
                          type="number"
                          step="1"
                          defaultValue={item.base_service_fee}
                          onBlur={(e) =>
                            handleUpdateItem(item.id, {
                              base_service_fee: Number(e.target.value),
                            })
                          }
                          className="w-24 rounded-md border border-slate-200 px-2 py-1 text-right text-xs font-semibold tabular-nums"
                        />
                        <span className="ml-2 text-xs text-slate-400 tabular-nums">
                          ({formatEUR(item.base_service_fee)})
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <select
                          value={item.default_vat_rate}
                          onChange={(e) =>
                            handleUpdateItem(item.id, {
                              default_vat_rate: Number(e.target.value) === 6 ? 6 : 23,
                            })
                          }
                          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs tabular-nums"
                        >
                          <option value={6}>6% (Reduzida)</option>
                          <option value={23}>23% (Normal)</option>
                        </select>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          type="button"
                          onClick={() => handleUpdateItem(item.id, { is_active: !item.is_active })}
                          className={`text-xs font-medium ${
                            item.is_active ? 'text-emerald-700' : 'text-slate-400'
                          }`}
                        >
                          {item.is_active ? 'Ativo' : 'Inativo'}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => openEditModal(item)}
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
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-900">
                Configuração Dinâmica de Taxas Base (`PayoutRatesSettings`)
              </h2>
              <p className="mt-1 text-xs text-slate-600">
                Define os valores base por tipo de ordem (WO, SR, CO) e serviços especiais (Esquentadores e Vistorias). Todas as alterações registam o responsável e data.
              </p>
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Código</th>
                      <th className="px-4 py-3">Regra / Tipo</th>
                      <th className="px-4 py-3 text-right">Valor Base (€)</th>
                      <th className="px-4 py-3">Última Alteração</th>
                      <th className="px-4 py-3 text-right">Guardar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rates.map((r) => (
                      <tr key={r.code} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900">
                          {r.code}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900">{r.label}</div>
                          <div className="text-xs text-slate-500">{r.description}</div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            value={draftAmounts[r.code] ?? r.amount}
                            onChange={(e) =>
                              setDraftAmounts((prev) => ({
                                ...prev,
                                [r.code]: Number(e.target.value),
                              }))
                            }
                            className="w-24 rounded-md border border-slate-200 px-2.5 py-1.5 text-right text-xs font-semibold tabular-nums"
                          />
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500 tabular-nums">
                          <div>{formatDatePT(r.updated_at, true)}</div>
                          {r.updated_by_name && (
                            <div className="text-[11px] text-slate-400">por {r.updated_by_name}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            disabled={savingCode === r.code}
                            onClick={() => handleSaveRate(r.code)}
                            className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
                          >
                            <Save className="h-3.5 w-3.5" />
                            <span>{savingCode === r.code ? 'A guardar...' : 'Guardar'}</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">Adicionar ao Catálogo</h3>
            <form onSubmit={handleCreate} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700">Categoria</label>
                <input
                  type="text"
                  required
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Nome do Serviço</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Descrição</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    {isSubscription ? 'Mensalidade (€)' : 'Taxa Base (€)'}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={baseFee}
                    onChange={(e) => setBaseFee(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">IVA Padrão</label>
                  <select
                    value={vatRate}
                    onChange={(e) => setVatRate(Number(e.target.value) === 6 ? 6 : 23)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value={6}>6%</option>
                    <option value={23}>23%</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 items-center">
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Garantia (Meses)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={60}
                    value={warrantyMonths}
                    onChange={(e) => setWarrantyMonths(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
                  />
                </div>
                <label className="flex items-center gap-2 pt-5 text-xs font-medium text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isSubscription}
                    onChange={(e) => setIsSubscription(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span>Subscrição Mensal</span>
                </label>
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
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white"
                >
                  Criar Serviço
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-semibold text-slate-900">Editar Serviço</h3>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSaveEdit} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700">Categoria</label>
                <input
                  type="text"
                  required
                  value={editForm.category}
                  onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Nome do Serviço</label>
                <input
                  type="text"
                  required
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Descrição</label>
                <input
                  type="text"
                  value={editForm.description}
                  onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Taxa Base (€)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editForm.base_service_fee}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, base_service_fee: Number(e.target.value) }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">IVA Padrão</label>
                  <select
                    value={editForm.default_vat_rate}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        default_vat_rate: Number(e.target.value) === 6 ? 6 : 23,
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value={6}>6%</option>
                    <option value={23}>23%</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 items-center">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Garantia (Meses)</label>
                  <input
                    type="number"
                    min={0}
                    max={60}
                    value={editForm.warranty_months}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, warranty_months: Number(e.target.value) }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
                  />
                </div>
                <label className="flex items-center gap-2 pt-5 text-xs font-medium text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editForm.is_active}
                    onChange={(e) => setEditForm((f) => ({ ...f, is_active: e.target.checked }))}
                    className="rounded border-slate-300"
                  />
                  <span>Ativo</span>
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white"
                >
                  Guardar Alterações
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PortalLayout>
  );
}
