// Variation B — "Factory Console"
// Dark slate, dense, mono-heavy. Industrial control panel vibe.
// Process visualized as a numbered station chain with status pixels.

const { PHASES: BPH, JOBS: BJOBS } = window.PMData;

const B = {
  bg: '#0d1117',
  surface: '#161b22',
  surface2: '#1c232c',
  hair: '#2a323d',
  hair2: '#373f4b',
  text: '#e6edf3',
  text2: '#9aa4b2',
  text3: '#5b6573',
  mint: '#3fb78a',
  amber: '#e0a44a',
  red: '#e5534b',
  blue: '#5aa9ff',
  cyan: '#39d0d8',
  font: '"JetBrains Mono", ui-monospace, monospace',
  font2: '"Inter Tight", "Noto Sans JP", system-ui, sans-serif',
};

function BTopbar() {
  return (
    <div style={{
      height: 48, background: B.surface, borderBottom: `1px solid ${B.hair}`,
      display: 'flex', alignItems: 'center', padding: '0 16px', gap: 16, flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 24, height: 24, background: B.cyan, color: B.bg,
          display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 11, fontFamily: B.font,
          borderRadius: 3,
        }}>LW</div>
        <div style={{ fontFamily: B.font, fontSize: 12, color: B.text, fontWeight: 700, letterSpacing: '0.04em' }}>LINE_WORKS<span style={{ color: B.text3 }}>/PM</span></div>
      </div>

      <div style={{ display: 'flex', gap: 0, marginLeft: 16 }}>
        {['JOBS', 'AXES', 'RELEASES', 'MAIL', 'ADMIN'].map((t, i) => (
          <button key={t} style={{
            padding: '7px 14px', fontFamily: B.font, fontSize: 11, fontWeight: 600,
            color: i === 0 ? B.cyan : B.text2, background: 'transparent',
            border: 'none', borderBottom: i === 0 ? `2px solid ${B.cyan}` : '2px solid transparent',
            cursor: 'pointer', letterSpacing: '0.08em',
          }}>{t}</button>
        ))}
      </div>

      <div style={{ flex: 1 }}/>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: B.font, fontSize: 10.5, color: B.text2 }}>
        <span style={{ width: 6, height: 6, background: B.mint, borderRadius: '50%', boxShadow: `0 0 6px ${B.mint}` }}/>
        SV.CONNECTED
        <span style={{ color: B.text3, marginLeft: 8 }}>23-MAY 14:32:11</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: B.font, fontSize: 10.5, color: B.text2, padding: '4px 10px', background: B.surface2, borderRadius: 4, border: `1px solid ${B.hair}` }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <span style={{ color: B.text3 }}>SEARCH</span>
        <span style={{ background: B.hair, padding: '1px 5px', borderRadius: 2, fontSize: 9 }}>⌘K</span>
      </div>

      <button style={{
        padding: '6px 12px', fontFamily: B.font, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
        background: B.cyan, color: B.bg, border: 'none', borderRadius: 4, cursor: 'pointer',
      }}>＋ RELEASE</button>
    </div>
  );
}

function BStatsBar() {
  const cells = [
    { l: 'JOBS_ACTIVE', v: '5',  c: B.text },
    { l: 'OVERDUE',     v: '1',  c: B.red, glow: true },
    { l: 'DUE_THIS_WK', v: '1',  c: B.amber },
    { l: 'AXES_TOTAL',  v: '12', c: B.text },
    { l: 'AXES_INPROG', v: '11', c: B.mint },
    { l: 'AXES_PENDING',v: '1',  c: B.text2 },
    { l: 'COMPLETION',  v: '41%', c: B.cyan },
  ];
  return (
    <div style={{ display: 'flex', borderBottom: `1px solid ${B.hair}`, background: B.surface }}>
      {cells.map((c, i) => (
        <div key={i} style={{
          padding: '12px 18px', borderRight: `1px solid ${B.hair}`, flex: 1, minWidth: 0,
        }}>
          <div style={{ fontFamily: B.font, fontSize: 9, color: B.text3, letterSpacing: '0.1em', fontWeight: 600 }}>{c.l}</div>
          <div style={{
            fontFamily: B.font, fontSize: 22, fontWeight: 700, color: c.c,
            fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em',
            textShadow: c.glow ? `0 0 12px ${c.c}66` : 'none',
            marginTop: 2,
          }}>{c.v}</div>
        </div>
      ))}
    </div>
  );
}

function BStationChain({ job }) {
  // Each phase is a "station" — 10 little blocks horizontally.
  // The axes appear as a "bus" — each axis is a row of tiny pixels showing
  // which station each axis is at.
  return (
    <div style={{ marginTop: 10 }}>
      {/* Station row */}
      <div style={{ display: 'flex', gap: 2 }}>
        {BPH.map((p, i) => {
          const st = job.timeline[i];
          const isNow = i + 1 === job.nowPhase;
          const bg =
            st === 'done'    ? B.mint :
            st === 'inprog'  ? B.cyan :
            st === 'mixed'   ? B.amber :
            B.hair;
          return (
            <div key={p.i} style={{ flex: 1, position: 'relative' }}>
              <div style={{
                height: 22, background: bg,
                opacity: st === 'pending' ? 0.4 : 1,
                borderRadius: 2,
                display: 'grid', placeItems: 'center',
                fontFamily: B.font, fontSize: 10, fontWeight: 700,
                color: st === 'pending' ? B.text3 : B.bg,
                boxShadow: isNow ? `0 0 0 1.5px ${B.cyan}, 0 0 12px ${B.cyan}88` : 'none',
                position: 'relative', zIndex: isNow ? 2 : 1,
              }}>
                {String(p.i).padStart(2, '0')}
              </div>
              <div style={{
                fontFamily: B.font, fontSize: 9, color: isNow ? B.cyan : B.text3,
                marginTop: 4, textAlign: 'center', letterSpacing: '0.02em',
                fontWeight: isNow ? 700 : 500, whiteSpace: 'nowrap',
              }}>{p.short}</div>
            </div>
          );
        })}
      </div>

      {/* Axis lanes — tiny pixel rows */}
      <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 3, padding: '8px 0 0', borderTop: `1px dashed ${B.hair}` }}>
        {job.axes.map((ax, idx) => (
          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 60, fontFamily: B.font, fontSize: 10.5, color: B.text2, fontWeight: 600 }}>{ax.name}</div>
            <div style={{ flex: 1, display: 'flex', gap: 2 }}>
              {BPH.map((p, i) => {
                let bg = B.hair;
                if (i + 1 < ax.at) bg = B.mint;
                else if (i + 1 === ax.at && ax.status === 'inprog') bg = B.cyan;
                else if (i + 1 === ax.at && ax.status === 'pending') bg = B.amber;
                return (
                  <div key={p.i} style={{
                    flex: 1, height: 6, background: bg, borderRadius: 1,
                    opacity: bg === B.hair ? 0.5 : 1,
                  }}/>
                );
              })}
            </div>
            <div style={{ width: 100, fontFamily: B.font, fontSize: 10, color: B.text3, textAlign: 'right' }}>
              <span style={{ color: ax.status === 'inprog' ? B.cyan : B.amber }}>●</span> {String(ax.at).padStart(2, '0')} {BPH[ax.at - 1].short} <span style={{ color: B.text3 }}>{String(ax.pct).padStart(2, '0')}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BJobRow({ job, idx }) {
  const dueColor = job.dueStatus === 'over' ? B.red : job.dueStatus === 'warn' ? B.amber : B.text2;
  return (
    <div style={{
      padding: '14px 20px', borderBottom: `1px solid ${B.hair}`,
      background: idx % 2 === 0 ? B.bg : 'rgba(255,255,255,0.012)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ fontFamily: B.font, fontSize: 9, color: B.text3, width: 24, textAlign: 'right' }}>{String(idx + 1).padStart(2, '0')}</div>
        <div style={{
          fontFamily: B.font, fontSize: 16, fontWeight: 700, color: B.text,
          fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em', minWidth: 80,
        }}>{job.no}</div>
        <div style={{ minWidth: 160 }}>
          <div style={{ fontFamily: B.font2, fontSize: 13, fontWeight: 600, color: B.text, letterSpacing: '-0.01em' }}>{job.customer}</div>
          <div style={{ fontFamily: B.font2, fontSize: 11, color: B.text3 }}>{job.product}</div>
        </div>

        <div style={{ flex: 1 }}/>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: B.font, fontSize: 11 }}>
          <span style={{ color: B.text3 }}>DUE</span>
          <span style={{ color: dueColor, fontWeight: 700 }}>{job.due}</span>
          {job.dueStatus === 'over' && <span style={{ marginLeft: 4, padding: '1px 5px', background: B.red, color: B.bg, borderRadius: 2, fontWeight: 700, fontSize: 9 }}>OVR {Math.abs(job.daysLeft)}D</span>}
          {job.dueStatus === 'warn' && <span style={{ marginLeft: 4, color: B.amber, fontSize: 10 }}>+{job.daysLeft}D</span>}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: B.font, fontSize: 10, color: B.text3 }}>NOW</span>
          <span style={{ fontFamily: B.font, fontSize: 10, color: B.cyan, fontWeight: 700, letterSpacing: '0.04em' }}>
            {String(job.nowPhase).padStart(2, '0')} · {job.nowLabel}
          </span>
        </div>

        <div style={{
          fontFamily: B.font, fontSize: 18, fontWeight: 700, color: B.cyan,
          fontVariantNumeric: 'tabular-nums', minWidth: 56, textAlign: 'right',
          letterSpacing: '-0.02em',
        }}>{String(job.pct).padStart(2, '0')}<span style={{ fontSize: 11, color: B.text3 }}>%</span></div>

        <button style={{
          padding: '5px 10px', fontFamily: B.font, fontSize: 10, fontWeight: 700,
          background: 'transparent', color: B.text2, border: `1px solid ${B.hair2}`,
          borderRadius: 3, cursor: 'pointer', letterSpacing: '0.06em',
        }}>OPEN →</button>
      </div>

      <BStationChain job={job}/>
    </div>
  );
}

function BFilterBar() {
  return (
    <div style={{
      display: 'flex', gap: 0, padding: '8px 20px', background: B.surface,
      borderBottom: `1px solid ${B.hair}`, alignItems: 'center', fontFamily: B.font,
    }}>
      <span style={{ fontSize: 10, color: B.text3, marginRight: 12 }}>FILTER</span>
      {[
        { l: 'ALL', n: '5', active: true },
        { l: 'OVERDUE', n: '1', c: B.red },
        { l: 'THIS_WK', n: '1', c: B.amber },
        { l: 'STARRED', n: '2', c: B.cyan },
        { l: 'CLOSED', n: '24', c: B.text3 },
      ].map(f => (
        <button key={f.l} style={{
          padding: '5px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
          background: f.active ? B.surface2 : 'transparent',
          color: f.active ? B.text : (f.c || B.text2),
          border: f.active ? `1px solid ${B.hair2}` : '1px solid transparent',
          borderRadius: 3, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
          marginRight: 4,
        }}>
          {f.l}
          <span style={{ color: B.text3, fontSize: 9 }}>{f.n}</span>
        </button>
      ))}
      <div style={{ flex: 1 }}/>
      <span style={{ fontSize: 10, color: B.text3 }}>SORT: </span>
      <span style={{ fontSize: 10, color: B.text, marginLeft: 4 }}>DUE↑</span>
      <span style={{ fontSize: 10, color: B.text3, marginLeft: 16 }}>VIEW: </span>
      <span style={{ fontSize: 10, color: B.text, marginLeft: 4 }}>DENSE</span>
    </div>
  );
}

function VariantB() {
  return (
    <div style={{
      background: B.bg, color: B.text,
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      overflow: 'hidden', fontFamily: B.font2,
    }}>
      <BTopbar/>
      <BStatsBar/>
      <BFilterBar/>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {BJOBS.map((j, i) => <BJobRow key={j.no} job={j} idx={i}/>)}
      </div>
    </div>
  );
}

window.VariantB = VariantB;
