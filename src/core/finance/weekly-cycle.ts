export interface PayoutWeekCycle {
  weekStart: string; // YYYY-MM-DD (Domingo)
  weekEnd: string;   // YYYY-MM-DD (Sábado)
  dueDate: string;   // YYYY-MM-DD (Sexta-feira seguinte)
}

function formatDateISO(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Dado qualquer dia da semana, retorna:
 * - Domingo daquela semana (início)
 * - Sábado daquela semana (fechamento)
 * - Sexta-feira da semana seguinte (data de pagamento / vencimento)
 */
export function getWeeklyPayoutCycle(referenceDate: Date = new Date()): PayoutWeekCycle {
  const date = new Date(
    Date.UTC(
      referenceDate.getUTCFullYear(),
      referenceDate.getUTCMonth(),
      referenceDate.getUTCDate()
    )
  );

  const dayOfWeek = date.getUTCDay(); // 0 = Domingo, 6 = Sábado

  const sunday = new Date(date);
  sunday.setUTCDate(date.getUTCDate() - dayOfWeek);

  const saturday = new Date(sunday);
  saturday.setUTCDate(sunday.getUTCDate() + 6);

  const nextFriday = new Date(saturday);
  nextFriday.setUTCDate(saturday.getUTCDate() + 6);

  return {
    weekStart: formatDateISO(sunday),
    weekEnd: formatDateISO(saturday),
    dueDate: formatDateISO(nextFriday),
  };
}

export function getRecentWeeklyCycles(count = 4, referenceDate: Date = new Date()): PayoutWeekCycle[] {
  const cycles: PayoutWeekCycle[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(referenceDate);
    d.setUTCDate(d.getUTCDate() - i * 7);
    cycles.push(getWeeklyPayoutCycle(d));
  }
  return cycles;
}
