// @vitest-environment jsdom
/**
 * Input System — unit tests
 * GDD acceptance criteria: design/gdd/input-system.md
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InputSystem, InputAction } from './input-system';

// Helpers ─────────────────────────────────────────────────────────────────────

function keyDown(code: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
}

function keyUp(code: string): void {
  window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
}

function blur(): void {
  window.dispatchEvent(new Event('blur'));
}

// Each test gets a fresh, enabled InputSystem wired to the jsdom window.
let input: InputSystem;
beforeEach(() => {
  input = new InputSystem(window);
  input.enable();
});
afterEach(() => {
  input.destroy();
});

// ── Key bindings ──────────────────────────────────────────────────────────────

describe('key bindings', () => {
  it('ArrowLeft → LANE_LEFT', () => {
    const listener = vi.fn();
    input.on(listener);
    keyDown('ArrowLeft');
    expect(listener).toHaveBeenCalledWith(InputAction.LaneLeft);
  });

  it('KeyA → LANE_LEFT', () => {
    const listener = vi.fn();
    input.on(listener);
    keyDown('KeyA');
    expect(listener).toHaveBeenCalledWith(InputAction.LaneLeft);
  });

  it('ArrowRight → LANE_RIGHT', () => {
    const listener = vi.fn();
    input.on(listener);
    keyDown('ArrowRight');
    expect(listener).toHaveBeenCalledWith(InputAction.LaneRight);
  });

  it('KeyD → LANE_RIGHT', () => {
    const listener = vi.fn();
    input.on(listener);
    keyDown('KeyD');
    expect(listener).toHaveBeenCalledWith(InputAction.LaneRight);
  });

  it('ArrowUp → JUMP', () => {
    const listener = vi.fn();
    input.on(listener);
    keyDown('ArrowUp');
    expect(listener).toHaveBeenCalledWith(InputAction.Jump);
  });

  it('KeyW → JUMP', () => {
    const listener = vi.fn();
    input.on(listener);
    keyDown('KeyW');
    expect(listener).toHaveBeenCalledWith(InputAction.Jump);
  });

  it('Space → JUMP', () => {
    const listener = vi.fn();
    input.on(listener);
    keyDown('Space');
    expect(listener).toHaveBeenCalledWith(InputAction.Jump);
  });

  it('ArrowDown → SLIDE', () => {
    const listener = vi.fn();
    input.on(listener);
    keyDown('ArrowDown');
    expect(listener).toHaveBeenCalledWith(InputAction.Slide);
  });

  it('KeyS → SLIDE', () => {
    const listener = vi.fn();
    input.on(listener);
    keyDown('KeyS');
    expect(listener).toHaveBeenCalledWith(InputAction.Slide);
  });

  it('unmapped key fires no action', () => {
    const listener = vi.fn();
    input.on(listener);
    keyDown('KeyZ');
    expect(listener).not.toHaveBeenCalled();
  });
});

// ── Key repeat suppression ────────────────────────────────────────────────────

describe('key repeat suppression', () => {
  it('holding a key does not repeat the action', () => {
    const listener = vi.fn();
    input.on(listener);
    keyDown('ArrowLeft');
    keyDown('ArrowLeft'); // simulated browser repeat — same key, no keyup in between
    keyDown('ArrowLeft');
    expect(listener).toHaveBeenCalledOnce();
  });

  it('re-pressing a key after release fires again', () => {
    const listener = vi.fn();
    input.on(listener);
    keyDown('ArrowLeft');
    keyUp('ArrowLeft');
    keyDown('ArrowLeft');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

// ── Simultaneous keys ─────────────────────────────────────────────────────────

describe('simultaneous keys', () => {
  it('JUMP and LANE_LEFT pressed simultaneously each emit independently', () => {
    const listener = vi.fn();
    input.on(listener);
    keyDown('ArrowUp');
    keyDown('ArrowLeft');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledWith(InputAction.Jump);
    expect(listener).toHaveBeenCalledWith(InputAction.LaneLeft);
  });
});

// ── enable / disable ──────────────────────────────────────────────────────────

describe('enable / disable', () => {
  it('when disabled, no actions fire', () => {
    const listener = vi.fn();
    input.on(listener);
    input.disable();
    keyDown('ArrowLeft');
    keyDown('Space');
    expect(listener).not.toHaveBeenCalled();
  });

  it('enable() is idempotent — no duplicate events from calling twice', () => {
    const listener = vi.fn();
    input.on(listener);
    input.enable(); // already enabled; second call is a no-op
    input.enable();
    keyDown('ArrowLeft');
    expect(listener).toHaveBeenCalledOnce();
  });

  it('disable() is idempotent — no errors from calling twice', () => {
    input.disable();
    expect(() => input.disable()).not.toThrow();
  });

  it('re-enabling after disable resumes action emission', () => {
    const listener = vi.fn();
    input.on(listener);
    input.disable();
    keyDown('ArrowLeft');
    input.enable();
    keyDown('ArrowRight');
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(InputAction.LaneRight);
  });
});

// ── Blur / focus ──────────────────────────────────────────────────────────────

describe('blur clears key state', () => {
  it('a key held through a blur does not suppress the next press', () => {
    const listener = vi.fn();
    input.on(listener);
    keyDown('ArrowLeft');     // press — fires once
    blur();                   // focus lost, key state cleared
    keyDown('ArrowLeft');     // press again — should fire again (not suppressed)
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('blur while disabled does not cause phantom actions on focus return', () => {
    const listener = vi.fn();
    input.on(listener);
    input.disable();
    keyDown('ArrowLeft');
    blur();
    input.enable();
    // No action should have queued up — pressing a different key after re-enable works normally
    keyDown('ArrowRight');
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(InputAction.LaneRight);
  });
});
