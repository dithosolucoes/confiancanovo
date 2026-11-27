import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

interface ApplianceType {
  id: string;
  name: string;
  active: boolean;
}

// Campos compartilhados nos formulários de pedido: tipo de aparelho (lista do gestor) e NIF para faturação.
// O NIF é opcional: se ficar vazio, o servidor usa o do perfil ou da empresa.
export function ApplianceNifFields({
  appliance,
  onApplianceChange,
  nif,
  onNifChange,
}: {
  appliance: string;
  onApplianceChange: (value: string) => void;
  nif: string;
  onNifChange: (value: string) => void;
}) {
  const [types, setTypes] = useState<ApplianceType[]>([]);

  useEffect(() => {
    apiFetch<{ appliance_types: ApplianceType[] }>('/api/appliance-types')
      .then((r) => setTypes(r.appliance_types))
      .catch(() => setTypes([]));
  }, []);

  return (
    <>
      <div>
        <label className="block text-xs font-medium text-slate-700">Tipo de aparelho</label>
        <select
          value={appliance}
          onChange={(e) => onApplianceChange(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
        >
          <option value="">Escolher...</option>
          {types.map((t) => (
            <option key={t.id} value={t.name}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-700">NIF para faturação (opcional)</label>
        <input
          type="text"
          inputMode="numeric"
          maxLength={11}
          value={nif}
          onChange={(e) => onNifChange(e.target.value)}
          placeholder="9 dígitos"
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
        />
      </div>
    </>
  );
}
