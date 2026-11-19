export function qnaCode(monthValue, halfValue) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(monthValue || '');
  const half = Number(halfValue);
  return match && (half === 1 || half === 2)
    ? `${match[1]}${String((Number(match[2]) - 1) * 2 + half).padStart(2, '0')}` : '';
}

export function qnaLabel(qna) {
  if (/^\d{4}(0[1-9]|1\d|2[0-4])$/.test(qna || '')) return qna;
  const match = /^(\d{4})-(0[1-9]|1[0-2])-([12])$/.exec(qna || '');
  return match ? qnaCode(`${match[1]}-${match[2]}`, match[3]) : qna || '—';
}

export function initialQna() {
  const now = new Date();
  return { month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    half: String(now.getDate() <= 15 ? 1 : 2) };
}

export function distribute(total, count) {
  if (count < 1) return [];
  return Array.from({ length: count }, (_, i) => Math.floor(total / count) + (i < total % count ? 1 : 0));
}
