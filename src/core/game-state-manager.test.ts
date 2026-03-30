/**
 * Game State Manager — unit tests
 * GDD acceptance criteria: design/gdd/game-state-manager.md
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameStateManager, GameState } from './game-state-manager';

// Each test gets a fresh instance so singleton state doesn't leak.
let gsm: GameStateManager;
beforeEach(() => {
  gsm = new GameStateManager();
});

// ── Initial state ─────────────────────────────────────────────────────────────

describe('initial state', () => {
  it('starts in Loading', () => {
    expect(gsm.current).toBe(GameState.Loading);
  });
});

// ── Valid transitions ─────────────────────────────────────────────────────────

describe('valid transitions', () => {
  it('Loading → MainMenu', () => {
    gsm.transition(GameState.MainMenu);
    expect(gsm.current).toBe(GameState.MainMenu);
  });

  it('MainMenu → Running', () => {
    gsm.transition(GameState.MainMenu);
    gsm.transition(GameState.Running);
    expect(gsm.current).toBe(GameState.Running);
  });

  it('MainMenu → Leaderboard', () => {
    gsm.transition(GameState.MainMenu);
    gsm.transition(GameState.Leaderboard);
    expect(gsm.current).toBe(GameState.Leaderboard);
  });

  it('Running → Dead', () => {
    gsm.transition(GameState.MainMenu);
    gsm.transition(GameState.Running);
    gsm.transition(GameState.Dead);
    expect(gsm.current).toBe(GameState.Dead);
  });

  it('Dead → ScoreScreen', () => {
    gsm.transition(GameState.MainMenu);
    gsm.transition(GameState.Running);
    gsm.transition(GameState.Dead);
    gsm.transition(GameState.ScoreScreen);
    expect(gsm.current).toBe(GameState.ScoreScreen);
  });

  it('ScoreScreen → Running', () => {
    gsm.transition(GameState.MainMenu);
    gsm.transition(GameState.Running);
    gsm.transition(GameState.Dead);
    gsm.transition(GameState.ScoreScreen);
    gsm.transition(GameState.Running);
    expect(gsm.current).toBe(GameState.Running);
  });

  it('ScoreScreen → MainMenu', () => {
    gsm.transition(GameState.MainMenu);
    gsm.transition(GameState.Running);
    gsm.transition(GameState.Dead);
    gsm.transition(GameState.ScoreScreen);
    gsm.transition(GameState.MainMenu);
    expect(gsm.current).toBe(GameState.MainMenu);
  });

  it('Leaderboard → MainMenu', () => {
    gsm.transition(GameState.MainMenu);
    gsm.transition(GameState.Leaderboard);
    gsm.transition(GameState.MainMenu);
    expect(gsm.current).toBe(GameState.MainMenu);
  });
});

// ── Invalid transitions ───────────────────────────────────────────────────────

describe('invalid transitions', () => {
  it('rejects Loading → Running (skips MainMenu)', () => {
    gsm.transition(GameState.Running);
    expect(gsm.current).toBe(GameState.Loading);
  });

  it('rejects Running → Leaderboard (not a valid exit)', () => {
    gsm.transition(GameState.MainMenu);
    gsm.transition(GameState.Running);
    gsm.transition(GameState.Leaderboard);
    expect(gsm.current).toBe(GameState.Running);
  });

  it('rejects Running → MainMenu directly', () => {
    gsm.transition(GameState.MainMenu);
    gsm.transition(GameState.Running);
    gsm.transition(GameState.MainMenu);
    expect(gsm.current).toBe(GameState.Running);
  });

  it('rejects Dead → Running directly (must go through ScoreScreen)', () => {
    gsm.transition(GameState.MainMenu);
    gsm.transition(GameState.Running);
    gsm.transition(GameState.Dead);
    gsm.transition(GameState.Running);
    expect(gsm.current).toBe(GameState.Dead);
  });

  it('fires no stateChanged event on invalid transition', () => {
    const listener = vi.fn();
    gsm.on(listener);
    gsm.transition(GameState.Running); // invalid from Loading
    expect(listener).not.toHaveBeenCalled();
  });
});

// ── Same-state transitions ────────────────────────────────────────────────────

describe('same-state transitions', () => {
  it('rejects Running → Running', () => {
    gsm.transition(GameState.MainMenu);
    gsm.transition(GameState.Running);
    const listener = vi.fn();
    gsm.on(listener);
    gsm.transition(GameState.Running);
    expect(listener).not.toHaveBeenCalled();
    expect(gsm.current).toBe(GameState.Running);
  });
});

// ── stateChanged event ────────────────────────────────────────────────────────

describe('stateChanged event', () => {
  it('fires with correct from/to on valid transition', () => {
    const listener = vi.fn();
    gsm.on(listener);
    gsm.transition(GameState.MainMenu);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({
      from: GameState.Loading,
      to:   GameState.MainMenu,
    });
  });

  it('fires all registered listeners', () => {
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    gsm.on(a);
    gsm.on(b);
    gsm.on(c);
    gsm.transition(GameState.MainMenu);
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
    expect(c).toHaveBeenCalledOnce();
  });

  it('does not fire removed listeners', () => {
    const listener = vi.fn();
    gsm.on(listener);
    gsm.off(listener);
    gsm.transition(GameState.MainMenu);
    expect(listener).not.toHaveBeenCalled();
  });
});

// ── Listener error isolation ──────────────────────────────────────────────────

describe('listener error isolation', () => {
  it('a throwing listener does not prevent subsequent listeners from running', () => {
    const thrower = vi.fn(() => { throw new Error('boom'); });
    const after   = vi.fn();
    gsm.on(thrower);
    gsm.on(after);
    expect(() => gsm.transition(GameState.MainMenu)).not.toThrow();
    expect(after).toHaveBeenCalledOnce();
  });

  it('state is updated even when a listener throws', () => {
    gsm.on(() => { throw new Error('boom'); });
    gsm.transition(GameState.MainMenu);
    expect(gsm.current).toBe(GameState.MainMenu);
  });
});

// ── Second collision guard (GDD edge case) ────────────────────────────────────

describe('collision guard', () => {
  it('second Running → Dead call is rejected once already Dead', () => {
    gsm.transition(GameState.MainMenu);
    gsm.transition(GameState.Running);
    gsm.transition(GameState.Dead); // first collision
    const listener = vi.fn();
    gsm.on(listener);
    gsm.transition(GameState.Dead); // second collision — must be rejected
    expect(listener).not.toHaveBeenCalled();
    expect(gsm.current).toBe(GameState.Dead);
  });
});
