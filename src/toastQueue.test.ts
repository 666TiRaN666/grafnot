import { describe, expect, it } from 'vitest';
import { TOAST_ACTION_MS, TOAST_MS, TOAST_QUEUED, createToastQueue } from './toastQueue';
import type { ToastMsg, ToastSession } from './toastQueue';

/** A queue on a hand-driven clock. */
function setup() {
  let now = 0;
  let seq = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  const clock = {
    now: () => now,
    setTimeout: (fn: () => void, ms: number) => { seq += 1; due.set(seq, { at: now + ms, fn }); return seq; },
    clearTimeout: (id: number) => { due.delete(id); },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, t] of [...due]) if (t.at <= now) { due.delete(id); t.fn(); }
  };
  let items: ToastMsg[] = [];
  const session: ToastSession = { epoch: 0, profileId: 'p1' };
  const q = createToastQueue({ onChange: (x) => { items = x; }, session: () => session, clock });
  return { q, advance, session, texts: () => items.map((x) => x.text), items: () => items, pending: () => due.size };
}

describe('toast queue', () => {
  it('one message per event: the same plain text is not stacked', () => {
    const t = setup();
    t.q.notify('Saved');
    t.q.notify('Saved');
    expect(t.texts()).toEqual(['Saved']);
  });

  it('keeps the newest few; plain toasts hide after their time, action toasts after the Undo window', () => {
    const t = setup();
    for (let i = 1; i <= TOAST_QUEUED + 2; i++) t.q.notify(`m${i}`);
    expect(t.texts()).toHaveLength(TOAST_QUEUED);
    expect(t.texts()[0]).toBe('m3');
    t.q.notifyAction('Deleted', 'Undo', () => {});
    t.advance(TOAST_MS);
    expect(t.texts()).toEqual(['Deleted']);
    t.advance(TOAST_ACTION_MS - TOAST_MS);
    expect(t.texts()).toEqual([]);
    expect(t.pending()).toBe(0);
  });

  it('hover pauses the auto-hide and leaving resumes it with the time left', () => {
    const t = setup();
    t.q.notify('Long');
    const id = t.items()[0]?.id ?? -1;
    t.advance(1000);
    t.q.hover(id, true);
    t.advance(10_000);
    expect(t.texts()).toEqual(['Long']);
    t.q.hover(id, false);
    t.advance(TOAST_MS - 1000 - 1);
    expect(t.texts()).toEqual(['Long']);
    t.advance(1);
    expect(t.texts()).toEqual([]);
  });
});

describe('deferred actions (Undo) stay in their store session', () => {
  it('runs in the session that armed it, once', () => {
    const t = setup();
    let runs = 0;
    t.q.notifyAction('Deleted', 'Undo', () => { runs += 1; });
    const id = t.items()[0]?.id ?? -1;
    t.q.fire(id, 'gone');
    t.q.fire(id, 'gone');
    expect(runs).toBe(1);
    expect(t.texts()).toEqual([]);
  });

  it('after a profile switch or a new session it does not run and says so', () => {
    const t = setup();
    let runs = 0;
    t.q.notifyAction('Deleted', 'Undo', () => { runs += 1; });
    const id = t.items()[0]?.id ?? -1;
    t.session.profileId = 'p2';
    t.q.fire(id, 'gone');
    expect(runs).toBe(0);
    expect(t.texts()).toEqual(['gone']);
  });

  it('ending the session drops pending actions visibly; expired or closed ones are not reported', () => {
    const t = setup();
    t.q.notifyAction('Old', 'Undo', () => {});
    t.advance(TOAST_ACTION_MS);
    t.q.notifyAction('Closed', 'Undo', () => {});
    t.q.close(t.items()[0]?.id ?? -1);
    t.q.dropActions('gone');
    expect(t.texts()).toEqual([]);
    t.q.notifyAction('Live', 'Undo', () => {});
    t.q.dropActions('gone');
    expect(t.texts()).toEqual(['gone']);
  });
});
