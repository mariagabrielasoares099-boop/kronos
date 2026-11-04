/** Protocolo unico do chamado: ADM-AAAA-NNNNNN (sequencial por ano). */
export function formatProtocol(year: number, seq: number): string {
  if (!Number.isInteger(seq) || seq < 1 || seq > 999_999) throw new RangeError('Sequencia fora do intervalo');
  return `ADM-${year}-${String(seq).padStart(6, '0')}`;
}
export const PROTOCOL_RE = /^ADM-\d{4}-\d{6}$/;
