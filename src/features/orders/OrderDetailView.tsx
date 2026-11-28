import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Calendar,
  CalendarClock,
  CheckCircle2,
  Clock,
  CreditCard,
  Download,
  Edit3,
  ExternalLink,
  FileText,
  Lock,
  MapPin,
  Navigation,
  Plus,
  Receipt,
  RefreshCw,
  Send,
  ShieldCheck,
  Star,
  Trash2,
  Wrench,
  XCircle,
} from 'lucide-react';
import { ApplianceNifFields } from '../../components/ApplianceNifFields';
import { exportCustomerReceiptPDF } from '../../lib/exports';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { GpsPermissionPrompt } from '../../components/GpsPermissionPrompt';
import { PortalLayout } from '../../components/PortalLayout';
import { PrivatePhotoGallery } from '../../components/PrivatePhotoGallery';
import { QuoteStatusLabel, ServiceStatusLabel } from '../../components/StatusLabel';
import { StripeCheckoutModal } from '../../components/StripeCheckoutModal';
import { useAuth } from '../../context/AuthContext';
import { useRealtime } from '../../context/RealtimeContext';
import { apiFetch, formatDatePT, formatEUR, getAuthToken } from '../../lib/api';
import {
  calculateServiceFinancials,
  computeAdditionalChargesSummary,
} from '../../core/finance/calculator';
import type {
  Organization,
  ServiceOrder,
  ServiceStatus,
  QuoteStatus,
  Supplier,
  UserProfile,
} from '../../types/domain';

interface DraftItem {
  description: string;
  quantity: number;
  customer_unit_price: number;
  supplier_unit_cost: number;
  supplier_id: string;
}

// C-11: M.O./taxa extra lançadas pelo técnico, aguardando decisão da gestão (server/routes/orcamento.ts)
interface LaborExtraPendingFields {
  pending_labor_cost?: number | null;
  pending_extra_fee?: number | null;
  labor_extra_pending_at?: string | null;
}

// A-06: motivos que impedem concluir a OS no cliente (o servidor não exige estes campos em PATCH /api/orders/:id)
function getCompleteBlockers(order: ServiceOrder, reportText: string, itemsCount: number): string[] {
  const blockers: string[] = [];
  const hasPhoto = (order.photos?.length ?? 0) > 0;
  const hasReport = reportText.trim().length > 0;
  if (!hasPhoto && !hasReport) {
    blockers.push('Adicione pelo menos uma foto da intervenção ou preencha o relatório técnico.');
  }
  if (order.quote_status === 'sent') {
    blockers.push('O orçamento aguarda aprovação do cliente.');
  } else if (order.quote_status === null && itemsCount > 0) {
    blockers.push('Há itens de orçamento não enviados. Envie o orçamento ao cliente e aguarde a aprovação.');
  }
  return blockers;
}

function formatExecutionDuration(start?: string | null, end?: string | null): string | null {
  if (!start || !end) return null;
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return null;
  const totalMin = Math.round((e - s) / 60000);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function OrderDetailView({ backRoute }: { backRoute: string }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { connected: wsConnected, subscribeOrder, unsubscribeOrder, addListener } = useRealtime();

  const [order, setOrder] = useState<ServiceOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [calendarLink, setCalendarLink] = useState<string | null>(null);

  // Admin / Tech options
  const [technicians, setTechnicians] = useState<UserProfile[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  // Financial & Operational editable state
  const [status, setStatus] = useState<ServiceStatus>('pending');
  const [quoteStatus, setQuoteStatus] = useState<QuoteStatus>(null);
  const [providerOrgId, setProviderOrgId] = useState('org-matrix');
  const [technicianId, setTechnicianId] = useState('');
  const [vatRate, setVatRate] = useState<6 | 23>(23);
  const [serviceFee, setServiceFee] = useState(55);
  const [laborCost, setLaborCost] = useState(0);
  const [extraFee, setExtraFee] = useState(0);
  const [additionalCost, setAdditionalCost] = useState(0);
  const [isWarranty, setIsWarranty] = useState(false);
  const [legacyMarkup, setLegacyMarkup] = useState(false);
  const [legacyPayoutRule, setLegacyPayoutRule] = useState(false);
  const [fixedPayoutAmount, setFixedPayoutAmount] = useState(0);
  const [payoutOverridden, setPayoutOverridden] = useState(false);
  const [manualPayout, setManualPayout] = useState(0);

  // Core metadata & Technical Report
  const [reportText, setReportText] = useState('');
  const [editCoreOpen, setEditCoreOpen] = useState(false);
  const [editCustomerName, setEditCustomerName] = useState('');
  const [editCustomerPhone, setEditCustomerPhone] = useState('');
  const [editCustomerNif, setEditCustomerNif] = useState('');
  const [editAppliance, setEditAppliance] = useState('');
  const [editServiceAddress, setEditServiceAddress] = useState('');
  const [editAddressComplement, setEditAddressComplement] = useState('');
  const [editPostalCode, setEditPostalCode] = useState('');
  const [editLocalidade, setEditLocalidade] = useState('');
  const [editScheduledAt, setEditScheduledAt] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editUrgency, setEditUrgency] = useState<'normal' | 'urgent'>('normal');

  // Admin Invoicing & Baixa
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceIssuedAt, setInvoiceIssuedAt] = useState('');
  const [baixaDate, setBaixaDate] = useState('');

  // Schedule Suggestion Modal
  const [suggestModalOpen, setSuggestModalOpen] = useState(false);
  const [suggestDate, setSuggestDate] = useState(new Date().toISOString().split('T')[0]);
  const [suggestTime, setSuggestTime] = useState('10:00');

  // Warranty Return Request Modal (Customer/Partner)
  const [warrantyModalOpen, setWarrantyModalOpen] = useState(false);
  const [warrantyDescription, setWarrantyDescription] = useState('');
  const [warrantyPreferredDate, setWarrantyPreferredDate] = useState('');

  // Return Visit state & Customer Reschedule
  const [returnDate, setReturnDate] = useState(
    new Date(Date.now() + 3600 * 1000 * 48).toISOString().slice(0, 16)
  );
  const [returnNotes, setReturnNotes] = useState('');
  const [returnTechId, setReturnTechId] = useState('');
  const [rescheduleVisitId, setRescheduleVisitId] = useState<string | null>(null);
  const [rescheduleDateTime, setRescheduleDateTime] = useState('');
  const [rescheduleNotes, setRescheduleNotes] = useState('');

  // Quote items
  const [items, setItems] = useState<DraftItem[]>([]);

  // Chat
  const [chatText, setChatText] = useState('');

  // Customer Rating
  const [ratingVal, setRatingVal] = useState(5);
  const [ratingComment, setRatingComment] = useState('');

  // Technician Completion Photos note
  const [beforePhoto, setBeforePhoto] = useState('');
  const [afterPhoto, setAfterPhoto] = useState('');

  // Confirmations & Prompts
  const [confirmAction, setConfirmAction] = useState<
    null | 'soft_delete' | 'reject_quote' | 'cancel_order' | 'release_order'
  >(null);
  const [gpsPrompt, setGpsPrompt] = useState<{
    open: boolean;
    mode: 'on_the_way' | 'live_gps';
    message?: string;
  }>({ open: false, mode: 'on_the_way' });

  // Stripe Modal & TOC Online Preview
  const [checkoutModal, setCheckoutModal] = useState<{
    open: boolean;
    paymentType: 'service_fee' | 'quote_total' | 'full';
  }>({ open: false, paymentType: 'quote_total' });
  const [tocModalOpen, setTocModalOpen] = useState(false);

  const loadOrder = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ order: ServiceOrder }>(`/api/orders/${id}`);
      const o = res.order;
      setOrder(o);
      setStatus(o.status);
      setQuoteStatus(o.quote_status);
      setProviderOrgId(o.provider_org_id);
      setTechnicianId(o.technician_id || '');
      setVatRate(Number(o.vat_rate) === 6 ? 6 : 23);
      setServiceFee(Number(o.service_fee));
      setLaborCost(Number(o.labor_cost));
      setExtraFee(Number(o.extra_fee));
      setAdditionalCost(Number(o.additional_cost));
      setIsWarranty(Boolean(o.is_warranty));
      setLegacyMarkup(Boolean(o.legacy_parts_markup));
      setLegacyPayoutRule(Boolean(o.legacy_payout_rule));
      setFixedPayoutAmount(Number(o.fixed_payout_amount ?? 0));
      setPayoutOverridden(Boolean(o.technician_payout_overridden));
      setManualPayout(Number(o.technician_payout ?? 0));
      setReturnTechId(o.technician_id || '');
      setBeforePhoto(o.before_photo_note || '');
      setAfterPhoto(o.after_photo_note || '');
      setReportText(o.report_text || '');
      setEditCustomerName(o.customer_name || '');
      setEditCustomerPhone(o.customer_phone || '');
      setEditCustomerNif(o.customer_nif || '');
      setEditAppliance(o.appliance_type || '');
      setEditServiceAddress(o.service_address || '');
      setEditAddressComplement(o.address_complement || '');
      setEditPostalCode(o.postal_code || '');
      setEditLocalidade(o.localidade || '');
      const schedDt = new Date(o.scheduled_at);
      setEditScheduledAt(
        !Number.isNaN(schedDt.getTime())
          ? new Date(schedDt.getTime() - schedDt.getTimezoneOffset() * 60000)
              .toISOString()
              .slice(0, 16)
          : ''
      );
      setEditDescription(o.description || '');
      setEditUrgency(o.urgency || 'normal');
      setInvoiceNumber(o.invoice_number || '');
      setInvoiceIssuedAt(
        o.invoice_issued_at || new Date().toISOString().split('T')[0]
      );
      setBaixaDate(
        o.baixa_received_at || new Date().toISOString().split('T')[0]
      );
      setItems(
        (o.items || []).map((i) => ({
          description: i.description,
          quantity: Number(i.quantity),
          customer_unit_price: Number(i.customer_unit_price),
          supplier_unit_cost: Number(i.supplier_unit_cost ?? 0),
          supplier_id: i.supplier_id || '',
        }))
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadOrder();
  }, [loadOrder]);

  useEffect(() => {
    if (!id) return;
    subscribeOrder(id);
    const remove = addListener((evt) => {
      if (evt.orderId !== id) return;
      if (evt.type === 'chat:message' && evt.message) {
        setOrder((prev) => {
          if (!prev) return prev;
          const existingMsgs = prev.messages || [];
          if (existingMsgs.some((m) => m.id === evt.message.id)) return prev;
          return { ...prev, messages: [...existingMsgs, evt.message] };
        });
      } else if (evt.type === 'order:updated') {
        if (evt.eta_minutes !== undefined) {
          setOrder((prev) =>
            prev
              ? {
                  ...prev,
                  eta_minutes: evt.eta_minutes ?? prev.eta_minutes,
                  eta_distance_km: evt.eta_distance_km ?? prev.eta_distance_km,
                  eta_updated_at: new Date().toISOString(),
                }
              : prev
          );
        } else {
          void loadOrder();
        }
      }
    });
    return () => {
      remove();
      unsubscribeOrder(id);
    };
  }, [id, subscribeOrder, unsubscribeOrder, addListener, loadOrder]);

  useEffect(() => {
    if (!user) return;
    if (user.role === 'super_admin' || user.role === 'company_admin') {
      apiFetch<{ technicians: UserProfile[] }>('/api/technicians')
        .then((r) => setTechnicians(r.technicians))
        .catch(() => {});
    }
    if (user.role === 'super_admin') {
      apiFetch<{ organizations: Organization[] }>('/api/organizations')
        .then((r) => setOrganizations(r.organizations))
        .catch(() => {});
    }
    if (user.role === 'super_admin' || user.role === 'technician') {
      apiFetch<{ suppliers: Supplier[] }>('/api/suppliers')
        .then((r) => setSuppliers(r.suppliers))
        .catch(() => {});
    }
  }, [user]);

  function notify(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  async function handleAdminSave() {
    if (!order) return;
    setSaving(true);
    setActionError(null);
    try {
      await apiFetch(`/api/orders/${order.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status,
          quote_status: quoteStatus,
          provider_org_id: providerOrgId,
          technician_id: technicianId || null,
          report_text: reportText,
          vat_rate: vatRate,
          service_fee: serviceFee,
          labor_cost: laborCost,
          extra_fee: extraFee,
          additional_cost: additionalCost,
          is_warranty: isWarranty,
          legacy_parts_markup: legacyMarkup,
          legacy_payout_rule: legacyPayoutRule,
          fixed_payout_amount: fixedPayoutAmount,
          technician_payout_overridden: payoutOverridden,
          manual_technician_payout: manualPayout,
        }),
      });
      await apiFetch(`/api/orders/${order.id}/quote`, {
        method: 'POST',
        body: JSON.stringify({
          labor_cost: laborCost,
          extra_fee: extraFee,
          additional_cost: additionalCost,
          vat_rate: vatRate,
          items,
          send_to_customer: false,
        }),
      });
      await loadOrder();
      notify('Ordem de serviço atualizada com sucesso.');
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleCoreSave(e: React.FormEvent) {
    e.preventDefault();
    if (!order) return;
    setSaving(true);
    setActionError(null);
    try {
      await apiFetch(`/api/orders/${order.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          customer_name: editCustomerName,
          customer_phone: editCustomerPhone,
          service_address: editServiceAddress,
          address_complement: editAddressComplement,
          postal_code: editPostalCode,
          localidade: editLocalidade,
          scheduled_at: editScheduledAt ? new Date(editScheduledAt).toISOString() : undefined,
          description: editDescription,
          urgency: editUrgency,
        }),
      });
      await apiFetch(`/api/orders/${order.id}/details`, {
        method: 'PATCH',
        body: JSON.stringify({ customer_nif: editCustomerNif, appliance_type: editAppliance }),
      });
      setEditCoreOpen(false);
      await loadOrder();
      notify('Dados da ordem atualizados com sucesso.');
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleReleaseOrder() {
    if (!order) return;
    setSaving(true);
    setActionError(null);
    try {
      await apiFetch(`/api/orders/${order.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ release_order: true }),
      });
      setConfirmAction(null);
      navigate('/tecnico/agenda');
    } catch (err: any) {
      setConfirmAction(null);
      setActionError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveReport() {
    if (!order) return;
    setSaving(true);
    setActionError(null);
    try {
      await apiFetch(`/api/orders/${order.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ report_text: reportText }),
      });
      // Só atualiza o relatório. Não recarrega as peças do servidor, para não
      // apagar as linhas de peça/mão de obra que ainda não foram enviadas (B1).
      setOrder((prev) => (prev ? { ...prev, report_text: reportText } : prev));
      notify('Relatório técnico guardado com sucesso.');
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // A-11: único endpoint de cancelamento (confirmado no ConfirmDialog)
  async function handleCancelOrder() {
    if (!order) return;
    setSaving(true);
    setActionError(null);
    try {
      const res = await apiFetch<{ technicianPayout: number }>(`/api/orders/${order.id}/cancel`, { method: 'POST', body: '{}' });
      setConfirmAction(null);
      await loadOrder();
      notify(
        res.technicianPayout > 0
          ? `Ordem cancelada. Repasse ao técnico: € ${res.technicianPayout.toFixed(2)}.`
          : 'Ordem cancelada.'
      );
    } catch (err: any) {
      setConfirmAction(null);
      setActionError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleEmitTocInvoice() {
    if (!order) return;
    if (!window.confirm('Emitir a fatura oficial na TOConline? Depois de emitida, a fatura não pode ser apagada.')) return;
    setSaving(true);
    setActionError(null);
    try {
      const res = await apiFetch<{ documentNo: string }>(`/api/orders/${order.id}/invoice-toc`, { method: 'POST', body: '{}' });
      await loadOrder();
      notify(`Fatura emitida na TOConline: ${res.documentNo}`);
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveInvoice(clear = false) {
    if (!order) return;
    setSaving(true);
    setActionError(null);
    try {
      await apiFetch(`/api/orders/${order.id}/invoice`, {
        method: 'POST',
        body: JSON.stringify(
          clear
            ? { clear: true }
            : { invoice_number: invoiceNumber, invoice_issued_at: invoiceIssuedAt }
        ),
      });
      await loadOrder();
      notify(clear ? 'Dados de fatura removidos.' : 'Fatura registada na ordem.');
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveBaixa(undo = false) {
    if (!order) return;
    setSaving(true);
    setActionError(null);
    try {
      await apiFetch(`/api/orders/${order.id}/baixa`, {
        method: 'POST',
        body: JSON.stringify(undo ? { undo: true } : { received_at: baixaDate }),
      });
      await loadOrder();
      notify(undo ? 'Baixa financeira estornada.' : 'Baixa de recebimento registada.');
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSuggestSchedule(e: React.FormEvent) {
    e.preventDefault();
    if (!order) return;
    setSaving(true);
    setActionError(null);
    try {
      await apiFetch(`/api/orders/${order.id}/suggest-schedule`, {
        method: 'POST',
        body: JSON.stringify({ suggested_date: suggestDate, suggested_time: suggestTime }),
      });
      setSuggestModalOpen(false);
      await loadOrder();
      notify('Sugestão de novo horário enviada ao cliente.');
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSuggestionDecision(decision: 'accepted' | 'rejected') {
    if (!order) return;
    setSaving(true);
    setActionError(null);
    try {
      await apiFetch(`/api/orders/${order.id}/suggestion-decision`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      });
      await loadOrder();
      notify(
        decision === 'accepted'
          ? 'Novo horário confirmado e atualizado na agenda.'
          : 'Sugestão de horário recusada.'
      );
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleWarrantyRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!order) return;
    setSaving(true);
    setActionError(null);
    try {
      await apiFetch(`/api/orders/${order.id}/warranty-request`, {
        method: 'POST',
        body: JSON.stringify({
          description: warrantyDescription,
          preferred_date: warrantyPreferredDate
            ? new Date(warrantyPreferredDate).toISOString()
            : undefined,
        }),
      });
      setWarrantyModalOpen(false);
      setWarrantyDescription('');
      setWarrantyPreferredDate('');
      await loadOrder();
      notify('Pedido de retorno em garantia enviado para a equipa técnica.');
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleRescheduleReturnVisit(e: React.FormEvent) {
    e.preventDefault();
    if (!rescheduleVisitId) return;
    setSaving(true);
    setActionError(null);
    try {
      await apiFetch(`/api/return-visits/${rescheduleVisitId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          scheduled_at: new Date(rescheduleDateTime).toISOString(),
          notes: rescheduleNotes || undefined,
        }),
      });
      setRescheduleVisitId(null);
      await loadOrder();
      notify('Visita de retorno reagendada com sucesso.');
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleTechSaveQuote() {
    if (!order) return;
    setSaving(true);
    setActionError(null);
    try {
      await apiFetch(`/api/orders/${order.id}/quote`, {
        method: 'POST',
        body: JSON.stringify({
          labor_cost: laborCost,
          extra_fee: extraFee,
          items,
          send_to_customer: true,
        }),
      });
      await loadOrder();
      notify('Orçamento enviado para aprovação do cliente.');
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleLaborExtraDecision(decision: 'approved' | 'rejected') {
    if (!order) return;
    setSaving(true);
    setActionError(null);
    try {
      await apiFetch(`/api/orders/${order.id}/labor-extra-decision`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      });
      await loadOrder();
      notify(
        decision === 'approved'
          ? 'M.O. e taxa extra aprovadas. Repasse atualizado.'
          : 'M.O. e taxa extra recusadas. Não entram no repasse.'
      );
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function captureBrowserGps(): Promise<{ lat?: number; lng?: number; error?: string }> {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      return { error: 'Geolocalização não suportada neste dispositivo.' };
    }
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (err) => resolve({ error: err.message || 'Permissão de localização recusada.' }),
        { enableHighAccuracy: true, timeout: 6000 }
      );
    });
  }

  async function submitOnTheWay(originLat?: number, originLng?: number) {
    if (!order) return;
    setSaving(true);
    setActionError(null);
    try {
      const res = await apiFetch<{ trip: any; etaMinutes?: number; distanceKm?: number }>(
        '/api/mileage/record',
        {
          method: 'POST',
          body: JSON.stringify({
            action: 'on_the_way',
            serviceOrderId: order.id,
            originLat,
            originLng,
          }),
        }
      );
      notify(
        `Deslocação registada (${res.trip.distance_km} km${
          res.etaMinutes ? ` · ETA ~${res.etaMinutes} min` : ''
        }).`
      );
      await loadOrder();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleTechStep(action: 'accept' | 'on_the_way' | 'arrived' | 'complete') {
    if (!order) return;
    if (action === 'complete') {
      const blockers = getCompleteBlockers(order, reportText, items.length);
      if (blockers.length > 0) {
        setActionError(`Não é possível concluir: ${blockers.join(' ')}`);
        return;
      }
    }
    setSaving(true);
    setActionError(null);
    try {
      if (action === 'on_the_way') {
        const gps = await captureBrowserGps();
        if (gps.lat === undefined || gps.lng === undefined) {
          setSaving(false);
          setGpsPrompt({ open: true, mode: 'on_the_way', message: gps.error });
          return;
        }
        await submitOnTheWay(gps.lat, gps.lng);
        return;
      } else {
        const nextStatus =
          action === 'accept'
            ? 'accepted'
            : action === 'arrived'
            ? 'in_progress'
            : 'completed';
        await apiFetch(`/api/orders/${order.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: nextStatus,
            before_photo_note: beforePhoto,
            after_photo_note: afterPhoto,
            report_text: reportText,
          }),
        });
        notify('Estado operacional atualizado.');
      }
      await loadOrder();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateLiveGps() {
    if (!order) return;
    setSaving(true);
    setActionError(null);
    try {
      const gps = await captureBrowserGps();
      if (gps.lat === undefined || gps.lng === undefined) {
        setSaving(false);
        setGpsPrompt({ open: true, mode: 'live_gps', message: gps.error });
        return;
      }
      const res = await apiFetch<{ eta_minutes: number; eta_distance_km: number }>(
        `/api/orders/${order.id}/location`,
        {
          method: 'POST',
          body: JSON.stringify({ lat: gps.lat, lng: gps.lng }),
        }
      );
      notify(`Posição GPS atualizada: ~${res.eta_minutes} min (${res.eta_distance_km} km).`);
      await loadOrder();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleQuoteDecision(decision: 'accepted' | 'rejected') {
    if (!order) return;
    setSaving(true);
    setActionError(null);
    try {
      await apiFetch(`/api/orders/${order.id}/quote-decision`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      });
      setConfirmAction(null);
      await loadOrder();
      notify(
        decision === 'accepted'
          ? 'Orçamento aprovado! Pode proceder ao pagamento.'
          : 'Orçamento recusado. Apenas a taxa de deslocação é aplicável.'
      );
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!order || !chatText.trim()) return;
    try {
      await apiFetch(`/api/orders/${order.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ message: chatText }),
      });
      setChatText('');
      await loadOrder();
    } catch (err: any) {
      setActionError(err.message);
    }
  }

  async function handleGoogleCalendar() {
    if (!order) return;
    const res = await apiFetch<{ eventId: string; calendarUrl: string; syncedVia?: string }>(
      `/api/orders/${order.id}/google-calendar`,
      { method: 'POST' }
    );
    setCalendarLink(res.calendarUrl);
    notify(
      res.syncedVia === 'google_api'
        ? `Evento gravado na Google Agenda (${res.eventId}).`
        : `Agenda preparada (${res.eventId}). Pode abrir o link ou descarregar .ICS.`
    );
    await loadOrder();
  }

  async function handleDownloadIcs() {
    if (!order) return;
    const token = getAuthToken();
    const resp = await fetch(`/api/orders/${order.id}/calendar.ics`, {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!resp.ok) return;
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${order.reference_code}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleVerifyPendingPayment() {
    if (!order) return;
    setSaving(true);
    try {
      const res = await apiFetch<{ checked: number; settled: number }>(
        '/api/payments/verify-pending',
        { method: 'POST', body: JSON.stringify({ serviceOrderId: order.id }) }
      );
      if (res.settled > 0) {
        notify(`${res.settled} pagamento(s) pendente(s) reconciliado(s) com sucesso.`);
        await loadOrder();
      } else {
        notify(
          res.checked === 0
            ? 'Sem sessões Stripe pendentes para esta ordem.'
            : 'Sessão ainda em processamento no Stripe.'
        );
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleRateSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!order) return;
    setSaving(true);
    setActionError(null);
    try {
      await apiFetch(`/api/orders/${order.id}/rate`, {
        method: 'POST',
        body: JSON.stringify({ rating: ratingVal, comment: ratingComment }),
      });
      notify('Obrigado pela sua avaliação!');
      await loadOrder();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleAddReturnVisit(e: React.FormEvent) {
    e.preventDefault();
    if (!order) return;
    setSaving(true);
    try {
      await apiFetch(`/api/orders/${order.id}/return-visits`, {
        method: 'POST',
        body: JSON.stringify({
          scheduled_at: new Date(returnDate).toISOString(),
          notes: returnNotes,
          technician_id: returnTechId || null,
        }),
      });
      setReturnNotes('');
      await loadOrder();
      notify('Visita de retorno / garantia agendada com sucesso.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleReturnVisitStatus(visitId: string, nextStatus: 'completed' | 'cancelled') {
    await apiFetch(`/api/return-visits/${visitId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: nextStatus }),
    });
    await loadOrder();
    notify('Estado da visita de retorno atualizado.');
  }

  async function handleSoftDeleteOrder() {
    if (!order) return;
    await apiFetch(`/api/orders/${order.id}`, { method: 'DELETE' });
    navigate(backRoute);
  }

  async function handleRestoreOrder() {
    if (!order) return;
    await apiFetch(`/api/orders/${order.id}/restore`, { method: 'POST' });
    await loadOrder();
    notify('Ordem restaurada da lixeira.');
  }

  // Live preview of financial engine calculations
  const partsBaseCost = items.reduce((s, i) => s + i.quantity * i.customer_unit_price, 0);
  const partsSupplierCost = items.reduce((s, i) => s + i.quantity * i.supplier_unit_cost, 0);
  const selectedTech = technicians.find((t) => t.id === technicianId);
  const selectedOrg = organizations.find((o) => o.id === providerOrgId);
  const effectivePct =
    selectedTech?.effective_payout_percentage ?? selectedOrg?.custom_payout_percentage ?? 50;
  // A-01: percentual exibido só quando o técnico é conhecido (nunca 50% inventado)
  const shownPayoutPct: number | null =
    user?.role === 'technician'
      ? (user.effective_payout_percentage ?? null)
      : (selectedTech?.effective_payout_percentage ?? null);

  const liveCalc = calculateServiceFinancials({
    serviceFee,
    laborCost,
    extraFee,
    additionalCost,
    partsBaseCost,
    partsSupplierCost,
    vatRate,
    quoteStatus,
    isWarranty,
    legacyPartsMarkup: legacyMarkup,
    legacyPayoutRule,
    fixedPayoutAmount,
    createdAt: order?.created_at,
    customPayoutPercentage: effectivePct,
    payoutLocked: order?.technician_payout_locked,
    payoutOverridden,
    manualTechnicianPayout: manualPayout,
  });

  const componentCharges = order
    ? computeAdditionalChargesSummary({
        serviceFee,
        laborCost,
        extraFee,
        additionalCost,
        partsCustomerTotal: liveCalc.customerPartsTotal,
        vatRate,
        quoteStatus,
        serviceFeePaid: order.service_fee_paid,
        serviceFeePaidAt: order.service_fee_paid_at,
        quotePaid: order.quote_paid,
        laborPaidAt: order.labor_paid_at,
        materialsPaidAt: order.materials_paid_at,
      })
    : null;

  if (loading) {
    return (
      <PortalLayout title="A carregar ordem..." breadcrumb="Ordens de Serviço">
        <div className="space-y-4">
          <div className="h-28 animate-pulse rounded-xl border border-slate-200 bg-white" />
          <div className="h-64 animate-pulse rounded-xl border border-slate-200 bg-white" />
        </div>
      </PortalLayout>
    );
  }

  if (error || !order || !user) {
    return (
      <PortalLayout title="Ordem de Serviço" breadcrumb="Erro">
        <div className="rounded-xl border border-rose-200 bg-white p-6">
          <p className="text-sm text-rose-700">{error || 'Ordem não encontrada.'}</p>
          <button
            type="button"
            onClick={() => navigate(backRoute)}
            className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white"
          >
            Voltar
          </button>
        </div>
      </PortalLayout>
    );
  }

  const isAdmin = user.role === 'super_admin';
  const isTech = user.role === 'technician';
  const isCustomerOrPartner = user.role === 'customer' || user.role === 'partner_requester';
  const canEditCore = isAdmin || (isCustomerOrPartner && order.status === 'pending');
  const executionDuration = formatExecutionDuration(order.tech_arrived_at, order.completed_at);

  // A-11: estados em que o servidor recusa o cancelamento do cliente/parceiro
  const CLIENT_CANCEL_STATUSES = ['pending', 'accepted'];
  const canCancelOrder =
    !isTech &&
    order.status !== 'completed' &&
    order.status !== 'cancelled' &&
    (!isCustomerOrPartner || CLIENT_CANCEL_STATUSES.includes(order.status));
  const cancelBlockedNotice =
    isCustomerOrPartner &&
    order.status !== 'completed' &&
    order.status !== 'cancelled' &&
    !CLIENT_CANCEL_STATUSES.includes(order.status)
      ? 'O cancelamento deixou de estar disponível depois do início do serviço (a caminho, no local, em orçamentação ou aguardando pagamento). Para cancelar, contacte a Confiança.'
      : null;

  const techMissingProfile: string[] = [];
  if (isTech) {
    if (!user.nif?.trim()) techMissingProfile.push('NIF');
    if (!user.iban?.trim()) techMissingProfile.push('IBAN');
    if (!user.emergency_contact?.trim()) techMissingProfile.push('Contacto de Emergência');
  }
  const isTechBlocked = isTech && (Boolean(user.is_paused) || techMissingProfile.length > 0);
  const completeBlockers = getCompleteBlockers(order, reportText, items.length);

  return (
    <PortalLayout
      title={`${order.reference_code} · ${order.service_name}`}
      breadcrumb="Detalhe da Ordem"
      primaryAction={
        <button
          type="button"
          onClick={() => navigate(backRoute)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Voltar</span>
        </button>
      }
    >
      {toast && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          {toast}
        </div>
      )}

      {actionError && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-xs font-semibold underline"
          >
            Fechar
          </button>
        </div>
      )}

      {order.suggestion_status === 'pending' && order.suggested_date && order.suggested_time && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-3.5">
          <div className="flex items-center gap-2.5 text-sm text-amber-900">
            <CalendarClock className="h-4 w-4 text-amber-700 shrink-0" />
            <span>
              <strong>Sugestão de Novo Horário:</strong>{' '}
              <span className="tabular-nums font-semibold">
                {order.suggested_date} às {order.suggested_time}
              </span>
            </span>
          </div>
          {(isCustomerOrPartner || isAdmin) && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => handleSuggestionDecision('accepted')}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
              >
                Aceitar Horário
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => handleSuggestionDecision('rejected')}
                className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50"
              >
                Recusar
              </button>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left 2 Columns: Core Info, Financials & Quote Items */}
        <div className="space-y-6 lg:col-span-2">
          {/* Summary Header Card */}
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="font-mono font-semibold text-slate-900">
                    {order.reference_code}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{order.category}</span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">
                    Agendado: {formatDatePT(order.scheduled_at, true)}
                  </span>
                  {executionDuration && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1 font-medium text-emerald-700 tabular-nums">
                        <Clock className="h-3.5 w-3.5" />
                        Duração execução: {executionDuration}
                      </span>
                    </>
                  )}
                </div>
                <h2 className="mt-1.5 text-lg font-semibold text-slate-900">
                  {order.service_name}
                </h2>
              </div>

              <div className="flex flex-col items-end gap-1.5">
                <ServiceStatusLabel status={order.status} />
                <QuoteStatusLabel status={order.quote_status} />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div>
                <div className="text-xs font-medium text-slate-500">Cliente / Solicitante</div>
                <div className="mt-1 font-medium text-slate-900">{order.customer_name}</div>
                <div className="text-xs text-slate-600">{order.customer_phone || '—'}</div>
                {order.requester_org_name && (
                  <div className="mt-0.5 text-xs text-slate-500">
                    Parceiro: {order.requester_org_name}
                  </div>
                )}
              </div>

              <div>
                <div className="text-xs font-medium text-slate-500">Morada da Intervenção</div>
                <div className="mt-1 text-slate-900">{order.service_address}</div>
                {(order.address_complement || order.postal_code || order.localidade) && (
                  <div className="mt-0.5 text-xs text-slate-600 tabular-nums">
                    {[order.address_complement, order.postal_code, order.localidade]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                )}
                <div className="mt-1 text-xs text-slate-500">
                  Equipa: {order.provider_org_name || 'Confiança'} · Técnico:{' '}
                  {order.technician_name || 'Por atribuir'}
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-lg bg-slate-50 p-3.5 text-sm text-slate-700">
              <span className="block text-xs font-medium text-slate-500">Descrição do Problema</span>
              <p className="mt-1">{order.description || 'Sem observações adicionais.'}</p>
            </div>

            {order.warranty_return_requested_at && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/60 p-3.5 text-xs text-amber-900">
                <div className="flex items-center gap-1.5 font-semibold">
                  <ShieldCheck className="h-4 w-4 text-amber-700" />
                  <span>
                    Garantia Acionada pelo Cliente em{' '}
                    {formatDatePT(order.warranty_return_requested_at, true)}
                  </span>
                </div>
                <p className="mt-1 text-amber-800">{order.warranty_return_description}</p>
              </div>
            )}

            {order.eta_minutes !== null && order.eta_minutes !== undefined && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-900">
                <div className="flex items-center gap-2 font-medium">
                  <MapPin className="h-4 w-4 text-sky-700 shrink-0" />
                  <span>
                    Deslocação em Tempo Real: Chegada prevista em{' '}
                    <strong className="tabular-nums">~{order.eta_minutes} min</strong> (
                    <span className="tabular-nums">
                      {Number(order.eta_distance_km || 0).toFixed(1)} km
                    </span>
                    )
                  </span>
                </div>
                {order.eta_updated_at && (
                  <span className="text-[11px] text-sky-700 tabular-nums">
                    Atualizado: {formatDatePT(order.eta_updated_at, true)}
                  </span>
                )}
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2.5 border-t border-slate-100 pt-4">
              {canEditCore && (
                <button
                  type="button"
                  onClick={() => {
                    setActionError(null);
                    setEditCoreOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  <span>Editar Morada / Agendamento</span>
                </button>
              )}

              {/* A-11: um único botão de cancelamento (POST /api/orders/:id/cancel + ConfirmDialog).
                  Cliente/parceiro só cancelam em pending/accepted (regra do servidor). */}
              {canCancelOrder && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setActionError(null);
                    setConfirmAction('cancel_order');
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                >
                  <XCircle className="h-3.5 w-3.5" />
                  <span>
                    {user.role === 'partner_requester' ? 'Cancelar Chamado' : 'Cancelar Pedido'}
                  </span>
                </button>
              )}
              {cancelBlockedNotice && (
                <p className="w-full text-xs text-slate-500">{cancelBlockedNotice}</p>
              )}

              {(isAdmin || isTech) && (
                <button
                  type="button"
                  onClick={() => {
                    setActionError(null);
                    setSuggestModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <CalendarClock className="h-3.5 w-3.5" />
                  <span>Sugerir Novo Horário</span>
                </button>
              )}

              {isCustomerOrPartner && order.status === 'completed' && (
                <button
                  type="button"
                  onClick={() => setWarrantyModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span>Solicitar Retorno em Garantia</span>
                </button>
              )}

              {(isAdmin || isTech || user.role === 'company_admin') && (
                <>
                  <button
                    type="button"
                    onClick={handleGoogleCalendar}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Calendar className="h-3.5 w-3.5" />
                    <span>
                      {order.google_calendar_event_id
                        ? `Sincronizado (${order.google_calendar_event_id})`
                        : 'Sincronizar Google Agenda'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadIcs}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Ficheiro .ICS</span>
                  </button>

                  {calendarLink && (
                    <a
                      href={calendarLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
                    >
                      <span>Abrir no Google Calendar</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </>
              )}

              {(order.quote_paid || order.service_fee_paid || order.baixa_received_at) && (
                <button
                  type="button"
                  onClick={() => exportCustomerReceiptPDF(order)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <FileText className="h-3.5 w-3.5" />
                  <span>Recibo (PDF)</span>
                </button>
              )}

              {isAdmin && (
                <>
                  {order.status === 'completed' && !order.toc_document_id && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={handleEmitTocInvoice}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      <span>Emitir fatura oficial (TOConline)</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setTocModalOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    <span>Pré-visualizar Fatura TOC Online</span>
                  </button>

                  {!order.quote_paid && (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={handleVerifyPendingPayment}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      <span>Verificar Pagamento Pendente</span>
                    </button>
                  )}

                  {!order.deleted_at && !order.technician_payout_locked && (
                    <button
                      type="button"
                      onClick={() => setConfirmAction('soft_delete')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Mover para Lixeira</span>
                    </button>
                  )}

                  {order.deleted_at && (
                    <button
                      type="button"
                      onClick={handleRestoreOrder}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                    >
                      <span>Restaurar Ordem da Lixeira</span>
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Technician Operational Flow Controls */}
          {isTech && (
            <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    Execução no Terreno
                  </h3>
                  <p className="text-xs text-slate-500">
                    Siga as etapas operacionais; a quilometragem é calculada automaticamente.
                  </p>
                </div>
                <div className="text-right tabular-nums">
                  <div className="text-xs text-slate-500">Seu Ganho Previsto</div>
                  <div className="text-lg font-bold text-emerald-700">
                    {formatEUR(order.technician_payout)}
                  </div>
                </div>
              </div>

              {order.status === 'pending' && isTechBlocked && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
                  {user.is_paused
                    ? 'A sua conta está em pausa. Reative a disponibilidade no Perfil antes de aceitar.'
                    : `Complete no seu perfil (${techMissingProfile.join(', ')}) antes de aceitar este serviço.`}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {order.status === 'pending' && (
                  <button
                    type="button"
                    disabled={saving || isTechBlocked}
                    onClick={() => handleTechStep('accept')}
                    className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    Aceitar Serviço
                  </button>
                )}
                {order.status === 'accepted' && (
                  <>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleTechStep('on_the_way')}
                      className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    >
                      <Navigation className="h-4 w-4" />
                      <span>A Caminho do Cliente (Registar Km)</span>
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => setConfirmAction('release_order')}
                      className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100"
                    >
                      <XCircle className="h-4 w-4" />
                      <span>Devolver ao Mural</span>
                    </button>
                  </>
                )}
                {order.status === 'on_the_way' && (
                  <>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={handleUpdateLiveGps}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <MapPin className="h-4 w-4 text-sky-600" />
                      <span>Atualizar Posição GPS (ETA)</span>
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleTechStep('arrived')}
                      className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
                    >
                      <Wrench className="h-4 w-4" />
                      <span>Cheguei no Local</span>
                    </button>
                  </>
                )}
                {(order.status === 'in_progress' || order.status === 'budgeting') && (
                  <div className="w-full space-y-2">
                    {completeBlockers.length > 0 && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
                        <p className="font-semibold">Para concluir o serviço:</p>
                        <ul className="mt-1 list-disc pl-4">
                          {completeBlockers.map((b) => (
                            <li key={b}>{b}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <button
                      type="button"
                      disabled={saving || completeBlockers.length > 0}
                      onClick={() => handleTechStep('complete')}
                      className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      <span>Concluir Serviço</span>
                    </button>
                  </div>
                )}
              </div>

              {(order.status === 'in_progress' || order.status === 'budgeting' || order.status === 'completed') && (
                <div className="border-t border-slate-100 pt-3 text-xs text-slate-600">
                  Utilize a secção <strong>Fotos Privadas da Intervenção</strong> abaixo para anexar imagens reais de Antes, Durante e Depois.
                </div>
              )}
            </div>
          )}

          {/* Admin Independent States & Financial Editor */}
          {isAdmin && (
            <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-900">
                  Controlo Operacional, Orçamento & Motor Financeiro
                </h3>
                {order.technician_payout_locked && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700">
                    <Lock className="h-3.5 w-3.5" />
                    <span>Repasse Travado (Semana Fechada)</span>
                  </span>
                )}
              </div>

              {/* Independent Status vs Quote Status */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600">
                    Estado Operacional
                  </label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as ServiceStatus)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value="pending">Aguardando</option>
                    <option value="accepted">Aceite</option>
                    <option value="on_the_way">A Caminho</option>
                    <option value="in_progress">No Local / Em Curso</option>
                    <option value="budgeting">Em Orçamentação</option>
                    <option value="payment_pending">Aguardando Pagamento</option>
                    <option value="completed">Concluído</option>
                    <option value="cancelled">Cancelado</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600">
                    Estado do Orçamento
                  </label>
                  <select
                    value={quoteStatus || ''}
                    onChange={(e) =>
                      setQuoteStatus((e.target.value || null) as QuoteStatus)
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Sem Orçamento</option>
                    <option value="sent">Enviado</option>
                    <option value="accepted">Aprovado</option>
                    <option value="rejected">Recusado</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600">
                    Executor (Confiança / Centro)
                  </label>
                  <select
                    value={providerOrgId}
                    onChange={(e) => setProviderOrgId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    {organizations
                      .filter((o) => o.org_type !== 'partner_client')
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name} ({o.custom_payout_percentage}%)
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600">
                    Técnico Atribuído
                  </label>
                  <select
                    value={technicianId}
                    onChange={(e) => setTechnicianId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Por atribuir</option>
                    {technicians.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.full_name} ({t.effective_payout_percentage}%)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Financial Inputs */}
              <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-5">
                <div>
                  <label className="block text-xs font-medium text-slate-600">
                    Taxa Serviço (€)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={serviceFee}
                    onChange={(e) => setServiceFee(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600">
                    Mão de Obra (€)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={laborCost}
                    onChange={(e) => setLaborCost(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600">
                    Taxa Extra (€)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={extraFee}
                    onChange={(e) => setExtraFee(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600">
                    Adicional 100% Emp. (€)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={additionalCost}
                    onChange={(e) => setAdditionalCost(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600">
                    IVA Portugal (%)
                  </label>
                  <select
                    value={vatRate}
                    onChange={(e) => setVatRate(Number(e.target.value) === 6 ? 6 : 23)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm tabular-nums"
                  >
                    <option value={6}>6% (Taxa Reduzida)</option>
                    <option value={23}>23% (Taxa Normal)</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-6 text-xs text-slate-700">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isWarranty}
                    onChange={(e) => setIsWarranty(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span>Atendimento em Garantia (zera Taxa Extra no repasse)</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={legacyMarkup}
                    onChange={(e) => setLegacyMarkup(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span>Markup Legado Berens ×1.30 (&lt; 15/06/2026)</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={legacyPayoutRule}
                    onChange={(e) => setLegacyPayoutRule(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span>Regra Temporal Histórica (&lt; 01/08/2026: Fixo + 70% MO)</span>
                </label>

                {legacyPayoutRule && (
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">Fixo Taxa (€):</span>
                    <input
                      type="number"
                      step="0.01"
                      value={fixedPayoutAmount}
                      onChange={(e) => setFixedPayoutAmount(Number(e.target.value))}
                      className="w-24 rounded-lg border border-slate-200 px-2.5 py-1 text-sm tabular-nums"
                    />
                  </div>
                )}

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={order.technician_payout_locked}
                    checked={payoutOverridden}
                    onChange={(e) => setPayoutOverridden(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span>Sobrescrever Repasse Manualmente</span>
                </label>

                {payoutOverridden && (
                  <input
                    type="number"
                    step="0.01"
                    disabled={order.technician_payout_locked}
                    value={manualPayout}
                    onChange={(e) => setManualPayout(Number(e.target.value))}
                    className="w-28 rounded-lg border border-slate-200 px-2.5 py-1 text-sm tabular-nums"
                  />
                )}
              </div>

              {/* Admin Invoicing & Baixa Card */}
              <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                      <Receipt className="h-3.5 w-3.5 text-slate-600" />
                      Faturação Oficial
                    </span>
                    <span className="text-[11px] font-medium text-slate-500">
                      {order.invoice_number ? `Emitida (${order.invoice_number})` : 'Por emitir'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={invoiceNumber}
                      onChange={(e) => setInvoiceNumber(e.target.value)}
                      placeholder="Ex: FT 2026/001"
                      className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                    />
                    <input
                      type="date"
                      value={invoiceIssuedAt}
                      onChange={(e) => setInvoiceIssuedAt(e.target.value)}
                      className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs tabular-nums"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleSaveInvoice(false)}
                      className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                    >
                      Gravar Fatura
                    </button>
                    {order.invoice_number && (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => handleSaveInvoice(true)}
                        className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                      >
                        Limpar
                      </button>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-800">
                      Baixa / Recebimento Bancário
                    </span>
                    <span
                      className={`text-[11px] font-semibold ${
                        order.baixa_received_at ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      {order.baixa_received_at
                        ? `Baixada em ${order.baixa_received_at}`
                        : 'Em aberto'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={baixaDate}
                      onChange={(e) => setBaixaDate(e.target.value)}
                      className="flex-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs tabular-nums"
                    />
                    {order.baixa_received_at ? (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => handleSaveBaixa(true)}
                        className="rounded-md border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50"
                      >
                        Estornar Baixa
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => handleSaveBaixa(false)}
                        className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                      >
                        Dar Baixa
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Technical Report Section */}
          {(isAdmin || isTech || user.role === 'company_admin' || Boolean(order.report_text)) && (
            <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    Relatório Técnico da Intervenção
                  </h3>
                  <p className="text-xs text-slate-500">
                    Diagnóstico técnico, trabalhos efetuados e recomendações ao cliente.
                  </p>
                </div>
                {(isAdmin || isTech || user.role === 'company_admin') && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={handleSaveReport}
                    className="rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    Guardar Relatório
                  </button>
                )}
              </div>

              {isAdmin || isTech || user.role === 'company_admin' ? (
                <textarea
                  rows={3}
                  value={reportText}
                  onChange={(e) => setReportText(e.target.value)}
                  placeholder="Descreva o diagnóstico técnico, testes realizados e estado final da instalação..."
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800"
                />
              ) : (
                <div className="rounded-lg bg-slate-50 p-3.5 text-sm text-slate-700 whitespace-pre-line">
                  {order.report_text}
                </div>
              )}
            </div>
          )}

          {/* Materials & Parts Section (Admin & Tech can edit; Customer/Partner see read-only) */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Peças, Materiais & Orçamento
                </h3>
                <p className="text-xs text-slate-500">
                  {isAdmin
                    ? 'Fornecedor é opcional. Peças com fornecedor e orçamento aprovado alimentam a previsão de pagamentos.'
                    : 'Detalhamento de peças e mão de obra aplicada ao serviço.'}
                </p>
              </div>
              {(isAdmin || (isTech && !order.technician_payout_locked)) && (
                <button
                  type="button"
                  onClick={() =>
                    setItems((prev) => [
                      ...prev,
                      {
                        description: '',
                        quantity: 1,
                        customer_unit_price: 0,
                        supplier_unit_cost: 0,
                        supplier_id: '',
                      },
                    ])
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Adicionar Peça</span>
                </button>
              )}
            </div>

            {/* C-11: estado pendente de M.O./taxa extra do técnico */}
            {(() => {
              const pending = order as (ServiceOrder & LaborExtraPendingFields) | null;
              const pendingLabor = pending?.pending_labor_cost ?? null;
              const pendingExtra = pending?.pending_extra_fee ?? null;
              if (pendingLabor == null && pendingExtra == null) return null;
              const canDecide = isAdmin || user.role === 'company_admin';
              return (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-3">
                  <p className="text-xs text-amber-900">
                    Lançamento do técnico:{' '}
                    {pendingLabor != null && <span className="font-semibold tabular-nums">M.O. {formatEUR(pendingLabor)}</span>}
                    {pendingLabor != null && pendingExtra != null && ' · '}
                    {pendingExtra != null && <span className="font-semibold tabular-nums">Taxa extra {formatEUR(pendingExtra)}</span>}
                    {' — '}
                    <span className="font-semibold">aguardando aprovação da gestão</span>. Só entra no repasse após aprovação.
                  </p>
                  {canDecide && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => handleLaborExtraDecision('approved')}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Aprovar</span>
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => handleLaborExtraDecision('rejected')}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        <span>Recusar</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}

            {(isAdmin || isTech) && !order.technician_payout_locked ? (
              <div className="space-y-3">
                {isTech && (
                  <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600">
                        Mão de Obra (€)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={laborCost}
                        onChange={(e) => setLaborCost(Number(e.target.value))}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600">
                        Taxa Extra (€)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={extraFee}
                        onChange={(e) => setExtraFee(Number(e.target.value))}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm tabular-nums"
                      />
                    </div>
                  </div>
                )}

                {items.length === 0 ? (
                  <p className="text-xs text-slate-500">Nenhuma peça adicionada a este orçamento.</p>
                ) : (
                  <div className="space-y-2">
                    {items.map((item, idx) => (
                      <div
                        key={idx}
                        className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-12 sm:items-center"
                      >
                        <input
                          type="text"
                          placeholder="Descrição da peça"
                          value={item.description}
                          onChange={(e) =>
                            setItems((prev) =>
                              prev.map((it, i) =>
                                i === idx ? { ...it, description: e.target.value } : it
                              )
                            )
                          }
                          className="sm:col-span-4 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs"
                        />
                        <input
                          type="number"
                          min="1"
                          placeholder="Qtd"
                          value={item.quantity}
                          onChange={(e) =>
                            setItems((prev) =>
                              prev.map((it, i) =>
                                i === idx ? { ...it, quantity: Number(e.target.value) } : it
                              )
                            )
                          }
                          className="sm:col-span-1 rounded-md border border-slate-200 px-2 py-1.5 text-xs tabular-nums"
                        />
                        <div className="sm:col-span-2">
                          <input
                            type="number"
                            step="0.01"
                            placeholder="Preço Cliente €"
                            value={item.customer_unit_price}
                            onChange={(e) =>
                              setItems((prev) =>
                                prev.map((it, i) =>
                                  i === idx
                                    ? { ...it, customer_unit_price: Number(e.target.value) }
                                    : it
                                )
                              )
                            }
                            className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs tabular-nums"
                          />
                        </div>
                        {isAdmin && (
                          <div className="sm:col-span-2">
                            <input
                              type="number"
                              step="0.01"
                              placeholder="Custo Forn. €"
                              value={item.supplier_unit_cost}
                              onChange={(e) =>
                                setItems((prev) =>
                                  prev.map((it, i) =>
                                    i === idx
                                      ? { ...it, supplier_unit_cost: Number(e.target.value) }
                                      : it
                                  )
                                )
                              }
                              className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs tabular-nums"
                            />
                          </div>
                        )}
                        <select
                          value={item.supplier_id}
                          onChange={(e) =>
                            setItems((prev) =>
                              prev.map((it, i) =>
                                i === idx ? { ...it, supplier_id: e.target.value } : it
                              )
                            )
                          }
                          className="sm:col-span-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
                        >
                          <option value="">Sem fornecedor (Técnico)</option>
                          {suppliers.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() =>
                            setItems((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="sm:col-span-1 flex justify-end text-slate-400 hover:text-rose-600"
                          aria-label="Remover peça"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex justify-end pt-2">
                  {isAdmin ? (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={handleAdminSave}
                      className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      {saving ? 'A guardar...' : 'Guardar Alterações & Recalcular'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={handleTechSaveQuote}
                      className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      {saving ? 'A enviar...' : 'Enviar Orçamento ao Cliente'}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 text-sm">
                {(order.items || []).length === 0 ? (
                  <p className="text-xs text-slate-500">Sem peças registadas neste serviço.</p>
                ) : (
                  (order.items || []).map((item) => (
                    <div key={item.id} className="flex items-center justify-between py-2.5">
                      <div>
                        <div className="font-medium text-slate-900">{item.description}</div>
                        <div className="text-xs text-slate-500">Qtd: {item.quantity}</div>
                      </div>
                      <div className="font-medium text-slate-900 tabular-nums">
                        {formatEUR(Number(item.quantity) * Number(item.customer_unit_price))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Customer / Partner Quote Approval & Stripe Payment */}
            {isCustomerOrPartner && (
              <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
                {order.quote_status === 'sent' && (
                  <>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleQuoteDecision('accepted')}
                      className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      <span>Aprovar Orçamento</span>
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => setConfirmAction('reject_quote')}
                      className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100"
                    >
                      <XCircle className="h-4 w-4" />
                      <span>Recusar Orçamento</span>
                    </button>
                  </>
                )}

                {!order.quote_paid && order.quote_status !== 'rejected' && order.total_customer_amount > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setCheckoutModal({
                          open: true,
                          paymentType: order.service_fee_paid ? 'quote_total' : 'full',
                        })
                      }
                      className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                    >
                      <CreditCard className="h-4 w-4" />
                      <span>Pagar Online (Stripe / MB Way / Multibanco)</span>
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={handleVerifyPendingPayment}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      <span>Verificar Pagamento Pendente</span>
                    </button>
                  </>
                )}

                {order.quote_paid && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Pagamento Total Liquidado</span>
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Customer & Partner Rating Card (only when completed) */}
          {isCustomerOrPartner && order.status === 'completed' && (
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-base font-semibold text-slate-900">
                Avaliação do Atendimento
              </h3>
              {order.rating ? (
                <div className="mt-3 space-y-1 text-sm">
                  <div className="flex items-center gap-1 text-amber-500">
                    {Array.from({ length: order.rating }).map((_, i) => (
                      <Star key={i} className="h-4 w-4 fill-amber-400" />
                    ))}
                  </div>
                  <p className="text-slate-700">{order.rating_comment || 'Sem comentário.'}</p>
                </div>
              ) : (
                <form onSubmit={handleRateSubmit} className="mt-3 space-y-3">
                  <div className="flex items-center gap-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setRatingVal(star)}
                        className="p-1"
                        aria-label={`${star} estrelas`}
                      >
                        <Star
                          className={`h-5 w-5 ${
                            star <= ratingVal ? 'fill-amber-400 text-amber-500' : 'text-slate-300'
                          }`}
                        />
                      </button>
                    ))}
                  </div>
                  <textarea
                    rows={2}
                    value={ratingComment}
                    onChange={(e) => setRatingComment(e.target.value)}
                    placeholder="Deixe um comentário sobre o técnico..."
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                  <button
                    type="submit"
                    className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white"
                  >
                    Enviar Avaliação
                  </button>
                </form>
              )}
            </div>
          )}

          {/* Private Photo Upload & Gallery (Fase 2.1) */}
          <PrivatePhotoGallery
            orderId={order.id}
            photos={order.photos || []}
            canUpload={isAdmin || isTech || user.role === 'company_admin' || user.role === 'customer'}
            canDeleteAny={isAdmin}
            currentUserId={user.id}
            onChanged={loadOrder}
          />

          {/* Warranty Return Visits (Fase 2.2) */}
          {(isAdmin || isTech || user.role === 'company_admin' || (order.return_visits || []).length > 0) && (
            <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">
                    Visitas de Retorno & Garantia ({(order.return_visits || []).length})
                  </h3>
                  <p className="text-xs text-slate-500">
                    Retornos associados aparecem automaticamente na Agenda Mensal em Grade.
                  </p>
                </div>
              </div>

              {(order.return_visits || []).length === 0 ? (
                <p className="text-xs text-slate-500">Nenhuma visita de retorno agendada.</p>
              ) : (
                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {(order.return_visits || []).map((rv) => {
                    const hoursUntil =
                      (new Date(rv.scheduled_at).getTime() - Date.now()) / 3600000;
                    const canCustomerReschedule =
                      isCustomerOrPartner && rv.status === 'scheduled' && hoursUntil > 24;

                    return (
                      <div
                        key={rv.id}
                        className="flex flex-wrap items-center justify-between gap-3 p-3.5 text-xs"
                      >
                        <div>
                          <div className="font-semibold text-slate-900 tabular-nums">
                            {formatDatePT(rv.scheduled_at, true)}
                          </div>
                          <div className="text-slate-600">{rv.notes || 'Visita de verificação'}</div>
                          <div className="text-[11px] text-slate-400">
                            Técnico: {rv.technician_name || 'Por atribuir'} · Estado:{' '}
                            <span className="font-medium text-slate-700">
                              {rv.status === 'completed'
                                ? 'Concluída'
                                : rv.status === 'cancelled'
                                ? 'Cancelada'
                                : 'Agendada'}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {isCustomerOrPartner && rv.status === 'scheduled' && (
                            canCustomerReschedule ? (
                              <button
                                type="button"
                                onClick={() => {
                                  const dt = new Date(rv.scheduled_at);
                                  setRescheduleVisitId(rv.id);
                                  setRescheduleDateTime(
                                    new Date(dt.getTime() - dt.getTimezoneOffset() * 60000)
                                      .toISOString()
                                      .slice(0, 16)
                                  );
                                  setRescheduleNotes(rv.notes || '');
                                }}
                                className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                              >
                                Reagendar (&gt;24h)
                              </button>
                            ) : (
                              <span className="text-[11px] text-slate-400">
                                Reagendamento indisponível (&lt;24h)
                              </span>
                            )
                          )}

                          {(isAdmin || isTech || user.role === 'company_admin') &&
                            rv.status === 'scheduled' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleReturnVisitStatus(rv.id, 'completed')}
                                  className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                                >
                                  Concluir
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleReturnVisitStatus(rv.id, 'cancelled')}
                                  className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                                >
                                  Cancelar
                                </button>
                              </>
                            )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {(isAdmin || isTech || user.role === 'company_admin') && (
                <form
                  onSubmit={handleAddReturnVisit}
                  className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-12 sm:items-end"
                >
                  <div className="sm:col-span-4">
                    <label className="block text-[11px] font-medium text-slate-600">
                      Data/Hora Retorno
                    </label>
                    <input
                      type="datetime-local"
                      required
                      value={returnDate}
                      onChange={(e) => setReturnDate(e.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                    />
                  </div>
                  <div className="sm:col-span-5">
                    <label className="block text-[11px] font-medium text-slate-600">
                      Motivo / Observação
                    </label>
                    <input
                      type="text"
                      value={returnNotes}
                      onChange={(e) => setReturnNotes(e.target.value)}
                      placeholder="Ex: Teste pressão após 48h"
                      className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <button
                      type="submit"
                      disabled={saving}
                      className="w-full rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
                    >
                      Agendar Retorno
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Financial Summary & Real-time Internal Chat */}
        <div className="space-y-6">
          {/* Financial Breakdown */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-3">
            <h3 className="text-base font-semibold text-slate-900">Resumo Financeiro</h3>
            <div className="space-y-2 text-sm tabular-nums">
              <div className="flex justify-between text-slate-600">
                <span>Taxa de Serviço</span>
                <span>{formatEUR(serviceFee)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Mão de Obra</span>
                <span>{formatEUR(quoteStatus === 'rejected' ? 0 : laborCost)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Taxa Extra</span>
                <span>{formatEUR(quoteStatus === 'rejected' ? 0 : extraFee)}</span>
              </div>
              {additionalCost > 0 && (
                <div className="flex justify-between text-slate-600">
                  <span>Adicional</span>
                  <span>{formatEUR(quoteStatus === 'rejected' ? 0 : additionalCost)}</span>
                </div>
              )}
              <div className="flex justify-between text-slate-600">
                <span>Peças / Materiais</span>
                <span>{formatEUR(liveCalc.customerPartsTotal)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-100 pt-2 text-slate-700">
                <span>Subtotal (s/ IVA)</span>
                <span>{formatEUR(liveCalc.subtotalWithoutVat)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>IVA ({vatRate}%)</span>
                <span>{formatEUR(liveCalc.vatAmount)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold text-slate-900">
                <span>Total Cliente</span>
                <span>{formatEUR(liveCalc.totalCustomerAmount)}</span>
              </div>
            </div>

            {(isAdmin || isTech || user.role === 'company_admin') && (
              <div className="mt-4 space-y-1.5 border-t border-slate-100 pt-3 text-xs tabular-nums">
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>Regra Motor</span>
                  <span>
                    {liveCalc.ruleVersion === 'legacy_pre_2026_08'
                      ? 'Histórica (< 01/08/2026)'
                      : 'Vigente (>= 01/08/2026)'}
                  </span>
                </div>
                <div className="flex justify-between font-medium text-emerald-700">
                  <span>
                    Repasse Técnico{shownPayoutPct !== null ? ` (${shownPayoutPct}%)` : ''}
                  </span>
                  <span>
                    {formatEUR(isTech ? order.technician_payout : liveCalc.technicianPayout)}
                  </span>
                </div>
                {isAdmin && (
                  <>
                    <div className="flex justify-between text-slate-500">
                      <span>Custo Fornecedores</span>
                      <span>{formatEUR(partsSupplierCost)}</span>
                    </div>
                    <div className="flex justify-between font-semibold text-slate-900">
                      <span>Margem Bruta Confiança</span>
                      <span>{formatEUR(liveCalc.companyGrossMargin)}</span>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Anti-duplication Component Payment Breakdown */}
            {componentCharges && componentCharges.components.length > 0 && (
              <div className="mt-4 space-y-2 border-t border-slate-100 pt-3 text-xs">
                <div className="font-semibold text-slate-700">
                  Controlo por Componente (Anti-duplicação)
                </div>
                {componentCharges.components.map((comp) => (
                  <div
                    key={comp.id}
                    className="flex items-center justify-between gap-2 text-slate-600 tabular-nums"
                  >
                    <span className="truncate">{comp.label}</span>
                    <span className="shrink-0 font-medium">
                      {formatEUR(comp.amountWithVat)} ·{' '}
                      <span className={comp.paid ? 'text-emerald-700' : 'text-amber-700'}>
                        {comp.paid ? 'Pago' : 'Pendente'}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Internal Chat */}
          <div className="flex h-[420px] flex-col rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Chat do Chamado</h3>
                <p className="text-xs text-slate-500">Cliente · Técnico · Gestão Confiança</p>
              </div>
              <span
                className={`text-[11px] font-medium ${
                  wsConnected ? 'text-emerald-700' : 'text-slate-400'
                }`}
              >
                {wsConnected ? 'Tempo real ativo' : 'A ligar...'}
              </span>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {(order.messages || []).length === 0 ? (
                <p className="text-center text-xs text-slate-400 py-8">
                  Nenhuma mensagem registada neste chamado.
                </p>
              ) : (
                (order.messages || []).map((m) => {
                  const mine = m.sender_id === user.id;
                  return (
                    <div
                      key={m.id}
                      className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}
                    >
                      <span className="mb-1 text-[11px] text-slate-500">
                        {m.sender_name} · {formatDatePT(m.created_at, true)}
                      </span>
                      <div
                        className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                          mine
                            ? 'bg-slate-900 text-white'
                            : 'border border-slate-200 bg-slate-50 text-slate-800'
                        }`}
                      >
                        {m.message}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <form
              onSubmit={handleSendMessage}
              className="flex items-center gap-2 border-t border-slate-200 p-3"
            >
              <input
                type="text"
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                placeholder="Escrever mensagem..."
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-slate-400 focus:outline-none"
              />
              <button
                type="submit"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white hover:bg-slate-800"
                aria-label="Enviar"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Stripe Checkout Modal */}
      <StripeCheckoutModal
        isOpen={checkoutModal.open}
        onClose={() => setCheckoutModal((p) => ({ ...p, open: false }))}
        serviceOrderId={order.id}
        paymentType={checkoutModal.paymentType}
        onSuccess={loadOrder}
      />

      {/* Core Metadata / Address Edit Modal (Admin or Pending Partner) */}
      {editCoreOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form
            onSubmit={handleCoreSave}
            className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-semibold text-slate-900">
                Editar Dados & Morada · {order.reference_code}
              </h3>
              <button
                type="button"
                onClick={() => setEditCoreOpen(false)}
                className="text-xs text-slate-500 hover:text-slate-900"
              >
                Fechar
              </button>
            </div>

            {actionError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
                {actionError}
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-700">Cliente / Contacto</label>
                <input
                  type="text"
                  required
                  value={editCustomerName}
                  onChange={(e) => setEditCustomerName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Telemóvel</label>
                <input
                  type="text"
                  value={editCustomerPhone}
                  onChange={(e) => setEditCustomerPhone(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <ApplianceNifFields
                appliance={editAppliance}
                onApplianceChange={setEditAppliance}
                nif={editCustomerNif}
                onNifChange={setEditCustomerNif}
              />
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700">Morada Principal</label>
                <input
                  type="text"
                  required
                  value={editServiceAddress}
                  onChange={(e) => setEditServiceAddress(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Complemento / Andar</label>
                <input
                  type="text"
                  value={editAddressComplement}
                  onChange={(e) => setEditAddressComplement(e.target.value)}
                  placeholder="Ex: 3º Esq / Fração B"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Cód. Postal</label>
                  <input
                    type="text"
                    value={editPostalCode}
                    onChange={(e) => setEditPostalCode(e.target.value)}
                    placeholder="2855-000"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Localidade</label>
                  <input
                    type="text"
                    value={editLocalidade}
                    onChange={(e) => setEditLocalidade(e.target.value)}
                    placeholder="Corroios"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Agendamento</label>
                <input
                  type="datetime-local"
                  required
                  value={editScheduledAt}
                  onChange={(e) => setEditScheduledAt(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Urgência</label>
                <select
                  value={editUrgency}
                  onChange={(e) => setEditUrgency(e.target.value as 'normal' | 'urgent')}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="normal">Normal (Agendado)</option>
                  <option value="urgent">Urgente (24h)</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700">Descrição</label>
                <textarea
                  rows={3}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => setEditCoreOpen(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
              >
                {saving ? 'A guardar...' : 'Guardar Alterações'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Suggest New Schedule Modal */}
      {suggestModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form
            onSubmit={handleSuggestSchedule}
            className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-xl space-y-4"
          >
            <h3 className="text-base font-semibold text-slate-900">Sugerir Novo Horário ao Cliente</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700">Data Sugerida</label>
                <input
                  type="date"
                  required
                  value={suggestDate}
                  onChange={(e) => setSuggestDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Hora Sugerida</label>
                <input
                  type="time"
                  required
                  value={suggestTime}
                  onChange={(e) => setSuggestTime(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSuggestModalOpen(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
              >
                Enviar Sugestão
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Customer Warranty Return Request Modal */}
      {warrantyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form
            onSubmit={handleWarrantyRequest}
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl space-y-4"
          >
            <h3 className="text-base font-semibold text-slate-900">
              Solicitar Retorno em Garantia
            </h3>
            <p className="text-xs text-slate-500">
              Todos os serviços incluem garantia de 6 meses sobre a intervenção realizada.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Descreva o ocorrido
                </label>
                <textarea
                  rows={3}
                  required
                  value={warrantyDescription}
                  onChange={(e) => setWarrantyDescription(e.target.value)}
                  placeholder="Explique o sintoma encontrado após o serviço..."
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Data/Hora Preferencial (Opcional)
                </label>
                <input
                  type="datetime-local"
                  value={warrantyPreferredDate}
                  onChange={(e) => setWarrantyPreferredDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setWarrantyModalOpen(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-medium text-white hover:bg-amber-700"
              >
                Enviar Pedido de Garantia
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Customer Return Visit Reschedule Modal (>24h) */}
      {rescheduleVisitId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form
            onSubmit={handleRescheduleReturnVisit}
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl space-y-4"
          >
            <h3 className="text-base font-semibold text-slate-900">
              Reagendar Visita de Retorno
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700">Nova Data e Hora</label>
                <input
                  type="datetime-local"
                  required
                  value={rescheduleDateTime}
                  onChange={(e) => setRescheduleDateTime(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Observação (Opcional)
                </label>
                <input
                  type="text"
                  value={rescheduleNotes}
                  onChange={(e) => setRescheduleNotes(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRescheduleVisitId(null)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
              >
                Confirmar Reagendamento
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TOC Online Invoice Preview Modal (Fase 2) */}
      {tocModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-semibold text-slate-900">
                Pré-emissão Fiscal · TOC Online (Portugal)
              </h3>
              <button
                type="button"
                onClick={() => setTocModalOpen(false)}
                className="text-xs text-slate-500 hover:text-slate-900"
              >
                Fechar
              </button>
            </div>
            <div className="space-y-2 text-xs text-slate-700 tabular-nums">
              <div>
                <strong>Emitente:</strong> Confiança e Versatilidade Unipessoal Lda (NIF 518646696)
              </div>
              <div>
                <strong>Cliente:</strong> {order.customer_name}
              </div>
              <div>
                <strong>Documento:</strong>{' '}
                {order.invoice_number
                  ? `Fatura ${order.invoice_number} (${order.invoice_issued_at || ''})`
                  : `Fatura-Recibo (Série 2026) · Ref. ${order.reference_code}`}
              </div>
              <div>
                <strong>Incidência IVA ({order.vat_rate}%):</strong>{' '}
                {formatEUR(order.subtotal_without_vat)} + IVA {formatEUR(order.vat_amount)} ={' '}
                <strong>{formatEUR(order.total_customer_amount)}</strong>
              </div>
            </div>
            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              Integração TOC Online preparada para emissão automática pós-liquidação Stripe na Fase 2.
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white"
              >
                Imprimir Comprovativo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialogs (Soft Delete, Reject Quote, Cancel Pending, Release Order) */}
      <ConfirmDialog
        open={confirmAction !== null}
        variant="danger"
        loading={saving}
        title={
          confirmAction === 'soft_delete'
            ? 'Mover ordem para a lixeira?'
            : confirmAction === 'reject_quote'
            ? 'Recusar este orçamento?'
            : confirmAction === 'release_order'
            ? 'Devolver serviço ao mural?'
            : 'Cancelar esta ordem?'
        }
        description={
          confirmAction === 'soft_delete'
            ? `A ordem ${order.reference_code} será movida para a lixeira e poderá ser restaurada posteriormente.`
            : confirmAction === 'reject_quote'
            ? 'Ao recusar o orçamento, mão de obra e peças serão zeradas, mantendo-se apenas a taxa de deslocação/diagnóstico.'
            : confirmAction === 'release_order'
            ? `A ordem ${order.reference_code} voltará para o mural disponível para outro técnico aceitar e a gestão será notificada.`
            : `A ordem ${order.reference_code} será marcada como cancelada. Esta ação não pode ser desfeita.`
        }
        confirmLabel={
          confirmAction === 'soft_delete'
            ? 'Mover para Lixeira'
            : confirmAction === 'reject_quote'
            ? 'Confirmar Recusa'
            : confirmAction === 'release_order'
            ? 'Devolver ao Mural'
            : confirmAction === 'cancel_order'
            ? 'Confirmar Cancelamento'
            : 'Cancelar Pedido'
        }
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => {
          if (confirmAction === 'soft_delete') void handleSoftDeleteOrder();
          else if (confirmAction === 'reject_quote') void handleQuoteDecision('rejected');
          else if (confirmAction === 'cancel_order') void handleCancelOrder();
          else if (confirmAction === 'release_order') void handleReleaseOrder();
        }}
      />

      {/* Guided GPS Permission Prompt */}
      <GpsPermissionPrompt
        open={gpsPrompt.open}
        errorMessage={gpsPrompt.message}
        onClose={() => setGpsPrompt((p) => ({ ...p, open: false }))}
        onRetry={async () => {
          const mode = gpsPrompt.mode;
          setGpsPrompt((p) => ({ ...p, open: false }));
          if (mode === 'on_the_way') await handleTechStep('on_the_way');
          else await handleUpdateLiveGps();
        }}
        onUseFallback={async () => {
          const mode = gpsPrompt.mode;
          setGpsPrompt((p) => ({ ...p, open: false }));
          if (mode === 'on_the_way') {
            await submitOnTheWay();
          } else {
            notify('Posição mantida pelo endereço base regional.');
          }
        }}
      />
    </PortalLayout>
  );
}
