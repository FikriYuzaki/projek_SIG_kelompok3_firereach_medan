export function formatNumber(value, options = {}) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }
  return new Intl.NumberFormat("id-ID", options).format(Number(value));
}

export function formatDate(value, options = {}) {
  if (!value) {
    return "-";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...options
  }).format(date);
}

export function formatDistance(meters) {
  if (meters === null || meters === undefined || Number.isNaN(Number(meters))) {
    return "-";
  }
  const num = Number(meters);
  if (Math.abs(num) >= 1000) {
    return `${formatNumber(num / 1000, { maximumFractionDigits: 2 })} km`;
  }
  return `${formatNumber(num, { maximumFractionDigits: 0 })} m`;
}

export const formatters = Object.freeze({
  number: formatNumber,
  date: formatDate,
  distance: formatDistance
});
