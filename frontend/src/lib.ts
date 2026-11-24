import { createContext, useContext, useEffect, useState } from 'react';
import type { Category, Level, Sev } from './types';

/* ───── theme ───── */
export type ThemePref = 'system' | 'light' | 'dark';
export const ThemeCtx = createContext<{ dark: boolean; tick: number }>({ dark: true, tick: 0 });
export const useTheme = () => useContext(ThemeCtx);

export function useThemeState() {
  const mq = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: light)') : null;
  const [pref, setPref] = useState<ThemePref>(() => {
    try { return (localStorage.getItem('at-theme') as ThemePref) || 'system'; } catch { return 'system'; }
  });
  const [sysLight, setSysLight] = useState(!!mq?.matches);
  useEffect(() => {
    if (!mq) return;
    const f = () => setSysLight(mq.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, [mq]);
  useEffect(() => {
    const r = document.documentElement;
    if (pref === 'system') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', pref);
    try { localStorage.setItem('at-theme', pref); } catch { /* 저장 불가 */ }
  }, [pref]);
  const dark = pref === 'system' ? !sysLight : pref === 'dark';
  const toggle = () => setPref(dark ? 'light' : 'dark');
  return { dark, toggle };
}

export const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/* ───── domain constants ───── */
export const MODULE_VAR: Record<string, string> = {
  '포토': '--m-photo', '식각': '--m-etch', '증착': '--m-dep', 'CMP': '--m-cmp', '확산·주입': '--m-imp', '세정': '--m-clean',
};
export const moduleVar = (m: string) => `var(${MODULE_VAR[m] ?? '--muted'})`;
export const SEV_VAR: Record<Sev | 'OK', string> = { CRIT: '--crit', HIGH: '--high', MED: '--med', LOW: '--aqua', OK: '--ok' };
export const sevColor = (s: Sev | 'OK') => `var(${SEV_VAR[s]})`;
export const SEV_LABEL: Record<Sev, string> = { CRIT: '치명', HIGH: '높음', MED: '보통', LOW: '낮음' };
export const SEVS: Sev[] = ['CRIT', 'HIGH', 'MED', 'LOW'];
export const LEVEL_VAR: Record<Level, string> = { '위험': '--crit', '경고': '--high', '주의': '--med', '양호': '--ok' };
export const levelColor = (l: Level) => `var(${LEVEL_VAR[l]})`;
export const CAT_ORDER: Category[] = ['spec', 'process', 'interlock', 'detect', 'tttm', 'equip', 'maint', 'cttm', 'racb', 'change'];
export const CAT_NAME: Record<Category, string> = { spec: '타겟표준', process: '공정능력', interlock: '인터락', detect: 'FDC/NPW 기준', tttm: '설비 출력 TTTM', equip: '호환설비 구성', maint: 'PM/BM', cttm: 'CTTTM', racb: 'RACB', change: '설비·레시피 변경' };

/** 점검 항목이 아직 연결되지 않았는지 (판정 규칙이 없거나 원천 테이블이 없음) */
export const isPending = (meta: { rules: { category: string }[]; pending?: Partial<Record<string, string>> }, c: string) =>
  !!meta.pending?.[c] || !meta.rules.some((r) => r.category === c);

/* ───── formatting ───── */
export const fmtN = (n: number | undefined | null) => (n == null ? '-' : n.toLocaleString('ko-KR'));
export const fmtDT = (s?: string | null) => (s ? s.replace('T', ' ').slice(0, 16) : '-');
export const fmtD = (s?: string | null) => (s ? s.slice(0, 10) : '-');
export const fmtMD = (s?: string | null) => (s ? `${s.slice(5, 10)} ${s.slice(11, 16)}` : '-');
export const num = (v: number | undefined | null, d = 2) => (v == null ? '-' : Number(v.toFixed(d)).toString());

export function daysBetween(a: string, b: string) {
  return (new Date(b).getTime() - new Date(a).getTime()) / 864e5;
}

export function downloadCsv(name: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ───── tooltip (single floating element) ───── */
export function showTip(e: { clientX: number; clientY: number }, html: string) {
  const t = document.getElementById('tip');
  if (!t) return;
  t.innerHTML = html;
  t.style.opacity = '1';
  const w = t.offsetWidth, h = t.offsetHeight;
  let x = e.clientX + 14, y = e.clientY + 14;
  if (x + w > innerWidth - 8) x = e.clientX - w - 14;
  if (y + h > innerHeight - 8) y = e.clientY - h - 14;
  t.style.left = `${x}px`;
  t.style.top = `${y}px`;
}
export function hideTip() {
  const t = document.getElementById('tip');
  if (t) t.style.opacity = '0';
}
export const escHtml = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
