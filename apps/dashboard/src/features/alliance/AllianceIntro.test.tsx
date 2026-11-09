import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AllianceIntroView, IntroText } from './AllianceIntro';

afterEach(cleanup);

const RBRN_565 = '00000000-0000-4000-8000-000000000565';
const SYNN_570 = '00000000-0000-4000-8000-000000000570';
const KNOWN = [
  { allianceId: RBRN_565, serverId: 565, code: 'RBRN' },
  { allianceId: SYNN_570, serverId: 570, code: 'SYNN' },
];

describe('IntroText', () => {
  it('links a known tag to its alliance page and keeps the line as written', () => {
    const { container } = render(<IntroText known={KNOWN} text="565 RBRN / 570 SYNN RYSE" />);
    const links = [...container.querySelectorAll('a')];
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['RBRN', `#/alliance/${RBRN_565}`],
      ['SYNN', `#/alliance/${SYNN_570}`],
    ]);
    expect(container.querySelector('.intro-line')?.textContent).toBe('565 RBRN / 570 SYNN RYSE');
  });

  it('leaves an unknown tag and a tag from another server as text', () => {
    const { container } = render(<IntroText known={KNOWN} text="571 SYNN / 565 ZZZZ" />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toBe('571 SYNN / 565 ZZZZ');
  });

  it('keeps one paragraph per line, blank lines included', () => {
    const { container } = render(<IntroText known={[]} text={'Welcome\n\nBe kind'} />);
    const lines = [...container.querySelectorAll('.intro-line')];
    expect(lines.map((line) => line.textContent)).toEqual(['Welcome', '', 'Be kind']);
  });
});

describe('AllianceIntroView', () => {
  it('shows the intro alone when the announcement is withheld', () => {
    const { container } = render(<AllianceIntroView announce={null} intro="hello" known={[]} />);
    expect([...container.querySelectorAll('h2, h3')].map((h) => h.textContent)).toEqual(['Intro']);
  });

  it('shows the announcement under the intro for a member', () => {
    const { container } = render(
      <AllianceIntroView announce="rally at 20" intro="hello" known={[]} />,
    );
    expect([...container.querySelectorAll('h2, h3')].map((h) => h.textContent)).toEqual([
      'Intro',
      'Announcement · members only',
    ]);
    expect(container.textContent).toContain('rally at 20');
  });

  it('renders nothing when the alliance has written neither', () => {
    const { container } = render(<AllianceIntroView announce={null} intro={null} known={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('leads with the announcement heading when there is no intro', () => {
    const { container } = render(
      <AllianceIntroView announce="only this" intro={null} known={[]} />,
    );
    expect([...container.querySelectorAll('h2, h3')].map((h) => h.textContent)).toEqual([
      'Announcement · members only',
    ]);
  });
});
