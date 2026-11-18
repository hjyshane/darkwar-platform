// "View as": only an admin's role is replaced, and the banner offers the way back.
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  role: 'admin' as string,
  realRole: undefined as string | undefined,
}));
vi.mock('./useSession', async (original) => ({
  ...(await original<typeof import('./useSession')>()),
  useSession: () => ({
    data: { role: mock.role, realRole: mock.realRole, email: 'a@b', userId: 'u', playerId: null },
  }),
}));

import { PreviewBanner, ViewAsPicker } from '../components/ViewAs';
import { effectiveRole, getPreviewRole, setPreviewRole } from './previewRole';

afterEach(() => {
  setPreviewRole(null);
  mock.role = 'admin';
  mock.realRole = undefined;
});

describe('effectiveRole', () => {
  it('replaces only an admin', () => {
    expect(effectiveRole('admin', 'member')).toBe('member');
    expect(effectiveRole('admin', null)).toBe('admin');
    expect(effectiveRole('member', 'officer')).toBe('member');
    expect(effectiveRole('viewer', 'community')).toBe('viewer');
  });
});

describe('View as', () => {
  it('is not offered to anyone but an admin', () => {
    mock.role = 'officer';
    const { container } = render(<ViewAsPicker />);
    expect(container.innerHTML).toBe('');
  });

  it('shows a banner with the way back while previewing', () => {
    setPreviewRole('member');
    mock.role = 'member';
    mock.realRole = 'admin';
    render(<PreviewBanner />);
    expect(screen.getByText('Member view', { selector: 'strong' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Exit preview' }));
    expect(getPreviewRole()).toBeNull();
    expect(window.location.hash).toBe('#/admin');
  });

  it('shows no banner when nobody is previewing', () => {
    const { container } = render(<PreviewBanner />);
    expect(container.innerHTML).toBe('');
  });
});
