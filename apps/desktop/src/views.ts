// A small view registry: exactly one registered view is visible at a time.
// Showing a view hides every other registered view and runs exit/enter
// hooks, so a screen's setup (a poll, a subscription, anything that needs
// tearing down) lives with that screen instead of being hand-copied into
// every tab-switch handler. Three more screens are about to be added; the
// first one that forgets to stop what it started leaves it running under a
// view nobody can see.
//
// This is a registry, not a router: no URL, no history, no nesting — just
// "here are the screens, show me one of them."

export interface View {
  /** Unique id used to address this view from show(). */
  readonly id: string;
  /** The view's root element. Hidden on register(), shown by show(id). */
  readonly el: HTMLElement;
  /** Runs after the view becomes visible. */
  onEnter?: () => void;
  /** Runs just before the view is hidden. A throwing onExit must not stop
   * the next view from showing — a broken teardown must never trap the
   * player on the screen they are trying to leave. */
  onExit?: () => void;
}

export class ViewRegistry {
  private readonly views = new Map<string, View>();
  private activeId: string | null = null;

  /** Adds a view to the registry and hides its element. Call show() to
   * make one visible — nothing is shown until then. */
  register(view: View): void {
    this.views.set(view.id, view);
    view.el.hidden = true;
  }

  /** Shows the view registered under `id`. Hides every other registered
   * view first, then runs the outgoing view's onExit (if any) and the
   * incoming view's onEnter (if any).
   *
   * Showing the view that is already active is a no-op — it does not hide,
   * re-show, or re-run onEnter. Showing an id nothing was registered under
   * logs the mistake and leaves the current view exactly as it was, rather
   * than blanking the screen. */
  show(id: string): void {
    const next = this.views.get(id);
    if (next === undefined) {
      console.error(`views: show() called with unknown id "${id}"`);
      return;
    }
    if (id === this.activeId) {
      return;
    }

    const previous = this.activeId !== null ? this.views.get(this.activeId) : undefined;

    for (const view of this.views.values()) {
      if (view.id !== id) {
        view.el.hidden = true;
      }
    }

    if (previous !== undefined) {
      try {
        previous.onExit?.();
      } catch (error) {
        console.error(`views: onExit for "${previous.id}" threw`, error);
      }
    }

    this.activeId = id;
    next.el.hidden = false;
    next.onEnter?.();
  }
}
