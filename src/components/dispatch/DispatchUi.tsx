import React from "react";

export const Panel: React.FC<{
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}> = ({ title, subtitle, actions, className = "", children }) => (
  <section className={`rounded-card border border-gray-200 bg-white p-4 shadow-card sm:p-5 ${className}`}>
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>}
      </div>
      {actions}
    </div>
    {children}
  </section>
);

export const StatTile: React.FC<{
  label: string;
  value: string;
  hint?: string;
  tone?: "good" | "critical";
}> = ({ label, value, hint, tone }) => (
  <div className="rounded-card border border-gray-200 bg-white p-4 shadow-card">
    <p className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
      {tone && <span className={`h-2 w-2 rounded-full ${tone === "good" ? "bg-[#0ca30c]" : "bg-[#d03b3b]"}`} />}
      {label}
    </p>
    <p className="mt-1.5 break-words text-xl font-bold text-gray-900 sm:text-2xl">{value}</p>
    {hint && <p className="mt-1 text-[11px] leading-snug text-gray-500">{hint}</p>}
  </div>
);

export function SegmentedControl<T extends string>({ value, options, onChange }: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
            value === option.id ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
