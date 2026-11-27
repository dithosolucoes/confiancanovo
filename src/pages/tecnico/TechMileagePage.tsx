import { useEffect, useState } from 'react';
import { Download, FileSpreadsheet, Home } from 'lucide-react';
import { PortalLayout } from '../../components/PortalLayout';
import { apiFetch, formatDatePT, formatEUR } from '../../lib/api';
import { exportMileagePDF, exportMileageXLSX } from '../../lib/exports';
import type { MileageTrip } from '../../types/domain';

const TRIP_LABELS = {
  office_to_client: 'Escritório → Cliente',
  client_to_client: 'Cliente → Cliente',
  client_to_office: 'Volta para o Escritório (Corroios)',
};

export function TechMileagePage() {
  const [trips, setTrips] = useState<MileageTrip[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [mileageEnabled, setMileageEnabled] = useState(true);

  async function loadTrips() {
    const res = await apiFetch<{ trips: MileageTrip[]; mileageEnabled?: boolean }>('/api/mileage');
    setTrips(res.trips);
    if (res.mileageEnabled !== undefined) setMileageEnabled(res.mileageEnabled);
  }

  useEffect(() => {
    loadTrips();
  }, []);

  async function handleReturnToOffice() {
    setBusy(true);
    try {
      let coords: { originLat?: number; originLng?: number } = {};
      if (typeof navigator !== 'undefined' && navigator.geolocation) {
        coords = await new Promise((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ originLat: pos.coords.latitude, originLng: pos.coords.longitude }),
            () => resolve({}),
            { enableHighAccuracy: true, timeout: 4500 }
          );
        });
      }
      const res = await apiFetch<{ trip: any }>('/api/mileage/record', {
        method: 'POST',
        body: JSON.stringify({ action: 'return_to_office', ...coords }),
      });
      setToast(`Retorno ao escritório registado: ${res.trip.distance_km} km.`);
      setTimeout(() => setToast(null), 5000);
      await loadTrips();
    } finally {
      setBusy(false);
    }
  }

  const todayStr = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 86400000);

  const kmToday = trips
    .filter((t) => t.started_at.startsWith(todayStr))
    .reduce((s, t) => s + Number(t.distance_km), 0);
  const kmWeek = trips
    .filter((t) => new Date(t.started_at) >= weekAgo)
    .reduce((s, t) => s + Number(t.distance_km), 0);
  const kmMonth = trips.reduce((s, t) => s + Number(t.distance_km), 0);
  const totalReimbursement = trips.reduce((s, t) => s + Number(t.reimbursement_amount), 0);

  return (
    <PortalLayout
      title="Controle de Quilometragem (Km)"
      breadcrumb="Portal do Técnico"
      primaryAction={
        <div className="flex flex-wrap items-center gap-2">
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
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" />
            <span>PDF</span>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleReturnToOffice}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
          >
            <Home className="h-3.5 w-3.5" />
            <span>{busy ? 'A calcular...' : 'Volta para o Escritório'}</span>
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        {toast && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
            {toast}
          </div>
        )}

        {!mileageEnabled && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700">
            Não recebe reembolso de quilometragem. Os registos abaixo servem apenas de controlo e de
            cálculo de chegada (ETA). Para mudar, fale com a gestão.
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium text-slate-500">Km Hoje</div>
            <div className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
              {kmToday.toFixed(1)} km
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium text-slate-500">Km na Semana</div>
            <div className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
              {kmWeek.toFixed(1)} km
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium text-slate-500">Km no Mês</div>
            <div className="mt-2 font-display text-2xl font-bold text-slate-900 tabular-nums">
              {kmMonth.toFixed(1)} km
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium text-slate-500">Reembolso Estimado</div>
            <div className="mt-2 font-display text-2xl font-bold text-emerald-700 tabular-nums">
              {formatEUR(totalReimbursement)}
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
              <tr>
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Tipo & Trajeto</th>
                <th className="px-4 py-3">Ref. OS</th>
                <th className="px-4 py-3 text-right">Distância</th>
                <th className="px-4 py-3 text-right">Reembolso</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {trips.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-3 text-xs text-slate-600 tabular-nums">
                    {formatDatePT(t.started_at, true)}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <div className="font-medium text-slate-900">{TRIP_LABELS[t.trip_type]}</div>
                    <div className="text-slate-500">
                      {t.origin_address} → {t.destination_address}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">
                    {t.reference_code || 'Retorno'}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    {Number(t.distance_km).toFixed(1)} km
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-emerald-700 tabular-nums">
                    {formatEUR(t.reimbursement_amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </PortalLayout>
  );
}
