'use client';
import { useCallback, useEffect, useState } from 'react';

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth')) window.location.href = '/login';
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data as T;
}

export function useApi<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!path) return;
    try { setData(await api<T>(path)); setError(null); } catch (e: any) { setError(e.message); }
  }, [path]);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, reload };
}

const IST = 'Asia/Kolkata';
export const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: IST }).format(new Date());
export const monthIST = () => todayIST().slice(0, 7);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDate = (d?: string | null) => {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day} ${MONTHS[Number(m) - 1]} ${y}`;
};
export const fmtMonth = (m: string) => {
  const [y, mm] = m.split('-');
  return `${MONTHS[Number(mm) - 1]} ${y}`;
};
export const fmtTime = (iso?: string | null) =>
  iso ? new Intl.DateTimeFormat('en-IN', { timeZone: IST, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)) : '—';
export const fmtDateTime = (iso?: string | null) =>
  iso ? new Intl.DateTimeFormat('en-IN', { timeZone: IST, day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)) : '—';
export const inr = (n?: number | null) =>
  '₹' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Number(n ?? 0));
export const daysFromToday = (d?: string | null) => {
  if (!d) return null;
  return Math.round((Date.parse(d.slice(0, 10)) - Date.parse(todayIST())) / 86400000);
};
export const waNumber = (phone?: string | null) => {
  const digits = (phone || '').replace(/\D/g, '');
  return digits.length === 10 ? `91${digits}` : digits;
};
export const waLink = (phone?: string | null, text?: string) =>
  `https://wa.me/${waNumber(phone)}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

export function downloadCsv(name: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const heads = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [heads.map(esc).join(','), ...rows.map((r) => heads.map((h) => esc(r[h])).join(','))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  a.download = `${name}.csv`;
  a.click();
}

/** Same arithmetic as the server, for showing the bill total before saving. */
export function billTotal(s: any, gross: number, discount: number, rate?: number) {
  const net = Math.max(0, gross - (discount || 0));
  if (!s || !s.gst_enabled || s.prices_include_gst) return net;
  const r = rate ?? s.default_gst_rate;
  return Math.round(net * 100 + (net * 100 * r) / 100) / 100;
}

export function toast(message: string, kind: 'ok' | 'error' = 'ok') {
  window.dispatchEvent(new CustomEvent('gp-toast', { detail: { message, kind } }));
}

/** URL of a stored photo. v changes whenever the photo does, so browsers never show an old one. */
export const photoUrl = (kind: 'member' | 'user' | 'gym', id: number | string, v?: number | string | null) =>
  v ? `/api/photos/${kind}/${id}?v=${v}` : null;

/** Shrinks a photo in the browser (largest side 480px, JPEG) so it uploads fast and stores small. */
export async function resizeImage(file: File, max = 480): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose a photo');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('This photo could not be opened. Try a JPG or PNG.'));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Reads a CSV file (as saved by Excel or Google Sheets) into rows of text. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}
