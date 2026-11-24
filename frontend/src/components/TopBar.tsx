import type { Meta } from '../types';
import { fmtDT } from '../lib';

type Props = {
  meta?: Meta; lineId: string; home: boolean; onHome: () => void; onLine: (id: string) => void; onSearch: () => void; onRules: () => void;
  onTheme: () => void; dataMode: 'api' | 'mock';
};

export const Logo = () => (
  <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
    <path d="M20 3 35 11.5v17L20 37 5 28.5v-17z" stroke="var(--accent)" strokeWidth="2.2" />
    <circle cx="18" cy="18" r="7.5" stroke="var(--accent)" strokeWidth="2.4" fill="var(--accent-a)" />
    <path d="m23.5 23.5 6 6" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
    <path d="m14.6 18.2 2.3 2.3 4.3-4.8" stroke="var(--ok)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function TopBar({ meta, lineId, home, onHome, onLine, onSearch, onRules, onTheme, dataMode }: Props) {
  const tabs = (meta?.lines ?? []).map((l) => ({ id: l.line_id, name: l.line_name.replace(/^FAB\d\s*/, ''), sub: l.tech ?? '', n: l.products }));
  return (
    <header className="topbar island">
      <div className="topbar-in">
        <button className="brand" onClick={onHome} aria-label="종합 대시보드로">
          <Logo />
          <span className="brand-txt"><span className="brand-name">AUDIT<b>PREVIEW</b></span><span className="brand-sub">Pre-Audit Data &amp; Insights</span></span>
        </button>
        <nav className="ltabs" aria-label="라인 선택">
          <button className="home" aria-pressed={home} onClick={onHome}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z" /></svg>
            종합<small>OVERVIEW</small>
          </button>
          {tabs.map((t) => (
            <button key={t.id} aria-pressed={lineId === t.id} onClick={() => onLine(t.id)} title={t.sub}>
              {t.name}{t.sub && <small>{t.sub}</small>}
              <span className="cnt" style={{ background: 'var(--ink-2)', color: 'var(--fg-2)' }} title="공법 수">{t.n}</span>
            </button>
          ))}
        </nav>
        <div className="tools">
          <button className="gsearch" onClick={onSearch} aria-label="공법·스텝·설비 검색">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
            <span>공법 · 스텝 · 설비 검색</span><kbd>Ctrl K</kbd>
          </button>
          <span className={`src${dataMode === 'mock' ? ' mock' : ''}`} title={meta ? `기준 ${fmtDT(meta.as_of)} · 최근 ${meta.window_days}일` : ''}>
            <i />{dataMode === 'mock' ? '샘플 데이터' : meta?.data_source === 'sql' ? 'DB 연결' : 'CSV 데이터'}
            {meta && <span className="mono">{fmtDT(meta.as_of)}</span>}
          </span>
          <button className="icon-btn" onClick={onRules} aria-label="리스크 판정 기준 보기">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 5h16M4 12h10M4 19h6" /><circle cx="18" cy="17" r="3" /></svg>
            <span className="lbl">판정 기준</span>
          </button>
          <button className="icon-btn" onClick={onTheme} aria-label="테마 전환">
            <svg className="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            <svg className="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>
          </button>
        </div>
      </div>
    </header>
  );
}
