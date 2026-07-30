"use client";

// Small shared UI building blocks used by both the search page and the
// Profile page — kept dependency-free (no app-specific types) so either
// page can import freely.

export function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-md px-3 py-1.5 text-sm transition ${
        active ? "bg-raised text-bright" : "text-soft hover:text-bright"
      }`}
    >
      {children}
    </button>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.15em] text-soft">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-line bg-ink px-3.5 py-2.5 text-bright outline-none transition placeholder:text-soft/50 focus:border-beacon/60"
      />
    </label>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  rows = 4,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.15em] text-soft">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="w-full resize-none rounded-lg border border-line bg-ink px-3.5 py-2.5 text-sm leading-relaxed text-bright outline-none transition placeholder:text-soft/50 focus:border-beacon/60"
      />
    </label>
  );
}

// A labeled list of free-text entries with add/remove — used for Links,
// Skills, and Education (all "just a list of strings"). `pill` renders each
// entry as a compact, auto-width chip (input + × combined in one rounded
// container) instead of a full-width row — suited to short entries like
// Skills; leave off for longer free text like Links or Education lines.
export function ListField({
  label,
  items,
  onChange,
  placeholder,
  addLabel,
  pill = false,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  addLabel: string;
  pill?: boolean;
}) {
  function update(i: number, value: string) {
    const next = [...items];
    next[i] = value;
    onChange(next);
  }
  function remove(i: number) {
    onChange(items.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange([...items, ""]);
  }

  const pillItem = (item: string, i: number) => (
    <div
      key={i}
      className="flex w-fit items-center gap-1.5 rounded-full border border-line bg-ink py-1.5 pl-3 pr-1.5"
    >
      <input
        value={item}
        onChange={(e) => update(i, e.target.value)}
        placeholder={placeholder}
        size={Math.max(item.length, 3) + 1}
        className="bg-transparent text-sm leading-none text-bright outline-none placeholder:text-soft/50"
      />
      <button
        onClick={() => remove(i)}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs text-soft hover:bg-weak/20 hover:text-weak"
        aria-label="Remove"
      >
        ✕
      </button>
    </div>
  );

  const rowItem = (item: string, i: number) => (
    <div key={i} className="flex gap-2">
      <input
        value={item}
        onChange={(e) => update(i, e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-line bg-ink px-3 py-2 text-sm text-bright outline-none focus:border-beacon/60"
      />
      <button
        onClick={() => remove(i)}
        className="shrink-0 rounded-lg border border-line px-2.5 text-sm text-soft hover:text-weak"
      >
        ✕
      </button>
    </div>
  );

  return (
    <div>
      <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.15em] text-soft">{label}</span>
      {pill ? (
        <div className="flex flex-wrap items-center gap-2">
          {items.map(pillItem)}
          <button onClick={add} className="font-mono text-xs text-soft hover:text-beacon">
            {addLabel}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(rowItem)}
          <button onClick={add} className="font-mono text-xs text-soft hover:text-beacon">
            {addLabel}
          </button>
        </div>
      )}
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-md rounded-2xl border border-line bg-surface p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-base font-semibold text-bright">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-soft">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg border border-line px-3.5 py-2 text-sm text-soft transition hover:text-bright"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg bg-beacon px-3.5 py-2 text-sm font-medium text-ink transition hover:brightness-105"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-5 right-5 z-[70] max-w-sm animate-fadeIn">
      <div className="flex items-start gap-3 rounded-lg border border-line bg-raised px-4 py-3 shadow-lg shadow-black/40">
        <p className="text-sm text-bright/90">{message}</p>
        <button onClick={onClose} className="shrink-0 text-soft transition hover:text-bright" aria-label="Dismiss">
          ✕
        </button>
      </div>
    </div>
  );
}
