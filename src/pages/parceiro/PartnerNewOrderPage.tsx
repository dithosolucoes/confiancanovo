import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ImagePlus, Trash2 } from 'lucide-react';
import { PortalLayout } from '../../components/PortalLayout';
import { ApplianceNifFields } from '../../components/ApplianceNifFields';
import { apiFetch, formatEUR } from '../../lib/api';
import type { ServiceCatalogItem } from '../../types/domain';

interface InitialPhoto {
  fileName: string;
  dataUrl: string;
  phase: 'before';
  caption: string;
}

export function PartnerNewOrderPage() {
  const navigate = useNavigate();
  const [catalog, setCatalog] = useState<ServiceCatalogItem[]>([]);
  const [catalogId, setCatalogId] = useState('');
  const [serviceAddress, setServiceAddress] = useState('');
  const [addressComplement, setAddressComplement] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [localidade, setLocalidade] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [urgency, setUrgency] = useState<'normal' | 'urgent'>('normal');
  const [serviceKind, setServiceKind] = useState<'avulso' | 'sequencia'>('avulso');
  const [applianceType, setApplianceType] = useState('');
  const [customerNif, setCustomerNif] = useState('');
  const [scheduledAt, setScheduledAt] = useState(
    new Date(Date.now() + 3600 * 1000 * 4).toISOString().slice(0, 16)
  );
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<InitialPhoto[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ catalog: ServiceCatalogItem[] }>('/api/catalog').then((res) => {
      const active = res.catalog.filter((c) => c.is_active && !c.is_subscription);
      setCatalog(active);
      if (active[0]) setCatalogId(active[0].id);
    });
  }, []);

  async function handlePhotoFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []).slice(0, 4 - photos.length);
    e.target.value = '';
    const loaded: InitialPhoto[] = [];
    for (const file of files) {
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(file);
      });
      loaded.push({
        fileName: file.name,
        dataUrl,
        phase: 'before',
        caption: 'Anexo B2B inicial',
      });
    }
    setPhotos((prev) => [...prev, ...loaded].slice(0, 4));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch<{ order: { id: string } }>('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          catalog_id: catalogId,
          customer_name: contactName,
          customer_phone: contactPhone,
          service_address: serviceAddress,
          address_complement: addressComplement || null,
          postal_code: postalCode || null,
          localidade: localidade || null,
          scheduled_at: new Date(scheduledAt).toISOString(),
          description,
          urgency,
          service_kind: serviceKind,
          appliance_type: applianceType,
          customer_nif: customerNif,
          photos: photos.length > 0 ? photos : undefined,
        }),
      });
      navigate(`/parceiro/servicos/${res.order.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PortalLayout title="Abrir Novo Chamado B2B" breadcrumb="Parceiro Contratante">
      <form
        onSubmit={handleSubmit}
        className="mx-auto max-w-2xl space-y-5 rounded-xl border border-slate-200 bg-white p-6"
      >
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700">
            {error}
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-slate-700">Serviço (catálogo)</label>
          <select
            value={catalogId}
            onChange={(e) => setCatalogId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm"
          >
            {catalog.map((c) => (
              <option key={c.id} value={c.id}>
                {c.category} — {c.name} (Taxa {formatEUR(c.base_service_fee)} · IVA {c.default_vat_rate}%)
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-700">
              Morada do Imóvel / Fração
            </label>
            <input
              type="text"
              required
              value={serviceAddress}
              onChange={(e) => setServiceAddress(e.target.value)}
              placeholder="Ex: Rua do Alecrim, 42, Lisboa"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">
              Complemento / Fração
            </label>
            <input
              type="text"
              value={addressComplement}
              onChange={(e) => setAddressComplement(e.target.value)}
              placeholder="Ex: 3º B / Portaria"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700">Cód. Postal</label>
              <input
                type="text"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                placeholder="1200-018"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700">Localidade</label>
              <input
                type="text"
                value={localidade}
                onChange={(e) => setLocalidade(e.target.value)}
                placeholder="Lisboa"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">
              Contacto no Local (Inquilino / Portaria)
            </label>
            <input
              type="text"
              required
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">Telemóvel</label>
            <input
              type="text"
              required
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">Data e Janela</label>
            <input
              type="datetime-local"
              required
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">Prioridade</label>
            <select
              value={urgency}
              onChange={(e) => setUrgency(e.target.value as 'normal' | 'urgent')}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <option value="normal">Normal (Agendado)</option>
              <option value="urgent">Urgente (24h)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700">Tipo de Serviço</label>
            <select
              value={serviceKind}
              onChange={(e) => setServiceKind(e.target.value as 'avulso' | 'sequencia')}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <option value="avulso">Avulso (uma visita)</option>
              <option value="sequencia">Em sequência (várias visitas)</option>
            </select>
          </div>
          <ApplianceNifFields
            appliance={applianceType}
            onApplianceChange={setApplianceType}
            nif={customerNif}
            onNifChange={setCustomerNif}
          />

          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-700">
              Descrição do Problema / Notas de Acesso
            </label>
            <textarea
              rows={3}
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descreva a avaria e instruções de acesso..."
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>

          <div className="sm:col-span-2 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-medium text-slate-700">
                Fotos do Imóvel / Avaria (Opcional · até 4 fotos)
              </label>
              {photos.length < 4 && (
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                  <ImagePlus className="h-3.5 w-3.5" />
                  <span>Anexar Foto</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    onChange={handlePhotoFiles}
                    className="hidden"
                  />
                </label>
              )}
            </div>
            {photos.length > 0 && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {photos.map((p, idx) => (
                  <div
                    key={idx}
                    className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
                  >
                    <img src={p.dataUrl} alt={p.fileName} className="h-20 w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setPhotos((prev) => prev.filter((_, i) => i !== idx))}
                      className="absolute right-1 top-1 rounded bg-white/90 p-1 text-rose-600 shadow-sm hover:bg-white"
                      aria-label="Remover foto"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end border-t border-slate-100 pt-4">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {submitting ? 'A abrir chamado...' : 'Submeter Pedido à Confiança'}
          </button>
        </div>
      </form>
    </PortalLayout>
  );
}
