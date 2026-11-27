import assert from 'node:assert/strict';
import {
  calculateServiceFinancials,
  computeAdditionalChargesSummary,
  computeProportionalPayout,
  getDefaultServiceFee,
} from './calculator.ts';
import { getWeeklyPayoutCycle } from './weekly-cycle.ts';

function runTests() {
  // 1. Taxas padrão
  assert.equal(getDefaultServiceFee('Reparação de Esquentador'), 85);
  assert.equal(getDefaultServiceFee('Vistoria Técnica'), 85);
  assert.equal(getDefaultServiceFee('Instalação de Esquentador'), 75);
  assert.equal(getDefaultServiceFee('Reparação de Máquina de Lavar Roupa'), 55);

  // 2. Cenário Padrão (IVA 23%, repasse 50/50, peças 100% empresa)
  const r2 = calculateServiceFinancials({
    serviceFee: 55,
    laborCost: 100,
    extraFee: 20,
    additionalCost: 15,
    partsBaseCost: 80,
    partsSupplierCost: 50,
    vatRate: 23,
    quoteStatus: 'accepted',
    isWarranty: false,
  });
  assert.equal(r2.subtotalWithoutVat, 270);
  assert.equal(r2.vatAmount, 62.10);
  assert.equal(r2.totalCustomerAmount, 332.10);
  assert.equal(r2.technicianPayout, 87.50);
  assert.equal(r2.companyGrossMargin, 132.50);
  assert.equal(r2.ruleVersion, 'current_2026_08');

  // 3. IVA Reduzido 6%
  const r3 = calculateServiceFinancials({
    serviceFee: 85,
    laborCost: 60,
    extraFee: 0,
    additionalCost: 0,
    partsBaseCost: 0,
    partsSupplierCost: 0,
    vatRate: 6,
    quoteStatus: 'accepted',
    isWarranty: false,
  });
  assert.equal(r3.subtotalWithoutVat, 145);
  assert.equal(r3.vatAmount, 8.70);
  assert.equal(r3.totalCustomerAmount, 153.70);
  assert.equal(r3.technicianPayout, 72.50);

  // 4. Orçamento Recusado
  const r4 = calculateServiceFinancials({
    serviceFee: 55,
    laborCost: 120,
    extraFee: 30,
    additionalCost: 10,
    partsBaseCost: 90,
    partsSupplierCost: 60,
    vatRate: 23,
    quoteStatus: 'rejected',
    isWarranty: false,
  });
  assert.equal(r4.subtotalWithoutVat, 55);
  assert.equal(r4.technicianPayout, 27.50);
  assert.equal(r4.companyGrossMargin, 27.50);

  // 5. Garantia
  const r5 = calculateServiceFinancials({
    serviceFee: 55,
    laborCost: 80,
    extraFee: 40,
    additionalCost: 0,
    partsBaseCost: 0,
    partsSupplierCost: 0,
    vatRate: 23,
    quoteStatus: 'accepted',
    isWarranty: true,
  });
  assert.equal(r5.technicianPayout, 67.50);

  // 6. Centro Técnico customizado 65%
  const r6 = calculateServiceFinancials({
    serviceFee: 100,
    laborCost: 100,
    extraFee: 0,
    additionalCost: 0,
    partsBaseCost: 50,
    partsSupplierCost: 30,
    vatRate: 23,
    quoteStatus: 'accepted',
    isWarranty: false,
    customPayoutPercentage: 65,
  });
  assert.equal(r6.technicianPayout, 130);

  // 7. Regra Legada Berens x1.30
  const r7 = calculateServiceFinancials({
    serviceFee: 55,
    laborCost: 0,
    extraFee: 0,
    additionalCost: 0,
    partsBaseCost: 100,
    partsSupplierCost: 70,
    vatRate: 23,
    quoteStatus: 'accepted',
    isWarranty: false,
    legacyPartsMarkup: true,
  });
  assert.equal(r7.customerPartsTotal, 130);
  assert.equal(r7.subtotalWithoutVat, 185);
  assert.equal(r7.technicianPayout, 27.50);

  // 8. Trava de Edição Manual / Locked
  const r8 = calculateServiceFinancials({
    serviceFee: 55,
    laborCost: 100,
    extraFee: 0,
    additionalCost: 0,
    partsBaseCost: 0,
    partsSupplierCost: 0,
    vatRate: 23,
    quoteStatus: 'accepted',
    isWarranty: false,
    payoutLocked: true,
    manualTechnicianPayout: 95.00,
  });
  assert.equal(r8.technicianPayout, 95.00);

  // 9. Ciclo Semanal Domingo-Sábado -> Sexta
  const cycle = getWeeklyPayoutCycle(new Date('2026-11-11T14:00:00Z'));
  assert.equal(cycle.weekStart, '2026-11-08');
  assert.equal(cycle.weekEnd, '2026-11-14');
  assert.equal(cycle.dueDate, '2026-11-20');

  // 10. Regra de Corte Temporal (< 01/08/2026): 70% MO/Extra + 50% lucro peças + fixo
  const r10 = calculateServiceFinancials({
    serviceFee: 55,
    laborCost: 100,
    extraFee: 20,
    additionalCost: 0,
    partsBaseCost: 90,
    partsSupplierCost: 50,
    vatRate: 23,
    quoteStatus: 'accepted',
    isWarranty: false,
    createdAt: '2026-07-15T10:00:00Z',
    fixedPayoutAmount: 25,
  });
  assert.equal(r10.ruleVersion, 'legacy_pre_2026_08');
  // 25 + 70% de 100 (70) + 70% de 20 (14) + 50% de (90 - 50) (20) = 129
  assert.equal(r10.technicianPayout, 129);

  // 11. Repasse Proporcional anti-duplicação
  const prop1 = computeProportionalPayout({
    eligibleBase: 200,
    eligibleReceived: 55,
    alreadyTransferred: 0,
    customPayoutPercentage: 50,
  });
  assert.equal(prop1, 27.50);
  const prop2 = computeProportionalPayout({
    eligibleBase: 200,
    eligibleReceived: 200,
    alreadyTransferred: 27.50,
    customPayoutPercentage: 50,
  });
  assert.equal(prop2, 72.50);

  // 12. Anti-duplicação por componentes (labor_paid_at vs materials_paid_at)
  const charges = computeAdditionalChargesSummary({
    serviceFee: 55,
    laborCost: 100,
    extraFee: 0,
    additionalCost: 0,
    partsCustomerTotal: 50,
    vatRate: 23,
    quoteStatus: 'accepted',
    serviceFeePaid: true,
    quotePaid: false,
    laborPaidAt: '2026-11-10T12:00:00Z',
    materialsPaidAt: null,
  });
  assert.equal(charges.totalPaidWithVat, 190.65); // (55 + 100) * 1.23
  assert.equal(charges.totalPendingWithVat, 61.50); // 50 * 1.23
  assert.equal(charges.hasPending, true);

  console.log('ALL 12 CONFIANCA REPARA FINANCIAL TESTS PASSED');
}

runTests();
