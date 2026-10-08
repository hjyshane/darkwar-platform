import { describe, expect, it } from 'vitest';
import { CSV_BOM, type CsvColumn, toCsv } from './csv';

interface Row {
  name: string | null;
  power: number | null;
}

const columns: CsvColumn<Row>[] = [
  { header: 'Name', value: (row) => row.name },
  { header: 'Power', value: (row) => row.power },
];

describe('toCsv', () => {
  it('writes a header and one line per row, CRLF separated, with a BOM', () => {
    const csv = toCsv([{ name: 'Duck', power: 286 }], columns);
    expect(csv).toBe(`${CSV_BOM}Name,Power\r\nDuck,286`);
  });

  it('writes only the header for no rows', () => {
    expect(toCsv([], columns)).toBe(`${CSV_BOM}Name,Power`);
  });

  it('leaves a missing value empty, not "null" and not 0', () => {
    expect(toCsv([{ name: null, power: null }], columns)).toBe(`${CSV_BOM}Name,Power\r\n,`);
  });

  it('keeps a real zero', () => {
    expect(toCsv([{ name: 'A', power: 0 }], columns)).toBe(`${CSV_BOM}Name,Power\r\nA,0`);
  });

  it('quotes commas, quotes and newlines, doubling inner quotes', () => {
    const csv = toCsv(
      [
        { name: 'a,b', power: 1 },
        { name: 'say "hi"', power: 2 },
        { name: 'two\nlines', power: 3 },
      ],
      columns,
    );
    expect(csv).toBe(`${CSV_BOM}Name,Power\r\n"a,b",1\r\n"say ""hi""",2\r\n"two\nlines",3`);
  });

  it('passes Korean, Chinese and emoji through untouched', () => {
    const csv = toCsv([{ name: '名揚四海 가나다 🐺', power: 5 }], columns);
    expect(csv).toContain('名揚四海 가나다 🐺,5');
  });

  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx'])(
    'defuses a text cell that a spreadsheet would run as a formula: %j',
    (name) => {
      const line = toCsv([{ name, power: 1 }], columns).split('\r\n')[1] ?? '';
      expect(line.startsWith("'") || line.startsWith('"\'')).toBe(true);
    },
  );

  it('does not touch a negative NUMBER, only text', () => {
    expect(toCsv([{ name: 'A', power: -5 }], columns)).toBe(`${CSV_BOM}Name,Power\r\nA,-5`);
  });

  it('quotes a header that needs it', () => {
    const csv = toCsv([], [{ header: 'Power, total', value: () => null }]);
    expect(csv).toBe(`${CSV_BOM}"Power, total"`);
  });
});
