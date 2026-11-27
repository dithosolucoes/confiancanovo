import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, CalendarDays, Wrench } from 'lucide-react';
import { PortalLayout } from '../../components/PortalLayout';
import { apiFetch, formatDatePT } from '../../lib/api';
import type { UserProfile, WarrantyReturnVisit } from '../../types/domain';

interface AgendaOrder {
  id: string;
  reference_code: string;
  service_name: string;
  service_address: string;
  scheduled_at: string;
  status: string;
  is_warranty: boolean;
  technician_id: string | null;
  technician_name: string | null;
  customer_name: string;
}

interface CalendarCellItem {
  key: string;
  orderId: string;
  kind: 'order' | 'return';
  timeLabel: string;
  referenceCode: string;
  title: string;
  address: string;
  technicianName: string | null;
  status: string;
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

export function AgendaCalendarPage({ orderBaseRoute }: { orderBaseRoute: string }) {
  const [viewMode, setViewMode] = useState<'month' | 'week'>('month');
  const [cursor, setCursor] = useState(() => new Date());
  const [orders, setOrders] = useState<AgendaOrder[]>([]);
  const [returnVisits, setReturnVisits] = useState<WarrantyReturnVisit[]>([]);
  const [technicians, setTechnicians] = useState<UserProfile[]>([]);
  const [technicianId, setTechnicianId] = useState('all');
  const [loading, setLoading] = useState(true);

  const loadAgenda = useCallback(async () => {
    setLoading(true);
    try {
      const qs = technicianId !== 'all' ? `?technicianId=${technicianId}` : '';
      const res = await apiFetch<{
        orders: AgendaOrder[];
        returnVisits: WarrantyReturnVisit[];
      }>(`/api/agenda${qs}`);
      setOrders(res.orders);
      setReturnVisits(res.returnVisits);
    } finally {
      setLoading(false);
    }
  }, [technicianId]);

  useEffect(() => {
    loadAgenda();
  }, [loadAgenda]);

  useEffect(() => {
    apiFetch<{ technicians: UserProfile[] }>('/api/technicians')
      .then((r) => setTechnicians(r.technicians))
      .catch(() => {});
  }, []);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  const headerTitle = useMemo(() => {
    if (viewMode === 'month') {
      return new Date(year, month, 1).toLocaleDateString('pt-PT', {
        month: 'long',
        year: 'numeric',
      });
    }
    const startOfWeek = new Date(cursor);
    startOfWeek.setDate(cursor.getDate() - cursor.getDay());
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    return `Semana de ${startOfWeek.toLocaleDateString('pt-PT', {
      day: '2-digit',
      month: 'short',
    })} a ${endOfWeek.toLocaleDateString('pt-PT', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })}`;
  }, [cursor, month, viewMode, year]);

  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const startOffset = firstDay.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: Array<{ dateKey: string | null; dayNumber: number | null }> = [];

    for (let i = 0; i < startOffset; i++) {
      cells.push({ dateKey: null, dayNumber: null });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const mm = String(month + 1).padStart(2, '0');
      const dd = String(d).padStart(2, '0');
      cells.push({ dateKey: `${year}-${mm}-${dd}`, dayNumber: d });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ dateKey: null, dayNumber: null });
    }
    return cells;
  }, [year, month]);

  const weekDays = useMemo(() => {
    const start = new Date(cursor);
    start.setDate(cursor.getDate() - cursor.getDay());
    return Array.from({ length: 7 }).map((_, idx) => {
      const d = new Date(start);
      d.setDate(start.getDate() + idx);
      return {
        dateKey: toDateKey(d),
        dayNumber: d.getDate(),
        weekdayLabel: WEEKDAYS[d.getDay()],
        monthLabel: d.toLocaleDateString('pt-PT', { month: 'short' }),
      };
    });
  }, [cursor]);

  const itemsByDate = useMemo(() => {
    const map: Record<string, CalendarCellItem[]> = {};
    const addItem = (iso: string, item: CalendarCellItem) => {
      if (!iso) return;
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return;
      const key = toDateKey(d);
      if (!map[key]) map[key] = [];
      map[key].push(item);
    };

    for (const o of orders) {
      const dt = new Date(o.scheduled_at);
      const timeLabel = Number.isNaN(dt.getTime())
        ? '--:--'
        : dt.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
      addItem(o.scheduled_at, {
        key: `ord-${o.id}`,
        orderId: o.id,
        kind: 'order',
        timeLabel,
        referenceCode: o.reference_code,
        title: o.service_name,
        address: o.service_address,
        technicianName: o.technician_name,
        status: o.status,
      });
    }

    for (const rv of returnVisits) {
      const dt = new Date(rv.scheduled_at);
      const timeLabel = Number.isNaN(dt.getTime())
        ? '--:--'
        : dt.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
      addItem(rv.scheduled_at, {
        key: `ret-${rv.id}`,
        orderId: rv.service_order_id,
        kind: 'return',
        timeLabel,
        referenceCode: rv.reference_code || 'RET',
        title: rv.notes || rv.service_name || 'Visita de Retorno / Garantia',
        address: rv.service_address || '',
        technicianName: rv.technician_name || null,
        status: rv.status,
      });
    }

    return map;
  }, [orders, returnVisits]);

  const todayKey = toDateKey(new Date());

  function handlePrev() {
    if (viewMode === 'month') {
      setCursor(new Date(year, month - 1, 1));
    } else {
      const d = new Date(cursor);
      d.setDate(cursor.getDate() - 7);
      setCursor(d);
    }
  }

  function handleNext() {
    if (viewMode === 'month') {
      setCursor(new Date(year, month + 1, 1));
    } else {
      const d = new Date(cursor);
      d.setDate(cursor.getDate() + 7);
      setCursor(d);
    }
  }

  return (
    <PortalLayout title="Agenda em Grade & Retornos de Garantia" breadcrumb="Planeamento">
      <div className="space-y-6">
        {/* Controls Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handlePrev}
              className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
              aria-label="Período anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setCursor(new Date())}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Hoje
            </button>
            <button
              type="button"
              onClick={handleNext}
              className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
              aria-label="Próximo período"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <h2 className="ml-2 font-display text-base font-bold capitalize text-slate-900">
              {headerTitle}
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              <button
                type="button"
                onClick={() => setViewMode('month')}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  viewMode === 'month'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Mensal
              </button>
              <button
                type="button"
                onClick={() => setViewMode('week')}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  viewMode === 'week'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Semanal
              </button>
            </div>

            <div className="flex items-center gap-3 text-xs text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5 text-slate-700" />
                <span>Atendimento ({orders.length})</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Wrench className="h-3.5 w-3.5 text-amber-600" />
                <span>Retorno ({returnVisits.length})</span>
              </span>
            </div>

            <select
              value={technicianId}
              onChange={(e) => setTechnicianId(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700"
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

        {/* Monthly or Weekly Grid */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {viewMode === 'month' ? (
            <>
              <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-semibold text-slate-500">
                {WEEKDAYS.map((day) => (
                  <div key={day} className="py-2.5">
                    {day}
                  </div>
                ))}
              </div>

              {loading ? (
                <div className="p-10 text-center text-xs text-slate-500">
                  A carregar agenda e visitas de retorno...
                </div>
              ) : (
                <div className="grid grid-cols-7 divide-x divide-y divide-slate-100">
                  {calendarDays.map((cell, idx) => {
                    const dayItems = cell.dateKey ? itemsByDate[cell.dateKey] || [] : [];
                    const isToday = cell.dateKey === todayKey;
                    return (
                      <div
                        key={idx}
                        className={`min-h-[118px] p-2 ${
                          cell.dayNumber ? 'bg-white' : 'bg-slate-50/60'
                        }`}
                      >
                        {cell.dayNumber && (
                          <div className="flex items-center justify-between">
                            <span
                              className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-semibold tabular-nums ${
                                isToday ? 'bg-slate-900 text-white' : 'text-slate-700'
                              }`}
                            >
                              {cell.dayNumber}
                            </span>
                            {dayItems.length > 0 && (
                              <span className="text-[11px] text-slate-400 tabular-nums">
                                {dayItems.length}
                              </span>
                            )}
                          </div>
                        )}

                        <div className="mt-1.5 space-y-1">
                          {dayItems.map((it) => (
                            <Link
                              key={it.key}
                              to={`${orderBaseRoute}/${it.orderId}`}
                              className={`block rounded-md border px-2 py-1 text-[11px] leading-tight transition-colors ${
                                it.kind === 'return'
                                  ? 'border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100'
                                  : 'border-slate-200 bg-slate-50 text-slate-800 hover:border-slate-400'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-1 font-semibold tabular-nums">
                                <span>{it.timeLabel}</span>
                                <span className="font-mono">{it.referenceCode}</span>
                              </div>
                              <div className="truncate font-medium">
                                {it.kind === 'return' ? 'Retorno: ' : ''}
                                {it.title}
                              </div>
                              {it.technicianName && (
                                <div className="truncate text-[10px] text-slate-500">
                                  {it.technicianName}
                                </div>
                              )}
                            </Link>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : loading ? (
            <div className="p-10 text-center text-xs text-slate-500">
              A carregar agenda semanal...
            </div>
          ) : (
            <div className="grid grid-cols-1 divide-y divide-slate-200 md:grid-cols-7 md:divide-x md:divide-y-0">
              {weekDays.map((wd) => {
                const dayItems = itemsByDate[wd.dateKey] || [];
                const isToday = wd.dateKey === todayKey;
                return (
                  <div key={wd.dateKey} className="min-h-[260px] flex flex-col">
                    <div
                      className={`border-b border-slate-200 px-3 py-2.5 text-center ${
                        isToday ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-700'
                      }`}
                    >
                      <div className="text-[11px] font-medium uppercase opacity-80">
                        {wd.weekdayLabel}
                      </div>
                      <div className="text-sm font-bold tabular-nums">
                        {wd.dayNumber} {wd.monthLabel}
                      </div>
                    </div>
                    <div className="flex-1 space-y-2 p-2.5">
                      {dayItems.length === 0 ? (
                        <div className="py-6 text-center text-[11px] text-slate-400">
                          Sem marcações
                        </div>
                      ) : (
                        dayItems.map((it) => (
                          <Link
                            key={it.key}
                            to={`${orderBaseRoute}/${it.orderId}`}
                            className={`block rounded-lg border p-2 text-xs transition-colors ${
                              it.kind === 'return'
                                ? 'border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100'
                                : 'border-slate-200 bg-white text-slate-800 hover:border-slate-400'
                            }`}
                          >
                            <div className="flex items-center justify-between font-semibold tabular-nums">
                              <span>{it.timeLabel}</span>
                              <span className="font-mono text-[11px]">{it.referenceCode}</span>
                            </div>
                            <div className="mt-1 font-medium leading-snug">
                              {it.kind === 'return' ? 'Retorno: ' : ''}
                              {it.title}
                            </div>
                            {it.address && (
                              <div className="mt-0.5 truncate text-[11px] text-slate-500">
                                {it.address}
                              </div>
                            )}
                            {it.technicianName && (
                              <div className="mt-1 text-[11px] font-medium text-slate-600">
                                {it.technicianName}
                              </div>
                            )}
                          </Link>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Return Visits Upcoming List */}
        {returnVisits.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-3.5">
              <h3 className="text-sm font-semibold text-slate-900">
                Visitas de Retorno / Garantia Agendadas
              </h3>
            </div>
            <div className="divide-y divide-slate-100">
              {returnVisits.map((rv) => (
                <Link
                  key={rv.id}
                  to={`${orderBaseRoute}/${rv.service_order_id}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-xs hover:bg-slate-50"
                >
                  <div>
                    <div className="font-semibold text-slate-900">
                      <span className="font-mono">{rv.reference_code}</span> · {rv.service_name}
                    </div>
                    <div className="mt-0.5 text-slate-500">
                      {rv.notes || 'Retorno técnico'} · {rv.service_address}
                    </div>
                  </div>
                  <div className="text-right tabular-nums">
                    <div className="font-medium text-slate-900">
                      {formatDatePT(rv.scheduled_at, true)}
                    </div>
                    <div className="text-slate-500">{rv.technician_name || 'Por atribuir'}</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
