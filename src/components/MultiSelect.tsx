import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

interface MultiSelectProps {
  options: string[];
  /** Selected options; empty means "all". */
  value: string[];
  onChange: (value: string[]) => void;
  /** Plural noun for the button and placeholder, e.g. "warehouses". */
  noun: string;
  className?: string;
}

/** Dropdown of checkboxes. Nothing ticked = no filter ("All <noun>"). */
export const MultiSelect: React.FC<MultiSelectProps> = ({ options, value, onChange, noun, className = "" }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = new Set(value);
  const toggle = (option: string) => onChange(selected.has(option) ? value.filter((v) => v !== option) : [...value, option]);
  const term = query.trim().toLowerCase();
  const visible = term ? options.filter((o) => o.toLowerCase().includes(term)) : options;
  const label = value.length === 0 ? `All ${noun}` : value.length === 1 ? value[0] : `${value.length} ${noun}`;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border bg-white px-2.5 py-1.5 text-left text-xs text-gray-900 focus:border-emerald-400 focus:outline-none ${
          value.length ? "border-emerald-300" : "border-gray-200"
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={value.join(", ") || undefined}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className={`h-3.5 w-3.5 flex-shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 z-30 mt-1 w-full min-w-[240px] max-w-[calc(100vw-2rem)] rounded-lg border border-gray-200 bg-white p-2 shadow-card-hover">
          {options.length > 8 && (
            <div className="relative mb-2">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${noun}…`}
                className="w-full rounded-md border border-gray-200 bg-white py-1.5 pl-7 pr-2 text-xs text-gray-900 focus:border-emerald-400 focus:outline-none"
              />
            </div>
          )}
          <div className="mb-1 flex items-center justify-between px-1 text-xs">
            <button type="button" onClick={() => onChange(Array.from(new Set([...value, ...visible])))} className="font-semibold text-emerald-700 hover:underline">
              Select {term ? "shown" : "all"}
            </button>
            <button type="button" onClick={() => onChange([])} disabled={!value.length} className="font-semibold text-gray-500 hover:text-gray-900 disabled:opacity-40">
              Clear
            </button>
          </div>
          <ul role="listbox" aria-multiselectable="true" className="max-h-64 overflow-y-auto">
            {visible.map((option) => {
              const checked = selected.has(option);
              return (
                <li key={option}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={checked}
                    onClick={() => toggle(option)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-gray-900 hover:bg-gray-50"
                  >
                    <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${checked ? "border-emerald-600 bg-emerald-600 text-white" : "border-gray-300"}`}>
                      {checked && <Check className="h-3 w-3" />}
                    </span>
                    <span className="truncate" title={option}>{option}</span>
                  </button>
                </li>
              );
            })}
            {visible.length === 0 && <li className="px-2 py-2 text-xs text-gray-500">No {noun} found.</li>}
          </ul>
        </div>
      )}
    </div>
  );
};
