const COLORS = {
  bg: '#0a0a0f',
  text: '#e6e6e6',
  textDim: '#8a8a96',
  brand: '#ff2ec4',
  accent: '#22e6ff',
  rule: '#1a1a24',
} as const;

const FONT_STACK = `'Inter', 'Space Grotesk', system-ui, -apple-system, sans-serif`;
const FONT_MONO = `'JetBrains Mono', 'IBM Plex Mono', ui-monospace, monospace`;

export function Landing() {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: `linear-gradient(180deg, ${COLORS.bg} 0%, #000 100%)`,
        color: COLORS.text,
        fontFamily: FONT_STACK,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '4rem 1.5rem 1.5rem',
      }}
    >
      <main
        style={{
          maxWidth: '720px',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          flex: 1,
          justifyContent: 'center',
        }}
      >
        <h1
          style={{
            fontSize: 'clamp(2.5rem, 6vw, 4rem)',
            fontWeight: 700,
            letterSpacing: '-0.02em',
            margin: 0,
            color: '#fff',
            textShadow: `0 0 16px ${COLORS.brand}80, 0 0 36px ${COLORS.brand}40`,
          }}
        >
          Robo Rhapsody Sim
        </h1>

        <p
          style={{
            fontSize: '1.125rem',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: COLORS.accent,
            marginTop: '0.75rem',
            marginBottom: '2.5rem',
          }}
        >
          Coming Soon
        </p>

        <p
          style={{
            fontSize: '1.25rem',
            lineHeight: 1.5,
            color: COLORS.text,
            margin: '0 0 2rem',
            maxWidth: '560px',
          }}
        >
          85 trait-driven robots compete in a daily simulated event. Tune in to watch.
        </p>

        <hr
          style={{
            width: '64px',
            border: 0,
            borderTop: `1px solid ${COLORS.rule}`,
            margin: '0 0 2rem',
          }}
        />

        <p
          style={{
            fontSize: '1rem',
            lineHeight: 1.7,
            color: COLORS.textDim,
            margin: '0 0 2.5rem',
            maxWidth: '620px',
          }}
        >
          Robo Rhapsody Sim is a passive-watch event simulator built on the 85-robot
          Robo Rhapsody NFT collection. Each robot's traits — Full Send, Degen, Cipher,
          Doubter, Altruist — drive its behavior in procedurally-decided arenas. Sprint
          races, mazes, and obstacle gauntlets cull the field from 85 robots down to a
          single daily winner. No accounts, no wallets, no betting — just tune in,
          watch, and see if your favorite robot makes it through.
        </p>

        <SneakPeekButton />

        <div
          style={{
            display: 'flex',
            gap: '1.5rem',
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          <a
            href="https://x.com/FullyCroisened"
            target="_blank"
            rel="noopener noreferrer"
            style={linkStyle}
          >
            @FullyCroisened on X
          </a>
          <span style={{ color: COLORS.rule }}>·</span>
          <a
            href="https://pulsemarket.app/collection/0xc349d3354f6f42abefbf556b703803b4fd229b6f"
            target="_blank"
            rel="noopener noreferrer"
            style={linkStyle}
          >
            Robo Rhapsody Collection
          </a>
        </div>
      </main>

      <footer
        style={{
          fontFamily: FONT_MONO,
          fontSize: '0.75rem',
          letterSpacing: '0.1em',
          color: COLORS.textDim,
          marginTop: '3rem',
        }}
      >
        RR · v0.1.0 · COMING SOON
      </footer>
    </div>
  );
}

const linkStyle = {
  color: COLORS.accent,
  textDecoration: 'none',
  fontSize: '1rem',
  borderBottom: `1px solid ${COLORS.accent}40`,
  paddingBottom: '2px',
  transition: 'border-color 0.2s ease',
} as const;

function SneakPeekButton() {
  const onClick = (e: MouseEvent) => {
    e.preventDefault();
    window.location.hash = 'peek';
  };
  return (
    <div
      style={{
        marginBottom: '2.5rem',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.75rem',
      }}
    >
      <a
        href="#peek"
        onClick={onClick}
        style={{
          display: 'inline-block',
          padding: '0.75rem 1.75rem',
          fontFamily: FONT_STACK,
          fontSize: '1rem',
          fontWeight: 600,
          letterSpacing: '0.05em',
          color: COLORS.accent,
          background: 'transparent',
          border: `1px solid ${COLORS.accent}80`,
          borderRadius: '999px',
          textDecoration: 'none',
          cursor: 'pointer',
          transition: 'border-color 0.2s ease, background 0.2s ease',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.borderColor = COLORS.accent;
          (e.currentTarget as HTMLElement).style.background = `${COLORS.accent}14`;
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.borderColor = `${COLORS.accent}80`;
          (e.currentTarget as HTMLElement).style.background = 'transparent';
        }}
      >
        Sneak Peek →
      </a>
      <p
        style={{
          fontSize: '0.875rem',
          color: COLORS.textDim,
          margin: 0,
          fontStyle: 'italic',
        }}
      >
        They're training. Take a look.
      </p>
    </div>
  );
}
