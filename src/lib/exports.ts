import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { CONFIANCA_COMPANY } from '../core/constants/company';
import type {
  CashFlowEntry,
  MileageTrip,
  ServiceOrder,
  WeeklyPayoutGroup,
} from '../types/domain';

function fmtEur(n: unknown): string {
  const num = Number(n || 0);
  return `€ ${num.toFixed(2).replace('.', ',')}`;
}

function fmtDate(iso?: string | null, withTime = false): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return withTime
    ? d.toLocaleString('pt-PT', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : d.toLocaleDateString('pt-PT', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
}

// Logo oficial (public/logo-confianca.png), carregado uma vez ao abrir a aplicação.
// Se ainda não tiver carregado quando o PDF for gerado, o PDF sai sem logo.
let cachedLogoDataUrl: string | null = null;
// Reduz o logo a 400 px e grava em JPEG sobre fundo branco (PDF leve).
async function loadLogo(): Promise<void> {
  try {
    const res = await fetch('/logo-confianca.png');
    if (!res.ok) return;
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    const scale = 400 / bitmap.width;
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    cachedLogoDataUrl = canvas.toDataURL('image/jpeg', 0.92);
  } catch {
    // Sem logo: os PDFs continuam a ser gerados sem ele.
  }
}
void loadLogo();

function addConfiançaHeader(doc: jsPDF, title: string, subtitle: string) {
  const width = doc.internal.pageSize.getWidth();
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, width, 30, 'F');
  if (cachedLogoDataUrl) {
    // Logo 800×490 px → 26 mm × 16 mm
    doc.addImage(cachedLogoDataUrl, 'JPEG', 14, 5, 26, 16);
  }
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('CONFIANÇA REPARA', 46, 11);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text(
    `${CONFIANCA_COMPANY.legalName} · NIF ${CONFIANCA_COMPANY.nif}`,
    46,
    16
  );
  doc.text(CONFIANCA_COMPANY.fullAddress, 46, 20.5);
  doc.setDrawColor(176, 141, 87);
  doc.setLineWidth(0.6);
  doc.line(14, 27, width - 14, 27);

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(title, 14, 38);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(subtitle, 14, 44);
}

export function adjustmentLabel(kind?: string | null): string {
  return kind === 'reembolso' ? 'Reembolso' : kind === 'desconto' ? 'Desconto' : 'Ajuste';
}

// ---------------------------------------------------------------------------
// 1. GENERAL SERVICES REPORT (CONFIGURABLE COLUMNS + SCOPE)
// ---------------------------------------------------------------------------
export interface GeneralOrderColumnDef {
  key: string;
  label: string;
  getValue: (o: ServiceOrder) => string | number;
}

export const GENERAL_ORDER_COLUMNS: GeneralOrderColumnDef[] = [
  { key: 'reference_code', label: 'Ref.', getValue: (o) => o.reference_code },
  { key: 'scheduled_at', label: 'Data Agendada', getValue: (o) => fmtDate(o.scheduled_at, true) },
  { key: 'service_name', label: 'Serviço', getValue: (o) => o.service_name },
  { key: 'category', label: 'Categoria', getValue: (o) => o.category },
  { key: 'customer_name', label: 'Cliente / Solicitante', getValue: (o) => o.customer_name },
  { key: 'requester_org_name', label: 'Parceiro B2B', getValue: (o) => o.requester_org_name || 'Particular' },
  { key: 'technician_name', label: 'Técnico', getValue: (o) => o.technician_name || 'Por atribuir' },
  { key: 'service_address', label: 'Morada', getValue: (o) => o.service_address },
  { key: 'status', label: 'Estado OS', getValue: (o) => o.status },
  { key: 'quote_status', label: 'Orçamento', getValue: (o) => o.quote_status || '—' },
  { key: 'subtotal_without_vat', label: 'Subtotal s/ IVA', getValue: (o) => Number(o.subtotal_without_vat).toFixed(2) },
  { key: 'vat_amount', label: 'IVA', getValue: (o) => `${Number(o.vat_amount).toFixed(2)} (${o.vat_rate}%)` },
  { key: 'total_customer_amount', label: 'Total Cliente (€)', getValue: (o) => Number(o.total_customer_amount).toFixed(2) },
  { key: 'technician_payout', label: 'Repasse Técnico (€)', getValue: (o) => Number(o.technician_payout ?? 0).toFixed(2) },
  { key: 'company_gross_margin', label: 'Margem Empresa (€)', getValue: (o) => Number(o.company_gross_margin ?? 0).toFixed(2) },
  { key: 'quote_paid', label: 'Liquidado', getValue: (o) => (o.quote_paid ? 'Sim' : 'Pendente') },
];

export function exportGeneralOrdersPDF(
  orders: ServiceOrder[],
  selectedKeys: string[],
  scopeLabel: string
) {
  const cols = GENERAL_ORDER_COLUMNS.filter((c) => selectedKeys.includes(c.key));
  const doc = new jsPDF({ orientation: cols.length > 6 ? 'landscape' : 'portrait' });
  addConfiançaHeader(
    doc,
    `Relatório Geral de Serviços (${scopeLabel})`,
    `Gerado em ${fmtDate(new Date().toISOString(), true)} · ${orders.length} ordens de serviço`
  );

  autoTable(doc, {
    startY: 48,
    head: [cols.map((c) => c.label)],
    body: orders.map((o) => cols.map((c) => String(c.getValue(o)))),
    styles: { fontSize: 7.5, cellPadding: 2.2 },
    headStyles: { fillColor: [15, 23, 42], textColor: 255 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });

  doc.save(`relatorio-servicos-${scopeLabel.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.pdf`);
}

export function exportGeneralOrdersXLSX(
  orders: ServiceOrder[],
  selectedKeys: string[],
  scopeLabel: string
) {
  const cols = GENERAL_ORDER_COLUMNS.filter((c) => selectedKeys.includes(c.key));
  const rows = orders.map((o) => {
    const rec: Record<string, string | number> = {};
    for (const c of cols) {
      rec[c.label] = c.getValue(o);
    }
    return rec;
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Ordens');
  XLSX.writeFile(wb, `relatorio-servicos-${scopeLabel.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ---------------------------------------------------------------------------
// 2. PARTNER MONTHLY REPORT (CLEAN B2B — ZERO MARGIN / ZERO PAYOUT)
// ---------------------------------------------------------------------------
export function exportPartnerMonthlyPDF(orgName: string, orders: ServiceOrder[]) {
  const doc = new jsPDF({ orientation: 'landscape' });
  const totalNet = orders.reduce((s, o) => s + Number(o.subtotal_without_vat), 0);
  const totalVat = orders.reduce((s, o) => s + Number(o.vat_amount), 0);
  const totalGross = orders.reduce((s, o) => s + Number(o.total_customer_amount), 0);

  addConfiançaHeader(
    doc,
    `Relatório Mensal de Faturação — ${orgName}`,
    `Documento B2B consolidado em ${fmtDate(new Date().toISOString())} · ${orders.length} intervenções`
  );

  autoTable(doc, {
    startY: 48,
    head: [['Ref.', 'Data', 'Serviço', 'Morada / Imóvel', 'Taxa Base', 'M. Obra', 'Peças', 'Subtotal', 'IVA', 'Total c/ IVA', 'Estado Pag.']],
    body: orders.map((o) => [
      o.reference_code,
      fmtDate(o.scheduled_at),
      o.service_name,
      o.service_address,
      fmtEur(o.service_fee),
      fmtEur(o.labor_cost),
      fmtEur(o.parts_customer_total),
      fmtEur(o.subtotal_without_vat),
      `${fmtEur(o.vat_amount)} (${o.vat_rate}%)`,
      fmtEur(o.total_customer_amount),
      o.quote_paid ? 'Liquidado' : 'Em Aberto',
    ]),
    foot: [['TOTAL', '', '', '', '', '', '', fmtEur(totalNet), fmtEur(totalVat), fmtEur(totalGross), '']],
    styles: { fontSize: 7.5, cellPadding: 2.2 },
    headStyles: { fillColor: [15, 23, 42], textColor: 255 },
    footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' },
  });

  doc.save(`relatorio-parceiro-${orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`);
}

export function exportPartnerMonthlyXLSX(orgName: string, orders: ServiceOrder[]) {
  const rows = orders.map((o) => ({
    Referência: o.reference_code,
    Data: fmtDate(o.scheduled_at),
    Serviço: o.service_name,
    Imóvel: o.service_address,
    'Taxa Serviço (€)': Number(o.service_fee),
    'Mão de Obra (€)': Number(o.labor_cost),
    'Peças (€)': Number(o.parts_customer_total),
    'Subtotal s/ IVA (€)': Number(o.subtotal_without_vat),
    'IVA (€)': Number(o.vat_amount),
    'Taxa IVA (%)': Number(o.vat_rate),
    'Total c/ IVA (€)': Number(o.total_customer_amount),
    Pagamento: o.quote_paid ? 'Liquidado' : 'Em Aberto',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Faturação Parceiro');
  XLSX.writeFile(wb, `relatorio-parceiro-${orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.xlsx`);
}

// ---------------------------------------------------------------------------
// 3. WEEKLY PAYOUT RECEIPT PDF & XLSX (WITH MANDATORY NIF 518646696 BLOCK)
// ---------------------------------------------------------------------------
export function exportWeeklyPayoutPDF(group: WeeklyPayoutGroup, invoiceNotice: string) {
  const doc = new jsPDF();
  addConfiançaHeader(
    doc,
    'Extrato Semanal de Repasse Técnico / Parceiro',
    `Ciclo Domingo a Sábado: ${group.weekStart} a ${group.weekEnd} · Pagamento: ${group.dueDate}`
  );

  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`Beneficiário: ${group.targetName}`, 14, 54);
  doc.text(`NIF: ${group.nif || '—'}   |   IBAN: ${group.iban || '—'}`, 14, 60);

  autoTable(doc, {
    startY: 66,
    head: [['Ref.', 'Serviço & Morada', 'Concluído em', 'Repasse (€)']],
    body: group.orders.map((ord) => [
      ord.reference_code,
      `${ord.service_name}\n${ord.service_address}`,
      fmtDate(ord.completed_at),
      fmtEur(ord.technician_payout),
    ]),
    styles: { fontSize: 8.5, cellPadding: 3 },
    headStyles: { fillColor: [15, 23, 42], textColor: 255 },
  });

  let y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 8 : 160;
  const hasAdjustment = Number(group.adjustmentAmount || 0) !== 0;
  if (hasAdjustment) {
    const ordersTotal = group.ordersTotal ?? group.totalAmount - Number(group.adjustmentAmount || 0);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    doc.text(`Subtotal dos serviços: ${fmtEur(ordersTotal)}`, 14, y);
    y += 6;
    const sign = Number(group.adjustmentAmount) < 0 ? '-' : '+';
    doc.text(
      `${adjustmentLabel(group.adjustmentKind)}: ${sign} ${fmtEur(Math.abs(Number(group.adjustmentAmount)))}`,
      14,
      y
    );
    y += 5;
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`Motivo: ${group.adjustmentReason || '—'}`, 14, y);
    y += 8;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text(`Total a Receber (c/ IVA): ${fmtEur(group.totalAmount)}`, 14, y);
  y += 8;

  doc.setFillColor(254, 243, 199);
  doc.setDrawColor(245, 158, 11);
  doc.roundedRect(14, y, 182, 26, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(120, 53, 15);
  doc.text('INSTRUÇÃO DE FATURAÇÃO OBRIGATÓRIA (NIF 518646696)', 18, y + 7);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const lines = doc.splitTextToSize(invoiceNotice || CONFIANCA_COMPANY.invoiceNoticeText, 174);
  doc.text(lines, 18, y + 13);

  doc.save(`repasse-semanal-${group.targetName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${group.weekStart}.pdf`);
}

// Recibo do técnico / parceiro, com bloco fiscal. Só vale como recibo depois do pagamento.
export function exportTechReceiptPDF(group: WeeklyPayoutGroup, invoiceNotice: string) {
  const doc = new jsPDF();
  const paid = group.status === 'paid';
  addConfiançaHeader(
    doc,
    paid ? 'Recibo de Repasse' : 'Documento de Repasse (aguarda pagamento)',
    `Período: ${group.weekStart} a ${group.weekEnd}`
  );

  // Bloco emitente
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.text('Emitente', 14, 54);
  doc.setFont('helvetica', 'normal');
  doc.text(`${CONFIANCA_COMPANY.legalName}`, 14, 59);
  doc.text(`NIF ${CONFIANCA_COMPANY.nif}`, 14, 64);
  doc.text('Avenida Pinhal do Vidal, 30 R/C DRT', 14, 69);
  doc.text('2855-249 Corroios, Portugal', 14, 74);

  // Bloco beneficiário
  doc.setFont('helvetica', 'bold');
  doc.text('Beneficiário', 110, 54);
  doc.setFont('helvetica', 'normal');
  doc.text(group.targetName, 110, 59);
  doc.text(`NIF: ${group.nif || '—'}`, 110, 64);
  doc.text(`IBAN: ${group.iban || '—'}`, 110, 69);

  autoTable(doc, {
    startY: 82,
    head: [['Ref.', 'Serviço & Morada', 'Concluído em', 'Repasse (€)']],
    body: group.orders.map((ord) => [
      ord.reference_code,
      `${ord.service_name}\n${ord.service_address}`,
      fmtDate(ord.completed_at),
      fmtEur(ord.technician_payout),
    ]),
    styles: { fontSize: 8.5, cellPadding: 3 },
    headStyles: { fillColor: [15, 23, 42], textColor: 255 },
  });

  let y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 8 : 170;
  const adj = Number(group.adjustmentAmount || 0);
  if (adj !== 0) {
    const ordersTotal = group.ordersTotal ?? group.totalAmount - adj;
    doc.setFontSize(9.5);
    doc.text(`Subtotal dos serviços: ${fmtEur(ordersTotal)}`, 14, y);
    y += 6;
    doc.text(`${adjustmentLabel(group.adjustmentKind)}: ${adj < 0 ? '-' : '+'} ${fmtEur(Math.abs(adj))}`, 14, y);
    y += 5;
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`Motivo: ${group.adjustmentReason || '—'}`, 14, y);
    y += 8;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text(`Total: ${fmtEur(group.totalAmount)}`, 14, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(
    paid
      ? `Pago em ${fmtDate(group.paidAt, true)}.`
      : `Pagamento previsto: ${fmtDate(group.dueDate)}. Este documento só vale como recibo após o pagamento.`,
    14,
    y
  );
  y += 10;

  doc.setFillColor(254, 243, 199);
  doc.setDrawColor(245, 158, 11);
  doc.roundedRect(14, y, 182, 26, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(120, 53, 15);
  doc.text('BLOCO FISCAL: INSTRUÇÃO DE FATURAÇÃO OBRIGATÓRIA (NIF 518646696)', 18, y + 7);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const lines = doc.splitTextToSize(invoiceNotice || CONFIANCA_COMPANY.invoiceNoticeText, 174);
  doc.text(lines, 18, y + 13);
  y += 36;

  if (paid) {
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(9);
    doc.text(`Recebi a quantia de ${fmtEur(group.totalAmount)}, referente ao período indicado.`, 14, y);
    y += 16;
    doc.line(14, y, 90, y);
    doc.line(110, y, 186, y);
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('Assinatura do beneficiário', 14, y + 4);
    doc.text('Data', 110, y + 4);
  }

  const slug = group.targetName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  doc.save(`${paid ? 'recibo' : 'documento-repasse'}-${slug}-${group.weekStart}.pdf`);
}

export function exportWeeklyPayoutXLSX(group: WeeklyPayoutGroup) {
  const rows = group.orders.map((o) => ({
    Referência: o.reference_code,
    Serviço: o.service_name,
    Morada: o.service_address,
    Concluído: fmtDate(o.completed_at),
    'Repasse (€)': Number(o.technician_payout),
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Repasse Semanal');
  XLSX.writeFile(wb, `repasse-${group.weekStart}-${group.targetId}.xlsx`);
}

// ---------------------------------------------------------------------------
// 4. CASH FLOW & ACCOUNTS PAYABLE PDF / XLSX
// ---------------------------------------------------------------------------
export function exportCashFlowPDF(
  entries: CashFlowEntry[],
  categoryLabels: Record<string, string>
) {
  const doc = new jsPDF({ orientation: 'landscape' });
  addConfiançaHeader(
    doc,
    'Contas a Pagar & Fluxo de Caixa',
    `Exportação contabilística gerada em ${fmtDate(new Date().toISOString(), true)} · ${entries.length} movimentos`
  );

  autoTable(doc, {
    startY: 48,
    head: [['Vencimento', 'Tipo', 'Categoria PT', 'Descrição', 'Recorrência / Parcela', 'Estado', 'Pago (€)', 'Total (€)']],
    body: entries.map((e) => [
      fmtDate(e.due_date),
      e.entry_type === 'income' ? 'Entrada' : 'Saída',
      categoryLabels[e.category] || e.category,
      e.description,
      e.total_installments
        ? `Parcela ${e.installment_number}/${e.total_installments}`
        : e.recurrence_frequency !== 'none'
        ? e.recurrence_frequency
        : 'Único',
      e.status === 'paid' ? 'Liquidado' : e.status === 'partial' ? 'Parcial' : e.is_overdue ? 'Vencido' : 'Previsto',
      fmtEur(e.paid_amount),
      fmtEur(e.amount),
    ]),
    styles: { fontSize: 8, cellPadding: 2.5 },
    headStyles: { fillColor: [15, 23, 42], textColor: 255 },
  });

  doc.save(`fluxo-caixa-confianca-${new Date().toISOString().slice(0, 10)}.pdf`);
}

export function exportCashFlowXLSX(
  entries: CashFlowEntry[],
  categoryLabels: Record<string, string>
) {
  const rows = entries.map((e) => ({
    Vencimento: e.due_date,
    Tipo: e.entry_type === 'income' ? 'Entrada' : 'Saída',
    Categoria: categoryLabels[e.category] || e.category,
    Descrição: e.description,
    Estado: e.status === 'paid' ? 'Liquidado' : e.status === 'partial' ? 'Parcial' : e.is_overdue ? 'Vencido' : 'Previsto',
    'Valor Pago (€)': Number(e.paid_amount || 0),
    'Valor Total (€)': Number(e.amount),
    Recorrência: e.recurrence_frequency || 'none',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Fluxo de Caixa');
  XLSX.writeFile(wb, `fluxo-caixa-confianca-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ---------------------------------------------------------------------------
// 5. MILEAGE (€0.40/KM) PDF / XLSX
// ---------------------------------------------------------------------------
export function exportMileagePDF(trips: MileageTrip[]) {
  const doc = new jsPDF({ orientation: 'landscape' });
  const totalKm = trips.reduce((s, t) => s + Number(t.distance_km), 0);
  const totalEur = trips.reduce((s, t) => s + Number(t.reimbursement_amount), 0);

  addConfiançaHeader(
    doc,
    'Mapa de Quilometragem & Reembolsos (€0,40/km)',
    `Gerado em ${fmtDate(new Date().toISOString(), true)} · Total: ${totalKm.toFixed(1)} km · ${fmtEur(totalEur)}`
  );

  autoTable(doc, {
    startY: 48,
    head: [['Data/Hora', 'Técnico', 'Tipo', 'Origem', 'Destino', 'Ref OS', 'Km', 'Reembolso']],
    body: trips.map((t) => [
      fmtDate(t.started_at, true),
      t.technician_name || '—',
      t.trip_type,
      t.origin_address,
      t.destination_address,
      t.reference_code || 'Retorno',
      `${Number(t.distance_km).toFixed(1)} km`,
      fmtEur(t.reimbursement_amount),
    ]),
    styles: { fontSize: 7.5, cellPadding: 2.2 },
    headStyles: { fillColor: [15, 23, 42], textColor: 255 },
  });

  doc.save(`quilometragem-confianca-${new Date().toISOString().slice(0, 10)}.pdf`);
}

// Recibo de pagamento para o cliente (serviço pago ou com baixa de recebimento)
export function exportCustomerReceiptPDF(order: any) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const paidAt = order.baixa_received_at || order.service_fee_paid_at || order.completed_at || new Date().toISOString();
  // Mesmo cabeçalho dos demais documentos (com o logo)
  addConfiançaHeader(doc, 'Recibo de pagamento', `${CONFIANCA_COMPANY.legalName} · NIF ${CONFIANCA_COMPANY.nif}`);

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Ordem: ${order.reference_code}   ·   Data: ${fmtDate(paidAt)}`, 14, 40);
  if (order.invoice_number) doc.text(`Fatura: ${order.invoice_number}`, 14, 45);
  doc.text(`Cliente: ${order.customer_name || '—'}`, 14, 52);
  doc.text(`NIF: ${order.customer_nif || '—'}`, 14, 57);
  doc.text(`Morada: ${order.service_address || '—'}`, 14, 62);

  const rate = Number(order.vat_rate) === 6 ? 6 : 23;
  const total = Number(order.total_customer_amount || 0);
  const net = Number(order.subtotal_without_vat || total / (1 + rate / 100));
  autoTable(doc, {
    startY: 80,
    head: [['Descrição', `Valor s/ IVA (€)`, `IVA ${rate}% (€)`, 'Total c/ IVA (€)']],
    body: [[
      `Serviço ${order.reference_code}: ${order.service_name || ''}`,
      fmtEur(net),
      fmtEur(total - net),
      fmtEur(total),
    ]],
    styles: { fontSize: 8.5, cellPadding: 3 },
    headStyles: { fillColor: [15, 23, 42], textColor: 255 },
  });
  const y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 10 : 110;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(`Total pago: ${fmtEur(total)}`, 14, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text('Documento de pagamento. A fatura oficial, quando emitida, tem o número indicado acima.', 14, y + 8);
  doc.save(`recibo-${String(order.reference_code).toLowerCase()}.pdf`);
}

export function exportMileageXLSX(trips: MileageTrip[]) {
  const rows = trips.map((t) => ({
    Data: fmtDate(t.started_at, true),
    Técnico: t.technician_name || '—',
    Tipo: t.trip_type,
    Origem: t.origin_address,
    Destino: t.destination_address,
    'Ref. OS': t.reference_code || 'Retorno',
    'Distância (Km)': Number(t.distance_km),
    'Reembolso (€)': Number(t.reimbursement_amount),
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Quilometragem');
  XLSX.writeFile(wb, `quilometragem-confianca-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
