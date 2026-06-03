// Variation A — "Editorial Industrial"
// Calm warm cream surfaces, deep navy ink, large editorial type,
// wide ribbon progress with axes as inline lanes.

const { PHASES, JOBS } = window.PMData;

const A = {
  bg: '#f4f1ea',
  surface: '#fbf9f4',
  ink: '#0e1b3a',
  ink2: '#3a4564',
  ink3: '#7a8198',
  hair: '#e4ddcd',
  hair2: '#ebe5d6',
  accent: '#0e1b3a',
  warn: '#c47a1c',
  danger: '#b8392f',
  ok: '#3e7e57',
  cream: '#efeadb',
};

const aStyles = {
  shell: {
    background: A.bg, color: A.ink, fontFamily: '"Inter Tight", "Noto Sans JP", system-ui, sans-serif',
    width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden',
    letterSpacing: '-0.01em',
  },
};

function ATopbar() {
  return (
    <div style={{
      height: 64, padding: '0 32px', display: 'flex', alignItems: 'center', gap: 24,
      borderBottom: `1px solid ${A.hair}`, background: A.surface, flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 6, background: A.ink, color: A.surface,
          display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 13, fontFamily: '"JetBrains Mono", monospace',
        }}>LW</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '-0.01em' }}>LINE WORKS</div>
          <div style={{ fontSize: 10.5, color: A.ink3, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 }}>Project Management</div>
        </div>
      </div>

      <div style={{ flex: 1, maxWidth: 480, position: 'relative' }}>
        <input
          placeholder="工番・納入先・製品名で検索…"
          style={{
            width: '100%', height: 36, padding: '0 14px 0 38px',
            background: A.bg, border: `1px solid ${A.hair}`, borderRadius: 8,
            fontSize: 13, color: A.ink, outline: 'none', fontFamily: 'inherit',
          }}
        />
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={A.ink3} strokeWidth="2.2" strokeLinecap="round"
             style={{ position: 'absolute', left: 14, top: 11 }}>
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
        </svg>
        <span style={{
          position: 'absolute', right: 10, top: 9, fontSize: 10, color: A.ink3,
          background: A.cream, padding: '3px 6px', borderRadius: 4, fontFamily: '"JetBrains Mono", monospace',
        }}>⌘K</span>
      </div>

      <div style={{ flex: 1 }}/>

      <button style={{
        height: 36, padding: '0 16px', borderRadius: 8, background: A.ink, color: A.surface,
        border: 'none', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8,
        fontFamily: 'inherit', cursor: 'pointer',
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
        出図
      </button>
      <button style={{ width: 36, height: 36, borderRadius: 8, background: 'transparent', border: `1px solid ${A.hair}`, color: A.ink2, cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
      </button>
      <div style={{ width: 32, height: 32, borderRadius: '50%', background: A.cream, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, color: A.ink }}>山</div>
    </div>
  );
}

function APageHead() {
  return (
    <div style={{ padding: '32px 48px 20px', borderBottom: `1px solid ${A.hair2}` }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <div style={{ fontSize: 10.5, color: A.ink3, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 8 }}>2026 / W21 · 5月23日(金)</div>
          <h1 style={{ margin: 0, fontSize: 38, fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.05 }}>
            工番一覧 <span style={{ color: A.ink3, fontWeight: 500 }}>— 進行中</span>
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 28, alignItems: 'baseline' }}>
          {[
            { n: '5', l: '進行中' },
            { n: '1', l: '期限超過', c: A.danger },
            { n: '1', l: '今週納期', c: A.warn },
          ].map((s, i) => (
            <div key={i} style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.03em', color: s.c || A.ink, fontFamily: '"Inter Tight", monospace', fontVariantNumeric: 'tabular-nums' }}>{s.n}</div>
              <div style={{ fontSize: 10.5, color: A.ink3, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600 }}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 24, alignItems: 'center' }}>
        {['すべて', '進行中', '期限超過', '今週納期', '本日出図', 'スター付き'].map((t, i) => (
          <button key={i} style={{
            padding: '7px 13px', fontSize: 12, fontWeight: 600,
            background: i === 1 ? A.ink : 'transparent',
            color: i === 1 ? A.surface : A.ink2,
            border: i === 1 ? 'none' : `1px solid ${A.hair}`,
            borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
          }}>{t}{i === 2 && <span style={{ marginLeft: 6, color: A.danger, fontWeight: 700 }}>1</span>}</button>
        ))}
        <div style={{ flex: 1 }}/>
        <span style={{ fontSize: 11.5, color: A.ink3 }}>並び順</span>
        <select style={{ background: A.surface, border: `1px solid ${A.hair}`, borderRadius: 6, padding: '6px 10px', fontSize: 12, color: A.ink, fontFamily: 'inherit' }}>
          <option>納期 (近い順)</option>
        </select>
      </div>
    </div>
  );
}

function APhaseRibbon({ job }) {
  const stepW = 100 / PHASES.length;
  return (
    <div style={{ marginTop: 18 }}>
      {/* phase labels */}
      <div style={{ position: 'relative', height: 18, marginBottom: 8 }}>
        {PHASES.map((p, i) => (
          <div key={p.i} style={{
            position: 'absolute', left: `${i * stepW}%`, width: `${stepW}%`,
            fontSize: 9.5, color: i + 1 === job.nowPhase ? A.ink : A.ink3,
            fontWeight: i + 1 === job.nowPhase ? 700 : 500,
            textAlign: 'center', whiteSpace: 'nowrap',
            letterSpacing: '0.02em',
          }}>
            <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 9, marginRight: 3, opacity: 0.6 }}>{String(p.i).padStart(2, '0')}</span>
            {p.ja}
          </div>
        ))}
      </div>

      {/* ribbon base */}
      <div style={{ position: 'relative', height: 8, background: A.cream, borderRadius: 999 }}>
        {/* done fill */}
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${job.pct}%`, background: A.ink, borderRadius: 999,
        }}/>
        {/* phase ticks */}
        {PHASES.map((p, i) => (
          <div key={p.i} style={{
            position: 'absolute', left: `${(i + 0.5) * stepW}%`,
            top: -2, bottom: -2, width: 1, background: A.surface,
          }}/>
        ))}
        {/* current marker */}
        <div style={{
          position: 'absolute', left: `${(job.nowPhase - 0.5) * stepW}%`,
          top: '50%', transform: 'translate(-50%, -50%)',
          width: 16, height: 16, borderRadius: '50%',
          background: A.surface, border: `2.5px solid ${A.ink}`,
          boxShadow: `0 0 0 4px ${A.bg}`,
        }}/>
      </div>

      {/* axis lanes */}
      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 5 }}>
        {job.axes.map((ax, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 70, fontSize: 11, fontWeight: 600, color: A.ink2 }}>{ax.name}</div>
            <div style={{ flex: 1, position: 'relative', height: 5, background: A.cream, borderRadius: 999 }}>
              <div style={{
                position: 'absolute', left: 0, top: 0, bottom: 0,
                width: `${((ax.at - 1) / 10) * 100 + (ax.pct / 100) * 10}%`,
                background: ax.status === 'pending' ? A.ink3 : A.ink, opacity: ax.status === 'pending' ? 0.3 : 1,
                borderRadius: 999,
              }}/>
              <div style={{
                position: 'absolute', left: `${((ax.at - 0.5) / 10) * 100}%`,
                top: '50%', transform: 'translate(-50%, -50%)',
                width: 8, height: 8, borderRadius: '50%',
                background: ax.status === 'pending' ? A.ink3 : A.ink,
              }}/>
            </div>
            <div style={{ width: 90, fontSize: 10.5, color: A.ink3, textAlign: 'right', fontFamily: '"JetBrains Mono", monospace' }}>
              ⑦ {PHASES[ax.at - 1].ja}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AJobRow({ job }) {
  const dueColor = job.dueStatus === 'over' ? A.danger : job.dueStatus === 'warn' ? A.warn : A.ink3;
  return (
    <div style={{
      padding: '24px 48px', borderBottom: `1px solid ${A.hair2}`,
      cursor: 'pointer', transition: 'background 0.15s',
      background: A.surface,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
        {job.starred && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill={A.ink} style={{ flexShrink: 0 }}>
            <path d="M12 2l3 6.5 7 1-5 5 1.5 7L12 18l-6.5 3.5L7 14.5l-5-5 7-1z"/>
          </svg>
        )}
        <div style={{
          fontFamily: '"JetBrains Mono", monospace', fontSize: 20, fontWeight: 700,
          letterSpacing: '-0.02em', color: A.ink, fontVariantNumeric: 'tabular-nums',
        }}>{job.no}</div>
        <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.015em' }}>{job.customer}</div>
        <div style={{ fontSize: 14, color: A.ink3, fontWeight: 500 }}>/ {job.product}</div>

        <div style={{ flex: 1 }}/>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ fontSize: 10, color: A.ink3, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>納期</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: dueColor, fontFamily: '"JetBrains Mono", monospace' }}>
            {job.due}
            {job.dueStatus === 'over' && <span style={{ marginLeft: 6, fontSize: 11, padding: '2px 6px', background: A.danger, color: A.surface, borderRadius: 4 }}>{Math.abs(job.daysLeft)}日超過</span>}
            {job.dueStatus === 'warn' && <span style={{ marginLeft: 6, fontSize: 11, color: A.warn, fontWeight: 600 }}>あと{job.daysLeft}日</span>}
          </div>
        </div>

        <div style={{ width: 80, textAlign: 'right' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: A.ink, fontFamily: '"Inter Tight", monospace', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.03em' }}>
            {job.pct}<span style={{ fontSize: 13, color: A.ink3 }}>%</span>
          </div>
        </div>
      </div>

      <APhaseRibbon job={job}/>
    </div>
  );
}

function VariantA() {
  return (
    <div style={aStyles.shell}>
      <ATopbar/>
      <APageHead/>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {JOBS.map(j => <AJobRow key={j.no} job={j}/>)}
      </div>
    </div>
  );
}

window.VariantA = VariantA;
