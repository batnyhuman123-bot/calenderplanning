import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { fillFor, inkFor, strokeFor } from '../domain/colors';
import type { Category, Priority, Task, TaskStatus } from '../domain/types';
import { PRIORITY_LABEL, STATUS_LABEL } from '../domain/types';
import { useStore } from '../data/store';
import { CatIcon, IAlert, IBlock, ICheck, IClock, IInfo, IPlay, IWarn, IX } from './Icons';

/** CSS variables for a category's pastel surface + derived inks. */
export function catVars(color: string): CSSProperties {
  return {
    ['--bar-bg' as any]: color,
    ['--bar-ink' as any]: inkFor(color),
    ['--bar-stroke' as any]: strokeFor(color),
    ['--bar-fill' as any]: fillFor(color),
    ['--chip-bg' as any]: color,
    ['--chip-ink' as any]: inkFor(color),
    ['--chip-stroke' as any]: strokeFor(color),
  };
}

export function CategoryChip({ cat }: { cat: Category }) {
  return (
    <span className="chip" style={catVars(cat.color)}>
      <CatIcon icon={cat.icon} size={11} /> {cat.name}
    </span>
  );
}

export function PriorityBadge({ p }: { p: Priority }) {
  return <span className={`badge prio-${p}`}>{p === 'critical' || p === 'high' ? '▲ ' : ''}{PRIORITY_LABEL[p]}</span>;
}

export function StatusIcon({ s, size = 12 }: { s: TaskStatus | 'overdue'; size?: number }) {
  switch (s) {
    case 'completed': return <ICheck size={size} />;
    case 'in_progress': return <IPlay size={size} />;
    case 'blocked': return <IBlock size={size} />;
    case 'overdue': return <IAlert size={size} />;
    case 'on_hold': return <IClock size={size} />;
    default: return null;
  }
}

export function StatusBadge({ t, overdue }: { t: Task; overdue?: boolean }) {
  return (
    <>
      <span className={`badge status-${t.status}`}><StatusIcon s={t.status} size={11} />{STATUS_LABEL[t.status]}</span>
      {overdue && <span className="badge overdue"><IAlert size={11} />Overdue</span>}
    </>
  );
}

export function Toggle({ id, checked, onChange, label, hint }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="toggle" htmlFor={id}>
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" aria-hidden="true" />
      <span className="tl"><strong>{label}</strong>{hint && <span>{hint}</span>}</span>
    </label>
  );
}

export function Field({ label, htmlFor, required, error, hint, children }: { label: string; htmlFor?: string; required?: boolean; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}{required && <span className="req" aria-hidden="true">*</span>}</label>
      {children}
      {error ? <span className="err" role="alert">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function useEscape(handler: () => void, active = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') ref.current(); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [active]);
}

/* ---------------- Confirm dialog (in-page; native confirm() is unavailable in hosted pages) ---------------- */

interface ConfirmOpts {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Optional extra choice, resolves 'alt'. */
  altLabel?: string;
}
type ConfirmResult = 'confirm' | 'alt' | 'cancel';
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<ConfirmResult>>(async () => 'cancel');
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (r: ConfirmResult) => void }) | null>(null);
  const ask = useCallback((o: ConfirmOpts) => new Promise<ConfirmResult>((resolve) => setState({ ...o, resolve })), []);
  const close = (r: ConfirmResult) => { state?.resolve(r); setState(null); };
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (state) btnRef.current?.focus(); }, [state]);
  useEscape(() => close('cancel'), !!state);
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      {state && (
        <div className="dialog-wrap" onMouseDown={(e) => e.target === e.currentTarget && close('cancel')}>
          <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
            <h2 id="confirm-title">{state.title}</h2>
            {state.message && <div style={{ color: 'var(--ink-2)' }}>{state.message}</div>}
            <div className="dialog-actions">
              <button className="btn" onClick={() => close('cancel')}>{state.cancelLabel ?? 'Cancel'}</button>
              {state.altLabel && <button className="btn" onClick={() => close('alt')}>{state.altLabel}</button>}
              <button ref={btnRef} className={state.danger ? 'btn btn-danger-solid' : 'btn btn-primary'} onClick={() => close('confirm')}>
                {state.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  );
}

/* ---------------- Toasts ---------------- */

export function Toasts() {
  const { toasts, dismissToast } = useStore();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span className="ti">{t.kind === 'success' ? <ICheck size={13} /> : t.kind === 'error' ? <IX size={13} /> : t.kind === 'warning' ? <IWarn size={13} /> : <IInfo size={13} />}</span>
          <span className="msg">{t.message}</span>
          {t.action && <button className="btn btn-sm btn-soft" onClick={() => { t.action!.run(); dismissToast(t.id); }}>{t.action.label}</button>}
          <button className="icon-btn" style={{ width: 22, height: 22 }} aria-label="Dismiss" onClick={() => dismissToast(t.id)}><IX size={13} /></button>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Popover anchored to a rect ---------------- */

export function Popover({ anchor, onClose, children, className = '', label }: { anchor: DOMRect; onClose: () => void; children: ReactNode; className?: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + 6 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    let left = Math.min(anchor.left, window.innerWidth - w - 16);
    left = Math.max(16, left);
    let top = anchor.bottom + 6;
    if (top + h > window.innerHeight - 16) top = Math.max(16, anchor.top - h - 6);
    setPos({ left, top });
  }, [anchor]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const t = setTimeout(() => document.addEventListener('mousedown', onDown));
    return () => { clearTimeout(t); document.removeEventListener('mousedown', onDown); };
  }, [onClose]);
  useEscape(onClose);
  return (
    <div ref={ref} className={`popover ${className}`} style={pos} role="dialog" aria-label={label}>
      {children}
    </div>
  );
}
