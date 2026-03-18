import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function shortAddress(value: string | null | undefined, size = 6): string {
  if (!value) {
    return "N/A";
  }
  if (value.length <= size * 2) {
    return value;
  }
  return `${value.slice(0, size)}...${value.slice(-size)}`;
}

function toEpochMs(value: string | number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }

  // Some sources provide seconds, others milliseconds.
  // Heuristic: anything >= 1e12 is already milliseconds.
  return numeric >= 1_000_000_000_000 ? numeric : numeric * 1000;
}

export function formatTimestamp(epoch: string | number): string {
  const date = new Date(toEpochMs(epoch));
  return Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
