'use client';

import { useEffect, useState, FormEvent } from 'react';

const CORAL = '#c97185';

export default function LandingPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [installMode, setInstallMode] = useState<'npm' | 'pip'>('npm');

  const INSTALL_CMD: Record<'npm' | 'pip', string> = {
    npm: 'npx snose on',
    pip: 'pip install starnose',
  };
  const GITHUB_URL = 'https://github.com/eitanlebras/starnose';

  useEffect(() => {
    fetch('/api/waitlist')
      .then((r) => r.json())
      .then((d) => typeof d.count === 'number' && setCount(d.count))
      .catch(() => {});
  }, []);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setStatus(null);
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setStatus("you're on the list.");
        setEmail('');
        if (typeof data.count === 'number') setCount(data.count);
      } else if (res.status === 409) {
        setStatus("already on the list.");
      } else {
        setStatus('something went wrong.');
      }
    } catch {
      setStatus('something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
      />

      <div className="root">
        {/* NAV */}
        <nav>
          <div className="brand-wrap">
            <img src="/logo.svg" alt="starnose logo" className="brand-logo" />
            <div className="brand">starnose</div>
          </div>
          <div className="nav-right">
            <div className="nav-links">
              <a href="#sense">sense</a>
              <a href="#dig">dig</a>
              <a href="#sessions">sessions</a>
              <a href="#waitlist" className="nav-cta">get early access →</a>
            </div>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="nav-github"
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
                <path d="M12 2C6.48 2 2 6.58 2 12.23C2 16.75 4.87 20.58 8.84 21.93C9.34 22.03 9.52 21.71 9.52 21.44C9.52 21.2 9.51 20.56 9.5 19.72C6.73 20.34 6.14 18.5 6.14 18.5C5.68 17.31 5.03 16.99 5.03 16.99C4.12 16.36 5.1 16.37 5.1 16.37C6.1 16.44 6.64 17.43 6.64 17.43C7.53 18.99 8.97 18.55 9.54 18.29C9.63 17.62 9.89 17.16 10.18 16.9C7.97 16.64 5.65 15.76 5.65 11.85C5.65 10.74 6.04 9.84 6.68 9.13C6.58 8.87 6.23 7.83 6.78 6.42C6.78 6.42 7.62 6.15 9.51 7.46C10.32 7.23 11.2 7.11 12.08 7.11C12.96 7.11 13.84 7.23 14.65 7.46C16.54 6.15 17.38 6.42 17.38 6.42C17.93 7.83 17.58 8.87 17.48 9.13C18.12 9.84 18.51 10.74 18.51 11.85C18.51 15.77 16.18 16.64 13.97 16.89C14.33 17.21 14.65 17.84 14.65 18.81C14.65 20.19 14.64 21.13 14.64 21.44C14.64 21.71 14.82 22.03 15.33 21.93C19.3 20.57 22.16 16.75 22.16 12.23C22.16 6.58 17.68 2 12 2Z" />
              </svg>
              star on github
            </a>
          </div>
        </nav>

        {/* HERO */}
        <section className="hero">
          <div className="container">
            <div className="eyebrow">HTTP proxy for Claude Code</div>
            <h1>
              Finally see what Claude Code<br />
              <em>is actually doing.</em>
            </h1>
            <p className="lede">
              Starnose sits at the network layer — zero code changes, one environment variable.
              Every token, every skill, every compaction event. The black box, opened.
            </p>

            <div className="install-block">
              <div className="install-toggle" role="tablist" aria-label="Install method">
                <button
                  type="button"
                  role="tab"
                  aria-selected={installMode === 'npm'}
                  className={installMode === 'npm' ? 'active' : ''}
                  onClick={() => setInstallMode('npm')}
                >
                  npm
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={installMode === 'pip'}
                  className={installMode === 'pip' ? 'active' : ''}
                  onClick={() => setInstallMode('pip')}
                >
                  pip
                </button>
              </div>
              <div className="install" onClick={() => copy(INSTALL_CMD[installMode])}>
                <span className="prompt">$</span>
                <span className="cmd">{INSTALL_CMD[installMode]}</span>
                <span className="copy-icon" aria-hidden="true">
                  {copied ? (
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                      <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                      <path d="M16 1H4a2 2 0 0 0-2 2v12h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z" />
                    </svg>
                  )}
                </span>
              </div>
            </div>
            <div className="hero-ctas">
              <a
                className="hero-github"
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true">
                  <path d="M12 2C6.48 2 2 6.58 2 12.23C2 16.75 4.87 20.58 8.84 21.93C9.34 22.03 9.52 21.71 9.52 21.44C9.52 21.2 9.51 20.56 9.5 19.72C6.73 20.34 6.14 18.5 6.14 18.5C5.68 17.31 5.03 16.99 5.03 16.99C4.12 16.36 5.1 16.37 5.1 16.37C6.1 16.44 6.64 17.43 6.64 17.43C7.53 18.99 8.97 18.55 9.54 18.29C9.63 17.62 9.89 17.16 10.18 16.9C7.97 16.64 5.65 15.76 5.65 11.85C5.65 10.74 6.04 9.84 6.68 9.13C6.58 8.87 6.23 7.83 6.78 6.42C6.78 6.42 7.62 6.15 9.51 7.46C10.32 7.23 11.2 7.11 12.08 7.11C12.96 7.11 13.84 7.23 14.65 7.46C16.54 6.15 17.38 6.42 17.38 6.42C17.93 7.83 17.58 8.87 17.48 9.13C18.12 9.84 18.51 10.74 18.51 11.85C18.51 15.77 16.18 16.64 13.97 16.89C14.33 17.21 14.65 17.84 14.65 18.81C14.65 20.19 14.64 21.13 14.64 21.44C14.64 21.71 14.82 22.03 15.33 21.93C19.3 20.57 22.16 16.75 22.16 12.23C22.16 6.58 17.68 2 12 2Z" />
                </svg>
                star on github
                <span className="arrow">→</span>
              </a>
              <span className="hero-note"># copy and run to get started.</span>
            </div>
          </div>
        </section>

        {/* SNOSE SENSE */}
        <section id="sense">
          <div className="container">
            <div className="section-label">snose sense</div>
            <h2>
              Live stream from the actual CLI.<br />
              <em>Not a mock dashboard.</em>
            </h2>
            <div className="mock">
              <div className="mock-head">
                <span>snose sense</span>
                <span>LIVE · space browse · q quit</span>
              </div>
              <pre className="mock-body">
<span className="accent">starnose  v0.1.0</span>{'\n'}
&quot;fix sessions view scrolling and filter arrows&quot;{'\n'}
12 calls · 1.8m tok · $6.02 · 4m 11s · done{'\n'}{'\n'}
<span className="strong">(08)</span>{'  '}3.1s  <span className="strong">199k tok</span>  $0.06  user → Bash×8, Read×33{'\n'}
{'      '}read: SessionsView.tsx · TreeView.tsx · page.tsx +12 more{'\n'}
<span className="strong">(09)</span>{'  '}4.5s  <span className="strong">125k tok</span>  $0.21  user → Bash×14, Read×12{'\n'}
<span className="strong">(10)</span>{'  '}11.2s <span className="strong">176k tok</span>  $0.39  user → Bash×17, Edit×4{'\n'}{'\n'}
<span className="dim">given: system 199 tok · conv 118.8k tok (88 turns)</span>{'\n'}
<span className="dim">sent:  patch sessions viewport and keybindings</span>{'\n'}
<span className="accent">decision:</span> Edit×4  SessionsView.tsx + TreeView.tsx{'\n'}{'\n'}
<span className="accent">done</span>{'\n'}
12 calls · 1.8m tok · $6.02{'\n'}
→ snose dig to inspect
              </pre>
            </div>
          </div>
        </section>

        {/* SNOSE DIG */}
        <section id="dig">
          <div className="container">
            <div className="section-label">snose dig</div>
            <h2>
              Keyboard-driven inspector.<br />
              <em>Any call, any depth.</em>
            </h2>
            <div className="mock">
              <div className="mock-head">
                <span>snose dig · session sn_e637yp · 112 calls</span>
                <span>↑↓ nav · ←→ group · tab delta · s sessions · / search</span>
              </div>
              <pre className="mock-body">
<span className="accent">  call ⑩  user → Bash×14, Read×12, Write×11, Edit×3</span>{'\n'}{'\n'}
<span className="accent strong">  WHAT CHANGED</span>{'\n'}
<span className="accent">    + Edit×1 added   (3 total, was 2)</span>{'\n'}
<span className="accent">    + 364 tok added  (125.3k total)</span>{'\n'}
<span className="accent">    + $0.004 added   ($0.21 total)</span>{'\n'}
<span className="accent">    + 2 more turns   (88 turns total)</span>{'\n'}{'\n'}
<span className="accent strong">  UNCHANGED</span>{'\n'}
<span className="dim">    Same tool pattern as previous call</span>{'\n'}
<span className="dim">    Same files: SessionsView.tsx · TreeView.tsx · +6 more</span>{'\n'}{'\n'}
<span className="dim">  [tab] for full detail view</span>{'\n'}{'\n'}
<span className="dim">  ► STATS        success · 4.5s · 125.3k in / 291 out · $0.21</span>{'\n'}
<span className="dim">  ► WHAT IT READ Bash×14 · Read×12 · Write×11 · Edit×3</span>{'\n'}
<span className="accent">  ► WHAT IT WAS MISSING  △ &quot;snose sense is showing...&quot;</span>{'\n'}
<span className="dim">  ► DECISION     Edit SessionsView.tsx + TreeView.tsx</span>
              </pre>
            </div>
          </div>
        </section>

        {/* SESSIONS */}
        <section id="sessions">
          <div className="container">
            <div className="section-label">sessions browser</div>
            <h2>
              Full history with fast filters.<br />
              <em>all sessions, no lockouts.</em>
            </h2>
            <div className="mock">
              <div className="mock-head">
                <span>snose dig · sessions</span>
                <span>←→ filter · / search · ↑↓ nav · enter open · esc back</span>
              </div>
              <pre className="mock-body">
<span className="accent">sessions  [ all 44 ] [ today 44 ] [ expensive 21 ] [ failed 0 ] [ long 10 ]</span>{'\n'}
<span className="dim">filter: calls:&gt;6</span>{'\n'}
<span className="strong">► ● live  sn_sksy31  29 min ago  8 calls  199.1k tok  $0.06  ● active</span>{'\n'}
<span className="dim">  &quot;list 2 files in this dir&quot;</span>{'\n'}
<span className="dim">  sn_u4uibr  37 min ago  14 calls  339.8k tok  $0.85  ✓ done</span>{'\n'}
<span className="dim">  sn_gm9spa  56 min ago  58 calls  5170.3k tok  $12.65  ✓ done</span>{'\n'}
<span className="dim">  sn_642ebc  1h ago  27 calls  2641.4k tok  $10.51  ✓ done</span>{'\n'}
<span className="accent">2 sessions match · esc clear · enter open</span>
              </pre>
            </div>
          </div>
        </section>

        {/* STATS — full bleed */}
        <section className="stats">
          <div className="stats-grid">
            <div className="stat">
              <div className="stat-num">0<span className="stat-unit">AI</span></div>
              <div className="stat-label">No LLMs in the tooling itself. Pure deterministic proxy.</div>
              <div className="stat-sub"># what you see is what happened</div>
            </div>
            <div className="stat">
              <div className="stat-num">1<span className="stat-unit">env var</span></div>
              <div className="stat-label">One environment variable to start intercepting every call.</div>
              <div className="stat-sub">ANTHROPIC_BASE_URL=http://localhost:3001</div>
            </div>
            <div className="stat">
              <div className="stat-num">0<span className="stat-unit">code Δ</span></div>
              <div className="stat-label">Zero changes to your project. Works with any Claude Code setup.</div>
              <div className="stat-sub"># runs at network layer, not source layer</div>
            </div>
            <div className="stat">
              <div className="stat-num">∞<span className="stat-unit">calls</span></div>
              <div className="stat-label">Every API call captured to local SQLite. No sampling, no gaps.</div>
              <div className="stat-sub">~/.starnose/starnose.db</div>
            </div>
          </div>
        </section>

        {/* SETUP */}
        <section>
          <div className="container">
            <div className="section-label">setup</div>
            <h2>
              Running in about fifteen seconds.<br />
              <em>100% free. fully open source.</em>
            </h2>
            <div className="setup-flow">
              <svg className="setup-svg" viewBox="0 0 80 440" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path
                  d="M 40 0 C 40 30 40 30 40 55 C 40 80 18 130 40 165 C 62 200 62 248 40 275 C 18 302 18 355 40 385 C 40 410 40 440 40 440"
                  stroke="var(--coral)"
                  strokeWidth="1.5"
                  strokeOpacity="0.28"
                />
                <circle cx="40" cy="55" r="15" fill="var(--bg)" stroke="var(--coral)" strokeWidth="1.5"/>
                <text x="40" y="55" textAnchor="middle" dominantBaseline="central" fill="var(--coral)" fontSize="11" fontFamily="JetBrains Mono, monospace" fontWeight="500">1</text>
                <circle cx="40" cy="165" r="15" fill="var(--bg)" stroke="var(--coral)" strokeWidth="1.5"/>
                <text x="40" y="165" textAnchor="middle" dominantBaseline="central" fill="var(--coral)" fontSize="11" fontFamily="JetBrains Mono, monospace" fontWeight="500">2</text>
                <circle cx="40" cy="275" r="15" fill="var(--bg)" stroke="var(--coral)" strokeWidth="1.5"/>
                <text x="40" y="275" textAnchor="middle" dominantBaseline="central" fill="var(--coral)" fontSize="11" fontFamily="JetBrains Mono, monospace" fontWeight="500">3</text>
                <circle cx="40" cy="385" r="15" fill="var(--bg)" stroke="var(--coral)" strokeWidth="1.5"/>
                <text x="40" y="385" textAnchor="middle" dominantBaseline="central" fill="var(--coral)" fontSize="11" fontFamily="JetBrains Mono, monospace" fontWeight="500">4</text>
              </svg>
              <div className="setup-steps">
                <div className="setup-step-row">
                  <div className="setup-cmd">$ npx snose on</div>
                  <p>starts the local proxy and points Claude Code to it.</p>
                </div>
                <div className="setup-step-row">
                  <div className="setup-cmd">$ claude</div>
                  <p>work normally while starnose records every call.</p>
                </div>
                <div className="setup-step-row">
                  <div className="setup-cmd">$ npx snose sense</div>
                  <p>watch live behavior, loop signals, cost, and compaction.</p>
                </div>
                <div className="setup-step-row">
                  <div className="setup-cmd">$ npx snose off</div>
                  <p>turn recording off. your data stays local in SQLite.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* FREE */}
        <section id="pricing">
          <div className="container">
            <div className="free-mega">
              <div className="free-heading">
                100% free and open-source.<br />
                no tiers. no gating.
              </div>
              <p className="free-sub">everything local. no limits. no credit card.</p>
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="btn fill free-github-btn">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true" style={{flexShrink: 0}}>
                  <path d="M12 2C6.48 2 2 6.58 2 12.23C2 16.75 4.87 20.58 8.84 21.93C9.34 22.03 9.52 21.71 9.52 21.44C9.52 21.2 9.51 20.56 9.5 19.72C6.73 20.34 6.14 18.5 6.14 18.5C5.68 17.31 5.03 16.99 5.03 16.99C4.12 16.36 5.1 16.37 5.1 16.37C6.1 16.44 6.64 17.43 6.64 17.43C7.53 18.99 8.97 18.55 9.54 18.29C9.63 17.62 9.89 17.16 10.18 16.9C7.97 16.64 5.65 15.76 5.65 11.85C5.65 10.74 6.04 9.84 6.68 9.13C6.58 8.87 6.23 7.83 6.78 6.42C6.78 6.42 7.62 6.15 9.51 7.46C10.32 7.23 11.2 7.11 12.08 7.11C12.96 7.11 13.84 7.23 14.65 7.46C16.54 6.15 17.38 6.42 17.38 6.42C17.93 7.83 17.58 8.87 17.48 9.13C18.12 9.84 18.51 10.74 18.51 11.85C18.51 15.77 16.18 16.64 13.97 16.89C14.33 17.21 14.65 17.84 14.65 18.81C14.65 20.19 14.64 21.13 14.64 21.44C14.64 21.71 14.82 22.03 15.33 21.93C19.3 20.57 22.16 16.75 22.16 12.23C22.16 6.58 17.68 2 12 2Z" />
                </svg>
                star on github →
              </a>
            </div>
            <ul className="free-features">
              <li>all five commands</li>
              <li>live feed with loop detection</li>
              <li>compaction detection</li>
              <li>cross-session search</li>
              <li>full history forever</li>
              <li>local SQLite — nothing leaves your machine</li>
              <li>self-hostable</li>
            </ul>
          </div>
        </section>

        {/* EMAIL CAPTURE */}
        <section id="waitlist">
          <div className="container">
            <div className="email-box">
              <div className="section-label">early access</div>
              <h2>
                Be first in when<br />
                <em>cloud sync launches.</em>
              </h2>
              <p className="lede">
                get notified when cloud sync launches.
              </p>
              <div className="waitlist-count">
                <span className="num">{count ?? '—'}</span> developer{count === 1 ? '' : 's'} on the waitlist
              </div>
              <form onSubmit={handleSubmit} noValidate className="email-form">
                <input
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={submitting}
                />
                <button type="submit" disabled={submitting}>
                  {submitting ? '…' : 'notify me →'}
                </button>
              </form>
              {status && <div className="email-status">{status}</div>}
            </div>
          </div>
        </section>

        <footer>
          <div className="footer-copy">starnose © 2026</div>
          <div className="footer-brand-huge">
            <img src="/logo.svg" alt="starnose logo" className="footer-logo-huge" />
            <span className="footer-name-huge">starnose</span>
          </div>
        </footer>
      </div>

      <style jsx global>{`
        :root {
          --coral: ${CORAL};
          --bg: #0a0a0b;
          --bg-2: #101013;
          --border: #1f1f24;
          --border-2: #2a2a31;
          --text: #ededf0;
          --text-dim: #8a8a93;
          --text-muted: #5a5a63;
          --serif: 'Playfair Display', Georgia, serif;
          --sans: 'Inter', -apple-system, system-ui, sans-serif;
          --mono: 'JetBrains Mono', ui-monospace, Menlo, monospace;
        }
        * { box-sizing: border-box; border-radius: 0 !important; }
        html, body {
          margin: 0;
          padding: 0;
          background: var(--bg);
          color: var(--text);
          font-family: var(--sans);
          font-size: 15px;
          line-height: 1.55;
          -webkit-font-smoothing: antialiased;
        }
        a { color: inherit; text-decoration: none; }
        button { font-family: inherit; cursor: pointer; }

        .root { min-height: 100vh; }
        .container {
          max-width: 1080px;
          margin: 0 auto;
          padding: 0 32px;
        }

        /* NAV */
        nav {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: nowrap;
          padding: 18px 32px;
          border-bottom: 1px solid var(--border);
          position: sticky;
          top: 0;
          background: rgba(10, 10, 11, 0.85);
          backdrop-filter: blur(8px);
          z-index: 10;
        }
        .brand-wrap {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .brand-logo {
          width: 48px;
          height: 48px;
          display: block;
          flex-shrink: 0;
        }
        .brand {
          font-family: var(--mono);
          font-size: 22px;
          font-weight: 500;
          color: #fff;
          letter-spacing: 0.02em;
        }
        .nav-right {
          display: flex;
          align-items: center;
          gap: 18px;
          margin-left: auto;
          flex-wrap: nowrap;
        }
        .nav-links {
          display: flex;
          gap: 28px;
          align-items: center;
          font-family: var(--mono);
          font-size: 13px;
          color: var(--text-dim);
          flex-wrap: nowrap;
          white-space: nowrap;
        }
        .nav-links a:hover { color: var(--text); }
        .nav-cta {
          border: 1px solid var(--coral);
          color: var(--coral) !important;
          padding: 7px 14px;
        }
        .nav-cta:hover { background: var(--coral); color: var(--bg) !important; }
        .nav-github {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-family: var(--mono);
          font-size: 13px;
          color: var(--bg) !important;
          background: var(--coral);
          border: 1px solid var(--coral);
          padding: 8px 16px;
          font-weight: 500;
          letter-spacing: 0.02em;
          transition: background 0.15s, color 0.15s;
        }
        .nav-github:hover { background: transparent; color: var(--coral) !important; }

        section {
          padding: 96px 0;
          border-bottom: 1px solid var(--border);
        }
        .hero { padding: 120px 0 96px; }

        .eyebrow, .section-label {
          display: inline-block;
          font-family: var(--mono);
          font-size: 11px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--coral);
          border: 1px solid var(--border-2);
          padding: 6px 12px;
          margin-bottom: 28px;
        }

        h1 {
          font-family: var(--serif);
          font-size: 68px;
          line-height: 1.04;
          font-weight: 700;
          letter-spacing: -0.02em;
          margin: 0 0 28px;
          max-width: 880px;
        }
        h1 em, h2 em {
          font-style: italic;
          color: var(--coral);
          font-weight: 400;
        }
        h2 {
          font-family: var(--serif);
          font-size: 46px;
          line-height: 1.08;
          font-weight: 700;
          letter-spacing: -0.015em;
          margin: 0 0 40px;
          max-width: 720px;
        }
        .lede {
          font-size: 19px;
          line-height: 1.6;
          color: var(--text-dim);
          max-width: 640px;
          margin: 0 0 40px;
        }

        /* INSTALL */
        .install-block {
          display: inline-flex;
          flex-direction: column;
          margin-bottom: 20px;
        }
        .install-toggle {
          display: inline-flex;
          align-self: flex-start;
          border: 1px solid var(--border-2);
          border-bottom: none;
          background: var(--bg);
        }
        .install-toggle button {
          background: transparent;
          border: none;
          color: var(--text-muted);
          font-family: var(--mono);
          font-size: 12px;
          padding: 8px 18px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          border-right: 1px solid var(--border-2);
          transition: background 0.15s, color 0.15s;
        }
        .install-toggle button:last-child { border-right: none; }
        .install-toggle button:hover { color: var(--text); }
        .install-toggle button.active {
          background: var(--coral);
          color: var(--bg);
        }
        .install-row {
          display: flex;
          gap: 16px;
          flex-wrap: wrap;
          margin-bottom: 14px;
        }
        .install {
          display: inline-flex;
          align-items: center;
          gap: 14px;
          font-family: var(--mono);
          font-size: 14px;
          padding: 14px 20px;
          background: var(--bg-2);
          border: 1px solid var(--border-2);
          cursor: pointer;
          transition: border-color 0.15s;
        }
        .install:hover { border-color: var(--coral); }
        .install .prompt { color: var(--coral); }
        .install .cmd { color: var(--text); }
        .install .copy {
          color: var(--text-muted);
          margin-left: 8px;
        }
        .copy-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 18px;
          height: 18px;
          color: var(--text-muted);
        }
        .install.alt .cmd { color: var(--text-dim); }
        .hero-ctas {
          display: flex;
          align-items: center;
          gap: 22px;
          flex-wrap: wrap;
        }
        .hero-github {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          font-family: var(--mono);
          font-size: 13px;
          padding: 13px 22px;
          background: var(--coral);
          color: var(--bg) !important;
          border: 1px solid var(--coral);
          font-weight: 500;
          letter-spacing: 0.02em;
          transition: background 0.15s, color 0.15s;
        }
        .hero-github:hover {
          background: transparent;
          color: var(--coral) !important;
        }
        .hero-github .arrow { margin-left: 4px; }
        .hero-note {
          font-family: var(--mono);
          font-size: 12px;
          color: var(--text-muted);
        }

        /* MOCK TERMINAL */
        .mock {
          border: 1px solid var(--border-2);
          background: var(--bg-2);
          font-family: var(--mono);
          font-size: 12.5px;
          max-width: 960px;
        }
        .mock-head {
          display: flex;
          justify-content: space-between;
          padding: 12px 18px;
          border-bottom: 1px solid var(--border);
          color: var(--text-muted);
          font-size: 11px;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        .mock-body {
          margin: 0;
          padding: 22px 20px;
          color: var(--text-dim);
          line-height: 1.65;
          font-size: 14px;
          overflow-x: auto;
          white-space: pre;
        }
        .mock-body .accent { color: var(--coral); }
        .mock-body .strong { color: var(--text); font-weight: 500; }
        .mock-body .dim { color: var(--text-muted); }

        /* STATS */
        .stats {
          padding: 0;
        }
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          width: 100%;
        }
        .stat {
          padding: 72px 48px;
          border-right: 1px solid var(--border);
        }
        .stat:last-child { border-right: none; }
        .stat-num {
          font-family: var(--serif);
          font-size: 82px;
          line-height: 1;
          font-weight: 700;
          color: var(--text);
          margin-bottom: 22px;
          display: flex;
          align-items: baseline;
          gap: 10px;
        }
        .stat-unit {
          font-family: var(--mono);
          font-size: 13px;
          font-weight: 400;
          color: var(--coral);
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .stat-label {
          font-size: 14px;
          color: var(--text-dim);
          line-height: 1.55;
          margin-bottom: 14px;
          max-width: 280px;
        }
        .stat-sub {
          font-family: var(--mono);
          font-size: 11px;
          color: var(--text-muted);
          word-break: break-all;
        }

        /* SETUP FLOW */
        .setup-flow {
          display: flex;
          align-items: flex-start;
          gap: 0;
          max-width: 680px;
        }
        .setup-svg {
          width: 80px;
          height: 440px;
          flex-shrink: 0;
        }
        .setup-steps {
          flex: 1;
          display: flex;
          flex-direction: column;
        }
        .setup-step-row {
          height: 110px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 0 0 0 16px;
        }
        .setup-cmd {
          font-family: var(--mono);
          color: var(--coral);
          font-size: 15px;
          margin-bottom: 6px;
        }
        .setup-step-row p {
          color: var(--text-dim);
          font-size: 14px;
          line-height: 1.5;
          margin: 0;
        }

        /* FREE */
        .btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-family: var(--mono);
          font-size: 13px;
          padding: 11px 18px;
          border: 1px solid var(--coral);
          background: transparent;
          color: var(--coral);
          transition: background 0.15s, color 0.15s;
          text-decoration: none;
        }
        .btn:hover { background: var(--coral); color: var(--bg); }
        .btn.fill {
          background: var(--coral);
          color: var(--bg);
        }
        .btn.fill:hover { background: transparent; color: var(--coral); }
        .free-mega {
          max-width: 1000px;
          margin-bottom: 56px;
        }
        .free-heading {
          font-family: var(--serif);
          font-size: clamp(52px, 7.5vw, 96px);
          font-weight: 700;
          line-height: 1.05;
          letter-spacing: -0.025em;
          color: var(--text);
          margin-bottom: 28px;
        }
        .free-sub {
          font-family: var(--mono);
          font-size: 13px;
          color: var(--text-muted);
          margin: 0 0 32px;
        }
        .free-github-btn {
          font-size: 14px;
          padding: 13px 22px;
        }
        .free-features {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          max-width: 560px;
          border-top: 1px solid var(--border);
        }
        .free-features li {
          font-size: 14px;
          color: var(--text-dim);
          padding: 11px 0 11px 22px;
          position: relative;
          border-bottom: 1px solid var(--border);
        }
        .free-features li::before {
          content: '→';
          position: absolute;
          left: 0;
          color: var(--coral);
        }

        /* EMAIL */
        .email-box {
          max-width: 720px;
        }
        .waitlist-count {
          font-family: var(--mono);
          font-size: 13px;
          color: var(--text-muted);
          margin: -16px 0 28px;
        }
        .waitlist-count .num { color: var(--coral); font-weight: 500; }
        .email-form {
          display: flex;
          gap: 0;
          max-width: 520px;
          border: 1px solid var(--border-2);
        }
        .email-form input {
          flex: 1;
          background: var(--bg-2);
          border: none;
          color: var(--text);
          font-family: var(--mono);
          font-size: 14px;
          padding: 16px 18px;
          outline: none;
        }
        .email-form input::placeholder { color: var(--text-muted); }
        .email-form input:focus { background: var(--bg); }
        .email-form button {
          background: var(--coral);
          border: none;
          color: var(--bg);
          font-family: var(--mono);
          font-size: 13px;
          padding: 0 22px;
          font-weight: 500;
        }
        .email-form button:disabled { opacity: 0.5; }
        .email-status {
          font-family: var(--mono);
          font-size: 12px;
          color: var(--coral);
          margin-top: 14px;
        }

        /* FOOTER */
        footer {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          padding: 48px 32px;
          border-top: 1px solid var(--border);
        }
        .footer-copy {
          font-family: var(--mono);
          font-size: 13px;
          color: var(--text-muted);
        }
        .footer-brand-huge {
          display: flex;
          align-items: center;
          gap: 20px;
        }
        .footer-logo-huge {
          width: 80px;
          height: 80px;
          display: block;
        }
        .footer-name-huge {
          font-family: var(--mono);
          font-size: clamp(56px, 8vw, 96px);
          font-weight: 600;
          color: var(--text);
          letter-spacing: -0.02em;
          line-height: 1;
        }

        @media (max-width: 760px) {
          h1 { font-size: 44px; }
          h2 { font-size: 32px; }
          .free-heading { font-size: 42px; }
          .setup-flow { max-width: 100%; }
          .setup-svg { width: 56px; height: 440px; }
          .stats-grid { grid-template-columns: 1fr 1fr; }
          .stat { padding: 48px 28px; }
          .stat:nth-child(2) { border-right: none; }
          .stat:nth-child(1), .stat:nth-child(2) { border-bottom: 1px solid var(--border); }
          .stat-num { font-size: 56px; }
          section { padding: 64px 0; }
          .hero { padding: 80px 0 64px; }
          .nav-links a:not(.nav-cta) { display: none; }
          .nav-github { padding: 8px 10px; font-size: 12px; }
          .footer-name-huge { font-size: 40px; }
          .footer-logo-huge { width: 48px; height: 48px; }
          footer { align-items: center; }
        }
      `}</style>
    </>
  );
}
