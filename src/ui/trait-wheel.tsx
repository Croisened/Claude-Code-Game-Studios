/**
 * TraitWheel — slot-machine-style drum that picks one of the five raw NFT
 * traits per race. The chosen trait drives `stat.speed` for that race only.
 *
 * Behaviour:
 *  1. On `spinKey` change, picks a random trait up-front (UI roll, NOT part of
 *     the sim's deterministic RNG).
 *  2. Spins for `SPIN_DURATION_MS`, decelerates over `DECEL_DURATION_MS`,
 *     lands on the chosen trait.
 *  3. Shows a "SPEED BONUS TO X" banner for `BANNER_DURATION_MS`, then
 *     calls `onCommit(trait)`.
 *
 * The drum is rendered as a vertically-translated strip of trait labels
 * inside an `overflow: hidden` window. The strip contains 3 copies of the
 * 5-trait list so wraparound during the spin is seamless.
 */

import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { SpeedSourceTrait } from '@/sim/trait-to-stat';

const TRAITS: readonly SpeedSourceTrait[] = [
  'fullSend',
  'degen',
  'cipher',
  'doubter',
  'altruist',
];

const TRAIT_LABELS: Record<SpeedSourceTrait, string> = {
  fullSend: 'FULL SEND',
  degen: 'DEGEN',
  cipher: 'CIPHER',
  doubter: 'DOUBTER',
  altruist: 'ALTRUIST',
};

const ITEM_HEIGHT = 44;
const WINDOW_WIDTH = 220;
const SPIN_DURATION_MS = 2500;
const DECEL_DURATION_MS = 700;
const BANNER_FADE_MS = 200;
const BANNER_HOLD_MS = 2600;
const BANNER_DURATION_MS = BANNER_FADE_MS * 2 + BANNER_HOLD_MS; // 3000ms total
const SPIN_SPEED_PX_PER_MS = 0.5;
const CYCLE = TRAITS.length * ITEM_HEIGHT;

const MONO_STACK = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

export interface TraitWheelProps {
  /** Bump this to start a fresh spin sequence. */
  readonly spinKey: number;
  /** Fired once after the wheel has landed AND the banner has finished. */
  readonly onCommit: (trait: SpeedSourceTrait) => void;
}

type Phase = 'spinning' | 'decelerating' | 'banner' | 'done';

/** Fisher-Yates shuffle. Mutates `arr`, returns it for chaining. */
function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function TraitWheel(props: TraitWheelProps): JSX.Element {
  const { spinKey, onCommit } = props;
  const [translateY, setTranslateY] = useState(0);
  const [picked, setPicked] = useState<SpeedSourceTrait | null>(null);
  const [phase, setPhase] = useState<Phase>('spinning');
  const [bannerOpacity, setBannerOpacity] = useState(0);
  // Trait order on the wheel is shuffled per spin so consecutive races
  // don't all show the same FULL SEND → DEGEN → ... cycle. The render
  // below reads this array, and the landing math indexes into it.
  const [wheelOrder, setWheelOrder] = useState<readonly SpeedSourceTrait[]>(TRAITS);

  useEffect(() => {
    setPicked(null);
    setPhase('spinning');
    setBannerOpacity(0);
    setTranslateY(0);

    const order = shuffleInPlace([...TRAITS]);
    setWheelOrder(order);
    const target = order[Math.floor(Math.random() * order.length)];
    const targetIdx = order.indexOf(target);
    const offsetGoal = targetIdx * ITEM_HEIGHT;
    const spinEndOffset = SPIN_DURATION_MS * SPIN_SPEED_PX_PER_MS;
    // Smallest offset >= spinEnd + 2 items that lands the target slot in view.
    const minLanding = spinEndOffset + ITEM_HEIGHT * 2;
    const cyclesNeeded = Math.ceil((minLanding - offsetGoal) / CYCLE);
    const finalOffset = cyclesNeeded * CYCLE + offsetGoal;

    const startTime = performance.now();
    let raf = 0;
    let bannerInTimer = 0;
    let bannerOutTimer = 0;
    let bannerCommitTimer = 0;
    let cancelled = false;

    const frame = (now: number): void => {
      if (cancelled) return;
      const elapsed = now - startTime;

      if (elapsed < SPIN_DURATION_MS) {
        const offset = elapsed * SPIN_SPEED_PX_PER_MS;
        setTranslateY(-(offset % CYCLE));
        raf = requestAnimationFrame(frame);
        return;
      }

      if (elapsed < SPIN_DURATION_MS + DECEL_DURATION_MS) {
        if (phase !== 'decelerating') setPhase('decelerating');
        const t = (elapsed - SPIN_DURATION_MS) / DECEL_DURATION_MS;
        // easeOutCubic — fast at start of decel, gentle landing
        const eased = 1 - Math.pow(1 - t, 3);
        const offset = spinEndOffset + (finalOffset - spinEndOffset) * eased;
        setTranslateY(-(offset % CYCLE));
        raf = requestAnimationFrame(frame);
        return;
      }

      // Landed.
      setTranslateY(-offsetGoal);
      setPicked(target);
      setPhase('banner');
      bannerInTimer = window.setTimeout(() => setBannerOpacity(1), 16);
      bannerOutTimer = window.setTimeout(
        () => setBannerOpacity(0),
        BANNER_FADE_MS + BANNER_HOLD_MS,
      );
      bannerCommitTimer = window.setTimeout(() => {
        setPhase('done');
        onCommit(target);
      }, BANNER_DURATION_MS);
    };

    raf = requestAnimationFrame(frame);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(bannerInTimer);
      window.clearTimeout(bannerOutTimer);
      window.clearTimeout(bannerCommitTimer);
    };
    // We intentionally do NOT depend on `phase` or `onCommit` — the effect is
    // a single self-contained sequence, restarted only by `spinKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinKey]);

  return (
    <>
      <div
        style={{
          position: 'absolute',
          top: 14,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          pointerEvents: 'none',
          zIndex: 4,
        }}
        aria-live="polite"
      >
        <div
          style={{
            fontFamily: MONO_STACK,
            fontSize: 10,
            letterSpacing: 2,
            color: 'rgba(255,255,255,0.55)',
            marginBottom: 4,
          }}
        >
          SPEED TRAIT
        </div>
        <div
          style={{
            width: WINDOW_WIDTH,
            height: ITEM_HEIGHT,
            overflow: 'hidden',
            background: 'rgba(0,0,0,0.55)',
            border: '1px solid rgba(255,255,255,0.18)',
            borderRadius: 6,
            position: 'relative',
            boxShadow: phase === 'decelerating' || phase === 'banner'
              ? '0 0 14px rgba(120,255,210,0.35)'
              : '0 0 8px rgba(0,0,0,0.5)',
            transition: 'box-shadow 200ms linear',
          }}
        >
          <div
            style={{
              transform: `translateY(${translateY}px)`,
              willChange: 'transform',
            }}
          >
            {[...wheelOrder, ...wheelOrder, ...wheelOrder].map((t, i) => (
              <div
                key={i}
                style={{
                  height: ITEM_HEIGHT,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: MONO_STACK,
                  fontSize: 18,
                  fontWeight: 700,
                  letterSpacing: 3,
                  color:
                    picked === t
                      ? 'rgb(120,255,210)'
                      : 'rgba(255,255,255,0.92)',
                }}
              >
                {TRAIT_LABELS[t]}
              </div>
            ))}
          </div>
          {/* Top + bottom fade masks for nicer drum feel. */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 8,
              background: 'linear-gradient(rgba(0,0,0,0.6), rgba(0,0,0,0))',
              pointerEvents: 'none',
            }}
          />
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: 8,
              background: 'linear-gradient(rgba(0,0,0,0), rgba(0,0,0,0.6))',
              pointerEvents: 'none',
            }}
          />
        </div>
      </div>

      {/* Big-text banner shown after the wheel lands. */}
      {picked !== null && (
        <div
          style={{
            position: 'absolute',
            top: '38%',
            left: 0,
            right: 0,
            textAlign: 'center',
            pointerEvents: 'none',
            opacity: bannerOpacity,
            transition: `opacity ${BANNER_FADE_MS}ms ease`,
            zIndex: 5,
          }}
          role="status"
        >
          <div
            style={{
              fontFamily: MONO_STACK,
              fontSize: 14,
              letterSpacing: 4,
              color: 'rgba(255,255,255,0.7)',
              marginBottom: 8,
            }}
          >
            SPEED BONUS TO
          </div>
          <div
            style={{
              fontFamily: MONO_STACK,
              fontSize: 64,
              fontWeight: 800,
              letterSpacing: 6,
              color: 'rgb(120,255,210)',
              textShadow: '0 0 24px rgba(120,255,210,0.55)',
            }}
          >
            {TRAIT_LABELS[picked]}
          </div>
        </div>
      )}
    </>
  );
}
