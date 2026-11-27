export type QuoteStatus = 'sent' | 'accepted' | 'rejected' | null;

export const PAYOUT_RULE_CUTOFF_ISO = '2026-08-01T00:00:00+01:00';
export const LEGACY_TECH_SHARE = 0.7;
export const LEGACY_PARTS_PROFIT_SHARE = 0.5;

export interface ServiceFinancialInput {
  serviceFee: number;              // Taxa de deslocação/serviço (€85 / €75 / €55)
  laborCost: number;               // Mão de obra
  extraFee: number;                // Taxa extra
  additionalCost: number;          // Adicional (100% empresa)
  partsBaseCost: number;           // Soma das peças cobradas ao cliente (antes do markup legado)
  partsSupplierCost: number;       // Soma paga aos fornecedores
  vatRate: 6 | 23;                 // Alíquota Portugal (6% ou 23%)
  quoteStatus: QuoteStatus;
  isWarranty: boolean;
  legacyPartsMarkup?: boolean;     // true apenas para histórico Berens < 15/06/2026
  partsMarkupMultiplier?: number;  // multiplicador da regra Berens (parâmetro do negócio); padrão 1,30
  legacyPayoutRule?: boolean;      // true para serviços históricos < 01/08/2026 (70% MO/Extra + 50% lucro peças)
  fixedPayoutAmount?: number;      // valor fixo histórico da taxa de serviço na regra < 01/08/2026
  createdAt?: string | Date | null;
  customPayoutPercentage?: number; // Default 50 (ou % customizada do Centro Técnico / técnico)
  payoutLocked?: boolean;
  payoutOverridden?: boolean;
  manualTechnicianPayout?: number;
}

export interface ServiceFinancialSummary {
  customerPartsTotal: number;
  subtotalWithoutVat: number;
  vatAmount: number;
  totalCustomerAmount: number;
  technicianPayout: number;
  companyGrossMargin: number;
  ruleVersion: 'current_2026_08' | 'legacy_pre_2026_08';
}

export interface AdditionalChargeComponent {
  id: 'service_fee' | 'labor_extra' | 'materials';
  label: string;
  amountWithVat: number;
  paid: boolean;
  paidAt: string | null;
}

export interface AdditionalChargesSummary {
  components: AdditionalChargeComponent[];
  totalWithVat: number;
  totalPaidWithVat: number;
  totalPendingWithVat: number;
  hasPending: boolean;
}

export const round2 = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

export function usesCurrentPayoutRule(
  createdAt?: string | Date | null,
  legacyPayoutRuleFlag?: boolean
): boolean {
  if (legacyPayoutRuleFlag) return false;
  if (!createdAt) return true;
  const d = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(d.getTime())) return true;
  return d.getTime() >= new Date(PAYOUT_RULE_CUTOFF_ISO).getTime();
}

export function getDefaultServiceFee(serviceName: string): number {
  const normalized = serviceName.toLowerCase();
  if (
    normalized.includes('vistoria') ||
    (normalized.includes('esquentador') && !normalized.includes('instala'))
  ) {
    return 85.00;
  }
  if (normalized.includes('esquentador') && normalized.includes('instala')) {
    return 75.00;
  }
  return 55.00;
}

export function calculateServiceFinancials(
  input: ServiceFinancialInput
): ServiceFinancialSummary {
  // 1. Regra Legada Berens (x1.30 apenas em serviços antigos marcados < 15/06/2026)
  const partsMultiplier = input.legacyPartsMarkup ? (input.partsMarkupMultiplier ?? 1.30) : 1.00;
  const customerPartsTotal = round2(input.partsBaseCost * partsMultiplier);

  // 2. Se orçamento foi recusado, cliente paga apenas a Taxa de Serviço
  const effectiveLabor = input.quoteStatus === 'rejected' ? 0 : input.laborCost;
  const effectiveExtra = input.quoteStatus === 'rejected' ? 0 : input.extraFee;
  const effectiveAdditional = input.quoteStatus === 'rejected' ? 0 : input.additionalCost;
  const effectiveParts = input.quoteStatus === 'rejected' ? 0 : customerPartsTotal;
  const effectiveSupplier = input.quoteStatus === 'rejected' ? 0 : input.partsSupplierCost;

  // 3. Totais Cliente + IVA Portugal (6% ou 23%)
  const subtotalWithoutVat = round2(
    input.serviceFee + effectiveLabor + effectiveExtra + effectiveAdditional + effectiveParts
  );
  const vatAmount = round2(subtotalWithoutVat * (input.vatRate / 100));
  const totalCustomerAmount = round2(subtotalWithoutVat + vatAmount);

  // 4. Repasse ao Técnico (Regra Vigente >= 01/08/2026 vs Regra Histórica < 01/08/2026)
  const isCurrentRule = usesCurrentPayoutRule(input.createdAt, input.legacyPayoutRule);
  let technicianPayout = 0;

  if (input.payoutLocked || input.payoutOverridden) {
    technicianPayout = round2(input.manualTechnicianPayout ?? 0);
  } else if (!isCurrentRule) {
    // Regra histórica anterior a 01/08/2026 (não retroativa)
    const fixedFeePayout = input.fixedPayoutAmount ?? round2(input.serviceFee * 0.5);
    if (input.quoteStatus === 'rejected') {
      technicianPayout = round2(fixedFeePayout);
    } else {
      const partsProfit = Math.max(0, effectiveParts - effectiveSupplier);
      const extraComponent = input.isWarranty ? 0 : effectiveExtra * LEGACY_TECH_SHARE;
      technicianPayout = round2(
        fixedFeePayout +
          effectiveLabor * LEGACY_TECH_SHARE +
          extraComponent +
          partsProfit * LEGACY_PARTS_PROFIT_SHARE
      );
    }
  } else {
    const share = (input.customPayoutPercentage ?? 50) / 100;

    if (input.quoteStatus === 'rejected') {
      // Orçamento recusado: apenas % da Taxa de Serviço
      technicianPayout = round2(input.serviceFee * share);
    } else if (input.isWarranty) {
      // Garantia: % da Taxa de Serviço + % da M.O. (Taxa Extra zerada)
      technicianPayout = round2(input.serviceFee * share + effectiveLabor * share);
    } else {
      // Regra Vigente: % sobre Taxa de Serviço + M.O. + Taxa Extra (Peças e Adicional = 0%)
      technicianPayout = round2(
        input.serviceFee * share + effectiveLabor * share + effectiveExtra * share
      );
    }
  }

  // 5. Lucro Operacional da Confiança (antes de impostos)
  const companyGrossMargin = round2(
    subtotalWithoutVat - technicianPayout - effectiveSupplier
  );

  return {
    customerPartsTotal: effectiveParts,
    subtotalWithoutVat,
    vatAmount,
    totalCustomerAmount,
    technicianPayout,
    companyGrossMargin,
    ruleVersion: isCurrentRule ? 'current_2026_08' : 'legacy_pre_2026_08',
  };
}

/**
 * Repasse proporcional quando o cliente liquida apenas uma parcela da base elegível,
 * evitando duplo repasse sobre parcelas já transferidas.
 */
export function computeProportionalPayout(params: {
  eligibleBase: number;
  eligibleReceived: number;
  alreadyTransferred?: number;
  customPayoutPercentage?: number;
}): number {
  const base = Math.max(0, Number(params.eligibleBase) || 0);
  if (base === 0) return 0;
  const received = Math.min(Math.max(0, Number(params.eligibleReceived) || 0), base);
  const share = (params.customPayoutPercentage ?? 50) / 100;
  const due = received * share;
  return round2(Math.max(0, due - Math.max(0, Number(params.alreadyTransferred) || 0)));
}

/**
 * Anti-duplicação por componente: separa Taxa de Serviço, M.O. + Taxa Extra + Adicional
 * e Peças/Materiais com seus respetivos marcadores de liquidação.
 */
export function computeAdditionalChargesSummary(params: {
  serviceFee: number;
  laborCost: number;
  extraFee: number;
  additionalCost: number;
  partsCustomerTotal: number;
  vatRate: 6 | 23;
  quoteStatus: QuoteStatus;
  serviceFeePaid: boolean;
  serviceFeePaidAt?: string | null;
  quotePaid: boolean;
  laborPaidAt?: string | null;
  materialsPaidAt?: string | null;
}): AdditionalChargesSummary {
  const vatFactor = 1 + (params.vatRate === 6 ? 0.06 : 0.23);
  const rejected = params.quoteStatus === 'rejected';

  const feeWithVat = round2(params.serviceFee * vatFactor);
  const laborExtraBase = rejected
    ? 0
    : params.laborCost + params.extraFee + params.additionalCost;
  const laborExtraWithVat = round2(laborExtraBase * vatFactor);
  const materialsWithVat = rejected ? 0 : round2(params.partsCustomerTotal * vatFactor);

  const components: AdditionalChargeComponent[] = [];
  if (feeWithVat > 0) {
    components.push({
      id: 'service_fee',
      label: 'Taxa de Serviço / Deslocação',
      amountWithVat: feeWithVat,
      paid: Boolean(params.serviceFeePaid || params.serviceFeePaidAt || params.quotePaid),
      paidAt: params.serviceFeePaidAt || null,
    });
  }
  if (laborExtraWithVat > 0) {
    components.push({
      id: 'labor_extra',
      label: 'Mão de Obra, Taxa Extra & Adicional',
      amountWithVat: laborExtraWithVat,
      paid: Boolean(params.quotePaid || params.laborPaidAt),
      paidAt: params.laborPaidAt || null,
    });
  }
  if (materialsWithVat > 0) {
    components.push({
      id: 'materials',
      label: 'Peças e Materiais',
      amountWithVat: materialsWithVat,
      paid: Boolean(params.quotePaid || params.materialsPaidAt),
      paidAt: params.materialsPaidAt || null,
    });
  }

  const totalWithVat = round2(components.reduce((s, c) => s + c.amountWithVat, 0));
  const totalPaidWithVat = round2(
    components.filter((c) => c.paid).reduce((s, c) => s + c.amountWithVat, 0)
  );
  const totalPendingWithVat = round2(Math.max(0, totalWithVat - totalPaidWithVat));

  return {
    components,
    totalWithVat,
    totalPaidWithVat,
    totalPendingWithVat,
    hasPending: totalPendingWithVat > 0.004,
  };
}
