import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatTile } from '../StatTile';
import { Cell, CellGrid } from './Cell';

afterEach(cleanup);

describe('Cell', () => {
  it('renders a dash for a null value and keeps the label', () => {
    render(<Cell label="Power" value={null} />);
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText('Power')).toBeTruthy();
  });

  it('puts the unit beside the value and the context under it', () => {
    const { container } = render(
      <Cell context="+5.31M over #2" label="Rank" unit="/204" value="#1" />,
    );
    expect(container.querySelector('.cell-value')?.textContent).toBe('#1/204');
    expect(container.querySelector('.cell-context')?.textContent).toBe('+5.31M over #2');
  });

  it('exposes tone and hero as data attributes', () => {
    const { container } = render(<Cell hero label="Power" tone="up" value="338M" />);
    const cell = container.querySelector('.cell');
    expect(cell?.getAttribute('data-tone')).toBe('up');
    expect(cell?.hasAttribute('data-hero')).toBe(true);
  });

  it('sets no tone attribute when none is given', () => {
    const { container } = render(<Cell label="HQ" value="55" />);
    const cell = container.querySelector('.cell');
    expect(cell?.hasAttribute('data-tone')).toBe(false);
    expect(cell?.hasAttribute('data-hero')).toBe(false);
  });

  it('renders spark under the context, hidden from assistive tech, and the note last', () => {
    const { container } = render(
      <Cell
        context="7d"
        label="Power"
        note="of 204"
        spark={<svg aria-label="trend" />}
        value="338M"
      />,
    );
    const classes = [...container.querySelectorAll('.cell > *')].map((n) => n.className);
    expect(classes).toEqual([
      'cell-label',
      'cell-value',
      'cell-context',
      'cell-spark',
      'cell-note',
    ]);
    expect(container.querySelector('.cell-spark')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('StatTile wrapper', () => {
  it('maps hero, note and spark onto Cell and keeps the legacy class names', () => {
    const { container } = render(
      <StatTile hero label="Power" note="of 204" spark={<svg />} value="338M" />,
    );
    expect(container.querySelector('.stat.stat-hero')).toBeTruthy();
    expect(container.querySelector('.stat-label')?.textContent).toBe('Power');
    expect(container.querySelector('.stat-value')?.textContent).toBe('338M');
    expect(container.querySelector('.stat-note')?.textContent).toBe('of 204');
    expect(container.querySelector('.stat-spark svg')).toBeTruthy();
    expect(container.querySelector('.cell')).toBeTruthy();
  });

  it('gives tone=flat no tone class and tone=up the legacy growth class', () => {
    const flat = render(<StatTile label="Δ" tone="flat" value="0" />);
    expect(flat.container.querySelector('.growth-up, .growth-down')).toBeNull();
    cleanup();
    const up = render(<StatTile label="Δ" tone="up" value="+1" />);
    expect(up.container.querySelector('.stat-value.growth-up')).toBeTruthy();
  });

  it('still shows a dash for null', () => {
    render(<StatTile label="Kills" value={null} />);
    expect(screen.getByText('—')).toBeTruthy();
  });
});

describe('CellGrid', () => {
  it('renders children inside .cell-grid', () => {
    const { container } = render(
      <CellGrid>
        <Cell label="A" value="1" />
      </CellGrid>,
    );
    expect(container.querySelectorAll('.cell-grid .cell').length).toBe(1);
  });

  it('passes a fixed column count through a custom property', () => {
    const { container } = render(
      <CellGrid columns={6}>
        <Cell label="A" value="1" />
      </CellGrid>,
    );
    expect(
      (container.querySelector('.cell-grid') as HTMLElement).style.getPropertyValue('--cols'),
    ).toBe('6');
  });
});
