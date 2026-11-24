const TONE = {
  booked: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  completed: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200",
  cancelled: "bg-black/10 line-through opacity-70",
  no_show: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
} as const;

export type AppointmentStatus = keyof typeof TONE;

/** Colour is never the only signal: the label is always there too. */
export function StatusBadge({ status, label }: { status: AppointmentStatus; label: string }) {
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${TONE[status]}`}>{label}</span>;
}
