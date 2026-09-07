import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type View, ViewRegistry } from './views';

interface Spied {
  view: View;
  el: HTMLElement;
  onEnter: ReturnType<typeof vi.fn>;
  onExit: ReturnType<typeof vi.fn>;
}

function makeView(id: string): Spied {
  const el = document.createElement('div');
  const onEnter = vi.fn();
  const onExit = vi.fn();
  return { view: { id, el, onEnter, onExit }, el, onEnter, onExit };
}

describe('ViewRegistry', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('hides a view element as soon as it is registered', () => {
    const registry = new ViewRegistry();
    const a = makeView('a');
    registry.register(a.view);
    expect(a.el.hidden).toBe(true);
    expect(a.onEnter).not.toHaveBeenCalled();
  });

  it('shows a view and runs its onEnter', () => {
    const registry = new ViewRegistry();
    const a = makeView('a');
    registry.register(a.view);

    registry.show('a');

    expect(a.el.hidden).toBe(false);
    expect(a.onEnter).toHaveBeenCalledTimes(1);
  });

  it("runs the outgoing view's onExit when switching to another view", () => {
    const registry = new ViewRegistry();
    const a = makeView('a');
    const b = makeView('b');
    registry.register(a.view);
    registry.register(b.view);

    registry.show('a');
    registry.show('b');

    expect(a.onExit).toHaveBeenCalledTimes(1);
    expect(a.el.hidden).toBe(true);
    expect(b.onEnter).toHaveBeenCalledTimes(1);
    expect(b.el.hidden).toBe(false);
  });

  it('does not re-enter a view that is already showing', () => {
    const registry = new ViewRegistry();
    const a = makeView('a');
    registry.register(a.view);

    registry.show('a');
    registry.show('a');

    expect(a.onEnter).toHaveBeenCalledTimes(1);
  });

  it('still shows the next view when the outgoing onExit throws', () => {
    const registry = new ViewRegistry();
    const a = makeView('a');
    a.view.onExit = vi.fn(() => {
      throw new Error('teardown broke');
    });
    const b = makeView('b');
    registry.register(a.view);
    registry.register(b.view);
    registry.show('a');

    expect(() => registry.show('b')).not.toThrow();

    expect(a.view.onExit).toHaveBeenCalledTimes(1);
    expect(a.el.hidden).toBe(true);
    expect(b.onEnter).toHaveBeenCalledTimes(1);
    expect(b.el.hidden).toBe(false);
  });

  it('leaves the current view untouched when show() is given an unknown id', () => {
    const registry = new ViewRegistry();
    const a = makeView('a');
    registry.register(a.view);
    registry.show('a');

    registry.show('does-not-exist');

    expect(a.el.hidden).toBe(false);
    expect(a.onEnter).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('tolerates views with no onEnter/onExit at all', () => {
    const registry = new ViewRegistry();
    const el = document.createElement('div');
    registry.register({ id: 'plain', el });

    expect(() => registry.show('plain')).not.toThrow();
    expect(el.hidden).toBe(false);
  });
});
