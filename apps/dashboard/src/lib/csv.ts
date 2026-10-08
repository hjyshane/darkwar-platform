// CSV for a spreadsheet, from rows already on screen: no React, no queries.
//
// Three things here are not obvious.
//
// BOM. Excel opens a UTF-8 file as the local code page unless it begins with a
// byte-order mark, which turns every Korean and Chinese name into mojibake.
//
// FORMULA GUARD. Player and alliance names are typed by strangers. A name that
// starts with = + - @ (or tab / CR) is run as a formula when the file is
// opened, so TEXT cells get a leading apostrophe. NUMBERS are exempt: -5 is a
// number, not text, and must stay one.
//
// MISSING IS EMPTY. null and undefined become an empty cell, never "null" and
// never 0; a missing power is not a zero power.

export const CSV_BOM = '﻿';

export type CsvValue = string | number | boolean | null | undefined;

export interface CsvColumn<Row> {
  header: string;
  value: (row: Row) => CsvValue;
}

const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

function quote(text: string): string {
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function cell(value: CsvValue): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }
  const text = String(value);
  return quote(typeof value === 'string' && FORMULA_START.test(text) ? `'${text}` : text);
}

export function toCsv<Row>(rows: readonly Row[], columns: readonly CsvColumn<Row>[]): string {
  const header = columns.map((column) => quote(column.header)).join(',');
  const lines = rows.map((row) => columns.map((column) => cell(column.value(row))).join(','));
  return CSV_BOM + [header, ...lines].join('\r\n');
}

/** Hand `csv` to the browser as a download. Browser only. */
export function downloadCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
