const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
const dateTimeFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const monthFmt = new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' });

/** "2026-10-05" → "05/10/2026" (data sem fuso). */
export const formatDate = (iso: string | null | undefined) => (iso ? dateFmt.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)) : '—');

/** Timestamp ISO → data e hora local. */
export const formatDateTime = (iso: string | null | undefined) => (iso ? dateTimeFmt.format(new Date(iso)) : 'nunca');

/**
 * Valor digitado em reais → centavos. Aceita "1.234,56", "1234,5", "1234.56" e "1234".
 * Retorna null se não for um número.
 */
export function parseBRL(input: string): number | null {
  let s = input.replace(/[R$\s]/g, '');
  if (!s) return null;
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/\.\d{1,2}$/.test(s) && !s.includes(',')) s = s.replace(/,/g, '');
  else s = s.replace(/[.,]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Centavos → "1.234,56" (para preencher um campo de valor). */
export const centsToInput = (cents: number) => (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "2026-10" → "out/26". */
export const formatMonth = (ym: string) => monthFmt.format(new Date(`${ym}-01T00:00:00Z`)).replace('. de ', '/').replace(' de ', '/').replace('.', '');

/**
 * Paleta categórica dos gráficos, validada contra a superfície dos cartões (#141f2b): luminosidade, croma,
 * separação para daltonismo entre vizinhos e contraste. A ordem é o mecanismo de segurança: não reordenar.
 */
export const CHART_SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'] as const;

/** Link do WhatsApp com mensagem pronta (número brasileiro sem DDI ganha o 55). */
export function whatsappLink(phone: string | null | undefined, text: string): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  const full = digits.length <= 11 ? `55${digits}` : digits;
  return `https://wa.me/${full}?text=${encodeURIComponent(text)}`;
}
