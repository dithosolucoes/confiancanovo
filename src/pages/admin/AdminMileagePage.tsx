import { useCallback, useEffect, useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PortalLayout } from '../../components/PortalLayout';
import { apiFetch, formatDatePT, formatEUR } from '../../lib/api';
import { exportMileagePDF, exportMileageXLSX } from '../../lib/exports';
import type { MileageTrip, UserProfile } from '../../types/domain';

const TRIP_TYPE_LABELS = {
  office_to_client: 'Escritório → Cliente',
  client_to_client: 'Cliente → Cliente',
  client_to_office: 'Cliente → Escritório',
};

export function AdminMileagePage() {
  const [trips, setTrips] = useState<MileageTrip[]>([]);
  const [technicians, setTechnicians] = useState<UserProfile[]>([]);
  const [techFilter, setTechFilter] = useState('all');
  const [ratePerKm, setRatePerKm] = useState(0.40);
  const [officeAddress, setOfficeAddress] = useState('');
  const [editingTrip, setEditingTrip] = useState<MileageTrip | null>(null);
  const [newKm, setNewKm] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setError(null);
    try {
      const res = await apiFetch<{ settings: any; trips: MileageTrip[] }>(
        `/api/mileage?technicianId=${techFilter}`
      );
      setTrips(res.trips);
      if (res.settings) {
        setRatePerKm(Number(res.settings.rate_per_km));
        setOfficeAddress(res.settings.office_address);
      }
    } catch (err: any) {
      setError(err?.message || 'Erro ao carregar quilometragem.');
    }
  }, [techFilter]);

  useEffect(() => {
    void loadData();
    apiFetch<{ technicians: UserProfile[] }>('/api/technicians')
      .then((r) => setTechnicians(r.technicians))
      .catch(() => {});
  }, [loadData]);

  async function handleSaveRate() {
    setError(null);
    try {
      await apiFetch('/api/mileage/settings', {
        method: 'PATCH',
        body: JSON.stringify({ office_address: officeAddress }),
      });
      await loadData();
      setToast('Ponto base de quilometragem guardado.');
      setTimeout(() => setToast(null), 4000);
    } catch (err: any) {
      setError(err?.message || 'Erro ao guardar configuração de quilometragem.');
    }
  }

  async function handleOverrideTrip() {
    if (!editingTrip) return;
    if (!overrideReason.trim()) {
      setModalError('O motivo do ajuste manual é obrigatório.');
      return;
    }
    setModalError(null);
    try {
      await apiFetch(`/api/mileage/trips/${editingTrip.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ distance_km: Number(newKm), override_reason: overrideReason.trim() }),
      });
      setEditingTrip(null);
      setNewKm('');
      setOverrideReason('');
      await loadData();
      setToast('Ajuste manual de quilometragem registado.');
      setTimeout(() => setToast(null), 4000);
    } catch (err: any) {
      setModalError(err?.message || 'Erro ao guardar ajuste.');
    }
  }

  const totalKm = trips.reduce((s, t) => s + Number(t.distance_km), 0);
  const totalReimburse = trips.reduce((s, t) => s + Number(t.reimbursement_amount), 0);

  return (
    <PortalLayout
      title="Quilometragem & Frota"
      breadcrumb="Operações"
      primaryAction={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => exportMileageXLSX(trips)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            <span>Excel</span>
          </button>
          <button
            type="button"
            onClick={() => exportMileagePDF(trips)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" />
            <span>PDF</span>
          </button>
        </div>
      }
    >
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
        {/* Global Rate & Base Point Config */}
        <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-5 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-5">
            <label className="block text-xs font-medium text-slate-700">
              Ponto Base Fixo (Escritório Corroios)
            </label>
            <input
              type="text"
              value={officeAddress}
              onChange={(e) => setOfficeAddress(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
            />
          </div>
          <div className="lg:col-span-2">
            <label className="block text-xs font-medium text-slate-700">Valor / Km vigente</label>
            <div className="mt-1 text-xs font-semibold text-slate-900 tabular-nums">
              {ratePerKm.toFixed(2)} € / km
            </div>
            <Link to="/admin/parametros" className="text-[11px] text-slate-500 underline hover:text-slate-800">
              Alterar em Parâmetros do negócio
            </Link>
          </div>
          <div className="lg:col-span-2">
            <button
              type="button"
              onClick={handleSaveRate}
              className="w-full rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800"
            >
              Guardar Ponto Base
            </button>
          </div>
          <div className="lg:col-span-3">
            <label className="block text-xs font-medium text-slate-700">Filtrar Técnico</label>
            <select
              value={techFilter}
              onChange={(e) => setTechFilter(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
            >
              <option value="all">Todos os Técnicos</option>
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.full_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Summary Metrics */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium text-slate-500">Percursos Registados</div>
            <div className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
              {trips.length}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium text-slate-500">Distância Total</div>
            <div className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
              {totalKm.toFixed(1)} km
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium text-slate-500">Total a Reembolsar</div>
            <div className="mt-2 font-display text-2xl font-bold text-emerald-700 tabular-nums">
              {formatEUR(totalReimburse)}
            </div>
          </div>
        </div>

        {/* Trips Table */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <tr>
                  <th className="px-4 py-3">Data</th>
                  <th className="px-4 py-3">Técnico</th>
                  <th className="px-4 py-3">Trajeto (Origem → Destino)</th>
                  <th className="px-4 py-3">Ref.</th>
                  <th className="px-4 py-3 text-right">Km</th>
                  <th className="px-4 py-3 text-right">Reembolso</th>
                  <th className="px-4 py-3 text-right">Auditoria</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {trips.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                      {formatDatePT(t.started_at, true)}
                    </td>
                    <td className="px-4 py-3 text-xs font-medium text-slate-900">
                      {t.technician_name}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div className="font-medium text-slate-800">
                        {TRIP_TYPE_LABELS[t.trip_type]}
                      </div>
                      <div className="text-slate-500 truncate max-w-md">
                        {t.origin_address} → {t.destination_address}
                      </div>
                      {t.manual_override && (
                        <div className="mt-0.5 text-[11px] text-amber-700">
                          Ajuste manual: {t.override_reason}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      {t.reference_code || 'Retorno'}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900 tabular-nums">
                      {Number(t.distance_km).toFixed(1)} km
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-emerald-700 tabular-nums">
                      {formatEUR(t.reimbursement_amount)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setModalError(null);
                          setEditingTrip(t);
                          setNewKm(String(t.distance_km));
                          setOverrideReason(t.override_reason || '');
                        }}
                        className="text-xs font-medium text-slate-600 hover:text-slate-900 underline"
                      >
                        Ajustar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {editingTrip && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl space-y-4">
            <h3 className="text-base font-semibold text-slate-900">
              Ajuste Manual de Quilometragem (Com Auditoria)
            </h3>
            {modalError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
                {modalError}
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-700">Distância (Km)</label>
              <input
                type="number"
                step="0.1"
                value={newKm}
                onChange={(e) => setNewKm(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Motivo do Ajuste (Obrigatório)
              </label>
              <input
                type="text"
                required
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="Ex: Desvio por obra na A2"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingTrip(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleOverrideTrip}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white"
              >
                Guardar Ajuste
              </button>
            </div>
          </div>
        </div>
      )}
    </PortalLayout>
  );
}
