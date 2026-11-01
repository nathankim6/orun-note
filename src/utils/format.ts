export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
export function fmtDate(iso: string, opts: { weekday?: boolean; time?: boolean; short?: boolean } = {}) {
  const d = new Date(iso); if (isNaN(d.getTime())) return iso;
  const base = opts.short ? `${d.getMonth() + 1}월 ${d.getDate()}일` : `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
  const wd = opts.weekday ? ` (${WEEKDAYS[d.getDay()]})` : '';
  const t = opts.time ? ` ${d.getHours() < 12 ? '오전' : '오후'} ${((d.getHours() + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, '0')}` : '';
  return base + wd + t;
}
export function dday(dateStr: string) { const t = new Date(dateStr + 'T00:00:00'); const today = new Date(); today.setHours(0, 0, 0, 0); return Math.round((t.getTime() - today.getTime()) / 86400000); }
export const ddayLabel = (n: number) => (n === 0 ? 'D-Day' : n > 0 ? `D-${n}` : `D+${-n}`);
export function fmtDuration(sec: number) { sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); const s = sec % 60; if (h) return `${h}시간 ${m}분`; if (m) return `${m}분 ${s}초`; return `${s}초`; }
export function fmtClock(sec: number) { sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); const s = sec % 60; return (h ? `${h}:` : '') + `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; }
export function timeAgo(iso: string) { const diff = (Date.now() - new Date(iso).getTime()) / 1000; if (diff < 60) return '방금 전'; if (diff < 3600) return `${Math.floor(diff / 60)}분 전`; if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`; return `${Math.floor(diff / 86400)}일 전`; }
export const fmtPrice = (p: number) => (p === 0 ? '무료' : `${p.toLocaleString('ko-KR')}원`);
export const circled = (n: number) => '①②③④⑤⑥⑦⑧⑨'[n - 1] ?? String(n);
export const fmtBytes = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(0)} MB` : `${(b / 1e3).toFixed(0)} KB`);
