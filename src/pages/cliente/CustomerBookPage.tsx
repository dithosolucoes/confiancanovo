import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, ImagePlus, Repeat, ShieldCheck, Star, Trash2 } from 'lucide-react';
import { ApplianceNifFields } from '../../components/ApplianceNifFields';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { PortalLayout } from '../../components/PortalLayout';
import { StripeCheckoutModal } from '../../components/StripeCheckoutModal';
import { useAuth } from '../../context/AuthContext';
import { apiFetch, formatEUR } from '../../lib/api';
import type { ServiceCatalogItem, ServiceSubscription } from '../../types/domain';

interface PrevTech {
  id: string;
  full_name: string;
  avatar_url?: string | null;
}

interface InitialPhoto {
  fileName: string;
  dataUrl: string;
  phase: 'before';
  caption: string;
}

export function CustomerBookPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'booking' | 'subscriptions'>('booking');
  const [catalog, setCatalog] = useState<ServiceCatalogItem[]>([]);
  const [prevTechs, setPrevTechs] = useState<PrevTech[]>([]);
  const [subscriptions, setSubscriptions] = useState<ServiceSubscription[]>([]);
  const [categoryFilter, setCategoryFilter] = useState('Todas');

  const [catalogId, setCatalogId] = useState('');
  const [address, setAddress] = useState(user?.address || '');
  const [addressComplement, setAddressComplement] = useState('');
  const [postalCode, setPostalCode] = useState(user?.postal_code || '');
  const [localidade, setLocalidade] = useState(user?.city || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [scheduledAt, setScheduledAt] = useState(
    new Date(Date.now() + 3600 * 1000 * 3).toISOString().slice(0, 16)
  );
  const [urgency, setUrgency] = useState<'normal' | 'urgent'>('normal');
  const [serviceKind, setServiceKind] = useState<'avulso' | 'sequencia'>('avulso');
  const [applianceType, setApplianceType] = useState('');
  const [customerNif, setCustomerNif] = useState('');
  const [description, setDescription] = useState('');
  const [preferredTechId, setPreferredTechId] = useState('');
  // Cobrança só com escolha explícita da cliente (B2: antes vinha marcada por padrão)
  const [payInitialNow, setPayInitialNow] = useState(false);
  const [photos, setPhotos] = useState<InitialPhoto[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  // Subscriptions state
  const [subAddress, setSubAddress] = useState(user?.address || '');
  const [subDay, setSubDay] = useState(15);
  const [subBusyId, setSubBusyId] = useState<string | null>(null);
  const [subToast, setSubToast] = useState<string | null>(null);
  const [confirmSubAction, setConfirmSubAction] = useState<{
    subId: string;
    nextStatus: 'paused' | 'cancelled';
    planName: string;
  } | null>(null);

  async function loadAll() {
    const [c, t, s] = await Promise.all([
      apiFetch<{ catalog: ServiceCatalogItem[] }>('/api/catalog'),
      apiFetch<{ technicians: PrevTech[] }>('/api/technicians'),
      apiFetch<{ subscriptions: ServiceSubscription[] }>('/api/subscriptions').catch(() => ({
        subscriptions: [],
      })),
    ]);
    const active = c.catalog.filter((item) => item.is_active);
    setCatalog(active);
    const nonSub = active.filter((i) => !i.is_subscription);
    if (nonSub[0] && !catalogId) setCatalogId(nonSub[0].id);
    setPrevTechs(t.technicians);
    setSubscriptions(s.subscriptions);
  }

  useEffect(() => {
    void loadAll();
  }, []);

  const regularCatalog = catalog.filter((c) => !c.is_subscription);
  const subscriptionPlans = catalog.filter((c) => c.is_subscription);
  const categories = ['Todas', ...Array.from(new Set(regularCatalog.map((c) => c.category)))];
  const filteredCatalog =
    categoryFilter === 'Todas'
      ? regularCatalog
      : regularCatalog.filter((c) => c.category === categoryFilter);

  const selectedService = regularCatalog.find((c) => c.id === catalogId) || filteredCatalog[0];

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
        caption: 'Anexo inicial do cliente',
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
          catalog_id: selectedService?.id || catalogId,
          customer_name: user?.full_name,
          customer_phone: phone,
          service_address: address,
          address_complement: addressComplement || null,
          postal_code: postalCode || null,
          localidade: localidade || null,
          scheduled_at: new Date(scheduledAt).toISOString(),
          description,
          urgency,
          service_kind: serviceKind,
          appliance_type: applianceType,
          customer_nif: customerNif,
          preferred_technician_id: preferredTechId || null,
          photos: photos.length > 0 ? photos : undefined,
        }),
      });

      if (payInitialNow) {
        setCreatedOrderId(res.order.id);
        setCheckoutOpen(true);
      } else {
        navigate(`/cliente/servicos/${res.order.id}`);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubscribe(planId: string) {
    if (!subAddress.trim()) {
      setError('Indique a morada da subscrição.');
      return;
    }
    setError(null);
    setSubBusyId(planId);
    try {
      const res = await apiFetch<{
        subscription: ServiceSubscription;
        initialOrder?: { id: string } | null;
      }>('/api/subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          catalog_id: planId,
          service_address: subAddress,
          preferred_day: subDay,
          create_initial_order: true,
        }),
      });
      await loadAll();
      if (res.initialOrder?.id) {
        setCreatedOrderId(res.initialOrder.id);
        setCheckoutOpen(true);
      } else {
        setSubToast('Plano mensal ativado com sucesso!');
        setTimeout(() => setSubToast(null), 4000);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubBusyId(null);
    }
  }

  async function handleSubscriptionStatus(
    subId: string,
    status: 'active' | 'paused' | 'cancelled'
  ) {
    setError(null);
    try {
      await apiFetch(`/api/subscriptions/${subId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setConfirmSubAction(null);
      await loadAll();
    } catch (err: any) {
      setConfirmSubAction(null);
      setError(err.message);
    }
  }

  return (
    <PortalLayout title="Solicitar Assistência & Subscrições" breadcrumb="Portal do Cliente">
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Segmented Control */}
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
          <button
            type="button"
            onClick={() => setActiveTab('booking')}
            className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === 'booking'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Agendar Serviço Avulso
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('subscriptions')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === 'subscriptions'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Repeat className="h-3.5 w-3.5" />
            <span>Planos & Subscrições (€49,99/mês)</span>
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700">
            {error}
          </div>
        )}

        {activeTab === 'booking' ? (
          <form
            onSubmit={handleSubmit}
            className="space-y-5 rounded-xl border border-slate-200 bg-white p-6"
          >
            {/* Category Filter */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-2">
                Área de Serviço
              </label>
              <div className="flex flex-wrap gap-1.5">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => {
                      setCategoryFilter(cat);
                      const first = regularCatalog.find(
                        (item) => cat === 'Todas' || item.category === cat
                      );
                      if (first) setCatalogId(first.id);
                    }}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                      categoryFilter === cat
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Escolha o Serviço
              </label>
              <select
                value={selectedService?.id || catalogId}
                onChange={(e) => setCatalogId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm"
              >
                {filteredCatalog.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.category} — {c.name} (Deslocação/Diagnóstico: {formatEUR(c.base_service_fee)})
                  </option>
                ))}
              </select>
              {selectedService && (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <span>
                    {selectedService.description} · Taxa inicial{' '}
                    {formatEUR(selectedService.base_service_fee)} + IVA (
                    {selectedService.default_vat_rate}%).
                  </span>
                  <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Garantia {selectedService.warranty_months || 6} meses · 24h/7d
                  </span>
                </div>
              )}
            </div>

            {/* Quero o mesmo técnico (Smart routing if customer has previous completed orders) */}
            {prevTechs.length > 0 && (
              <div className="rounded-xl border border-violet-200 bg-violet-50/70 p-4 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-violet-900">
                  <Star className="h-4 w-4 fill-violet-600 text-violet-600" />
                  <span>Quero o mesmo técnico (Clientes Recorrentes)</span>
                </div>
                <p className="text-xs text-violet-800">
                  Já concluiu serviços connosco anteriormente. Pode direcionar este pedido
                  diretamente:
                </p>
                <select
                  value={preferredTechId}
                  onChange={(e) => setPreferredTechId(e.target.value)}
                  className="w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs font-medium text-slate-800"
                >
                  <option value="">Qualquer técnico disponível na zona</option>
                  {prevTechs.map((t) => (
                    <option key={t.id} value={t.id}>
                      ★ Sim, quero novamente o técnico {t.full_name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700">
                  Morada do Serviço (Lisboa e região, Margem Sul)
                </label>
                <input
                  type="text"
                  required
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Complemento / Andar
                </label>
                <input
                  type="text"
                  value={addressComplement}
                  onChange={(e) => setAddressComplement(e.target.value)}
                  placeholder="Ex: 2º Dto / Fração C"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Código Postal
                  </label>
                  <input
                    type="text"
                    value={postalCode}
                    onChange={(e) => setPostalCode(e.target.value)}
                    placeholder="2855-000"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Localidade</label>
                  <input
                    type="text"
                    value={localidade}
                    onChange={(e) => setLocalidade(e.target.value)}
                    placeholder="Corroios / Lisboa"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Data e Janela Horária (24h/7d)
                </label>
                <input
                  type="datetime-local"
                  required
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">Telemóvel</label>
                <input
                  type="text"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Tipo de Atendimento
                </label>
                <select
                  value={urgency}
                  onChange={(e) => setUrgency(e.target.value as 'normal' | 'urgent')}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="normal">Agendado</option>
                  <option value="urgent">Urgência 24h</option>
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
                <p className="mt-1 text-[11px] text-slate-500">
                  Manutenção recorrente: use a aba Planos & Subscrições.
                </p>
              </div>

              <ApplianceNifFields
                appliance={applianceType}
                onApplianceChange={setApplianceType}
                nif={customerNif}
                onNifChange={setCustomerNif}
              />

              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={payInitialNow}
                    onChange={(e) => setPayInitialNow(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span>Pagar taxa de deslocação agora (MB Way / Multibanco / Cartão)</span>
                </label>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700">
                  Descrição da Avaria
                </label>
                <textarea
                  rows={3}
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Descreva o problema do equipamento ou instalação..."
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>

              <div className="sm:col-span-2 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-xs font-medium text-slate-700">
                    Fotografias Iniciais da Avaria (Opcional · até 4 fotos)
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
                        <img
                          src={p.dataUrl}
                          alt={p.fileName}
                          className="h-20 w-full object-cover"
                        />
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
                {submitting
                  ? 'A registar pedido...'
                  : payInitialNow
                  ? 'Agendar e Pagar Taxa Inicial'
                  : 'Confirmar Agendamento'}
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-6">
            {subToast && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
                {subToast}
              </div>
            )}

            {/* Available Plans */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Planos de Manutenção & Limpeza Recorrente
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Subscrição mensal sem fidelização longa — agende o dia preferencial de visita.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700">
                    Morada da Subscrição
                  </label>
                  <input
                    type="text"
                    value={subAddress}
                    onChange={(e) => setSubAddress(e.target.value)}
                    placeholder="Morada completa em Lisboa / Margem Sul"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Dia Preferido (1–28)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={28}
                    value={subDay}
                    onChange={(e) => setSubDay(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs tabular-nums"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {subscriptionPlans.map((plan) => (
                  <div
                    key={plan.id}
                    className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-3"
                  >
                    <div>
                      <div className="text-xs font-medium text-slate-500">{plan.category}</div>
                      <div className="mt-0.5 text-sm font-semibold text-slate-900">{plan.name}</div>
                      <p className="mt-1 text-xs text-slate-600">{plan.description}</p>
                    </div>
                    <div className="flex items-center justify-between border-t border-slate-200 pt-3">
                      <div className="font-display text-lg font-bold text-slate-900 tabular-nums">
                        {formatEUR(plan.subscription_price || plan.base_service_fee)}
                        <span className="text-xs font-normal text-slate-500"> /mês</span>
                      </div>
                      <button
                        type="button"
                        disabled={subBusyId === plan.id}
                        onClick={() => handleSubscribe(plan.id)}
                        className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                      >
                        {subBusyId === plan.id ? 'A ativar...' : 'Subscrever & Pagar 1.º Mês'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* My Subscriptions */}
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-6 py-4">
                <h3 className="text-sm font-semibold text-slate-900">As Minhas Subscrições</h3>
              </div>
              {subscriptions.length === 0 ? (
                <div className="p-6 text-xs text-slate-500">
                  Ainda não possui subscrições ativas.
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {subscriptions.map((sub) => (
                    <div
                      key={sub.id}
                      className="flex flex-wrap items-center justify-between gap-4 px-6 py-4"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900">
                            {sub.plan_name}
                          </span>
                          <span
                            className={`text-xs font-medium ${
                              sub.status === 'active'
                                ? 'text-emerald-700'
                                : sub.status === 'paused'
                                ? 'text-amber-700'
                                : 'text-slate-400'
                            }`}
                          >
                            {sub.status === 'active' ? (
                              <span className="inline-flex items-center gap-1">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Ativa
                              </span>
                            ) : sub.status === 'paused' ? (
                              'Pausada'
                            ) : (
                              'Cancelada'
                            )}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-slate-500 tabular-nums">
                          {sub.service_address} · Dia {sub.preferred_day} · Próxima cobrança:{' '}
                          {sub.next_billing_date} · <strong>{formatEUR(sub.monthly_price)}/mês</strong>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {sub.status === 'active' && (
                          <button
                            type="button"
                            onClick={() =>
                              setConfirmSubAction({
                                subId: sub.id,
                                nextStatus: 'paused',
                                planName: sub.plan_name,
                              })
                            }
                            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Pausar
                          </button>
                        )}
                        {sub.status === 'paused' && (
                          <button
                            type="button"
                            onClick={() => handleSubscriptionStatus(sub.id, 'active')}
                            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                          >
                            Reativar
                          </button>
                        )}
                        {sub.status !== 'cancelled' && (
                          <button
                            type="button"
                            onClick={() =>
                              setConfirmSubAction({
                                subId: sub.id,
                                nextStatus: 'cancelled',
                                planName: sub.plan_name,
                              })
                            }
                            className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
                          >
                            Cancelar
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmSubAction !== null}
        variant={confirmSubAction?.nextStatus === 'cancelled' ? 'danger' : 'primary'}
        title={
          confirmSubAction?.nextStatus === 'cancelled'
            ? 'Cancelar subscrição?'
            : 'Pausar subscrição?'
        }
        description={
          confirmSubAction
            ? confirmSubAction.nextStatus === 'cancelled'
              ? `Tem a certeza que pretende cancelar o plano "${confirmSubAction.planName}"?`
              : `O plano "${confirmSubAction.planName}" ficará pausado até decidir reativá-lo.`
            : ''
        }
        confirmLabel={
          confirmSubAction?.nextStatus === 'cancelled' ? 'Sim, Cancelar' : 'Sim, Pausar'
        }
        onCancel={() => setConfirmSubAction(null)}
        onConfirm={() => {
          if (confirmSubAction) {
            void handleSubscriptionStatus(confirmSubAction.subId, confirmSubAction.nextStatus);
          }
        }}
      />

      {createdOrderId && (
        <StripeCheckoutModal
          isOpen={checkoutOpen}
          onClose={() => {
            setCheckoutOpen(false);
            navigate(`/cliente/servicos/${createdOrderId}`);
          }}
          serviceOrderId={createdOrderId}
          paymentType="service_fee"
          onSuccess={() => {
            void loadAll();
            setSubToast('Pagamento registado com sucesso.');
          }}
        />
      )}
    </PortalLayout>
  );
}

