// Mobile variants — phone adaptations of A, B, C
const { PHASES: MPH, JOBS: MJOBS } = window.PMData;

// ============================================================
// MOBILE A — Editorial (light, calm)
// ============================================================
const MA = {
  bg: '#f4f1ea', surface: '#fbf9f4', ink: '#0e1b3a', ink2: '#3a4564', ink3: '#7a8198',
  hair: '#e4ddcd', cream: '#efeadb', warn: '#c47a1c', danger: '#b8392f',
};

function MobileA() {
  return (
    <div style={{
      background: MA.bg, color: MA.ink, width: '100%', height: '100%',
      fontFamily: '"Inter Tight", "Noto Sans JP", system-ui, sans-serif',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      letterSpacing: '-0.005em',
    }}>
      {/* status bar */}
      <div style={{ height: 28, background: MA.surface, display: 'flex', justifyContent: 'space-between', padding: '0 18px', alignItems: 'center', fontSize: 12, fontWeight: 600, color: MA.ink, fontFamily: '"JetBrains Mono", monospace', flexShrink: 0 }}>
        <span>9:41</span>
        <span style={{ display: 'flex', gap: 4 }}>•••</span>
      </div>
      {/* topbar */}
      <div style={{ padding: '14px 18px 12px', background: MA.surface, borderBottom: `1px solid ${MA.hair}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 11, color: MA.ink3, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700 }}>5月23日(金)</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ width: 32, height: 32, borderRadius: 8, background: 'transparent', border: `1px solid ${MA.hair}`, color: MA.ink2 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            </button>
            <button style={{ width: 32, height: 32, borderRadius: 8, background: MA.ink, color: MA.surface, border: 'none' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
            </button>
          </div>
        </div>
        <h1 style={{ margin: '8px 0 0', fontSize: 26, fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1 }}>工番一覧</h1>
        <div style={{ display: 'flex', gap: 16, marginTop: 12, alignItems: 'baseline' }}>
          {[{ n: '5', l: '進行中' }, { n: '1', l: '超過', c: MA.danger }, { n: '1', l: '今週', c: MA.warn }].map((s, i) => (
            <div key={i}>
              <div style={{ fontSize: 20, fontWeight: 700, color: s.c || MA.ink, letterSpacing: '-0.03em', lineHeight: 1, fontFamily: '"Inter Tight", monospace', fontVariantNumeric: 'tabular-nums' }}>{s.n}</div>
              <div style={{ fontSize: 9.5, color: MA.ink3, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600, marginTop: 3 }}>{s.l}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, padding: '10px 18px', overflowX: 'auto', flexShrink: 0, background: MA.surface, borderBottom: `1px solid ${MA.hair}` }}>
        {['すべて', '進行中', '超過', '今週', 'スター'].map((t, i) => (
          <button key={i} style={{
            padding: '6px 12px', fontSize: 11.5, fontWeight: 600,
            background: i === 1 ? MA.ink : 'transparent', color: i === 1 ? MA.surface : MA.ink2,
            border: i === 1 ? 'none' : `1px solid ${MA.hair}`, borderRadius: 999,
            whiteSpace: 'nowrap', fontFamily: 'inherit',
          }}>{t}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto', background: MA.surface }}>
        {MJOBS.map(job => {
          const dueColor = job.dueStatus === 'over' ? MA.danger : job.dueStatus === 'warn' ? MA.warn : MA.ink3;
          return (
            <div key={job.no} style={{ padding: '14px 18px', borderBottom: `1px solid ${MA.hair}` }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                {job.starred && <svg width="11" height="11" viewBox="0 0 24 24" fill={MA.ink}><path d="M12 2l3 6.5 7 1-5 5 1.5 7L12 18l-6.5 3.5L7 14.5l-5-5 7-1z"/></svg>}
                <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 14, fontWeight: 700, letterSpacing: '-0.01em' }}>{job.no}</span>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{job.customer}</span>
                <div style={{ flex: 1 }}/>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: dueColor, fontFamily: '"JetBrains Mono", monospace' }}>{job.due}</span>
              </div>
              <div style={{ fontSize: 12, color: MA.ink3, marginBottom: 10 }}>{job.product} · {job.axes.length}軸</div>
              {/* ribbon mini */}
              <div style={{ position: 'relative', height: 6, background: MA.cream, borderRadius: 999, marginBottom: 6 }}>
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${job.pct}%`, background: MA.ink, borderRadius: 999 }}/>
                <div style={{ position: 'absolute', left: `${(job.nowPhase - 0.5) * 10}%`, top: '50%', transform: 'translate(-50%,-50%)', width: 12, height: 12, borderRadius: '50%', background: MA.surface, border: `2px solid ${MA.ink}` }}/>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11.5 }}>
                <span style={{ color: MA.ink2 }}><span style={{ fontFamily: '"JetBrains Mono", monospace', fontWeight: 700, color: MA.ink }}>{String(job.nowPhase).padStart(2, '0')}</span> {job.nowLabel}</span>
                <span style={{ fontWeight: 700, color: MA.ink, fontFamily: '"Inter Tight", monospace', fontVariantNumeric: 'tabular-nums' }}>{job.pct}%</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* bottom nav */}
      <div style={{ display: 'flex', borderTop: `1px solid ${MA.hair}`, background: MA.surface, flexShrink: 0, paddingBottom: 8 }}>
        {[{ l: '一覧', a: true }, { l: '検索' }, { l: '通知' }, { l: 'その他' }].map((n, i) => (
          <div key={i} style={{ flex: 1, padding: '10px 0 4px', textAlign: 'center', fontSize: 10.5, fontWeight: 600, color: n.a ? MA.ink : MA.ink3 }}>
            <div style={{ width: 18, height: 18, margin: '0 auto 3px', borderRadius: 4, background: n.a ? MA.ink : 'transparent', border: n.a ? 'none' : `1.5px solid ${MA.ink3}` }}/>
            {n.l}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// MOBILE B — Console (dark, dense, monospace)
// ============================================================
const MB = {
  bg: '#0d1117', surface: '#161b22', surface2: '#1c232c',
  hair: '#2a323d', hair2: '#373f4b',
  text: '#e6edf3', text2: '#9aa4b2', text3: '#5b6573',
  mint: '#3fb78a', amber: '#e0a44a', red: '#e5534b', cyan: '#39d0d8',
  mono: '"JetBrains Mono", monospace',
};

function MobileB() {
  return (
    <div style={{
      background: MB.bg, color: MB.text, width: '100%', height: '100%',
      fontFamily: '"Inter Tight", "Noto Sans JP", system-ui, sans-serif',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <div style={{ height: 28, background: MB.surface, display: 'flex', justifyContent: 'space-between', padding: '0 18px', alignItems: 'center', fontSize: 12, fontWeight: 600, color: MB.text, fontFamily: MB.mono, flexShrink: 0 }}>
        <span>9:41</span><span>•••</span>
      </div>
      <div style={{ padding: '12px 14px', background: MB.surface, borderBottom: `1px solid ${MB.hair}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 24, height: 24, background: MB.cyan, color: MB.bg, display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 10, fontFamily: MB.mono, borderRadius: 3 }}>LW</div>
          <div style={{ fontFamily: MB.mono, fontSize: 11, color: MB.text, fontWeight: 700, letterSpacing: '0.04em' }}>LINE_WORKS<span style={{ color: MB.text3 }}>/PM</span></div>
          <div style={{ flex: 1 }}/>
          <span style={{ fontFamily: MB.mono, fontSize: 9, color: MB.text3, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 5, height: 5, background: MB.mint, borderRadius: '50%' }}/>LIVE
          </span>
        </div>
      </div>
      {/* stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', background: MB.surface, borderBottom: `1px solid ${MB.hair}`, flexShrink: 0 }}>
        {[
          { l: 'JOBS', v: '5', c: MB.text },
          { l: 'OVER', v: '1', c: MB.red },
          { l: 'WEEK', v: '1', c: MB.amber },
          { l: 'AXES', v: '12', c: MB.cyan },
        ].map((s, i) => (
          <div key={i} style={{ padding: '10px 8px', borderRight: i < 3 ? `1px solid ${MB.hair}` : 'none' }}>
            <div style={{ fontFamily: MB.mono, fontSize: 8.5, color: MB.text3, letterSpacing: '0.1em' }}>{s.l}</div>
            <div style={{ fontFamily: MB.mono, fontSize: 18, fontWeight: 700, color: s.c, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{s.v}</div>
          </div>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {MJOBS.map((job, idx) => {
          const dueColor = job.dueStatus === 'over' ? MB.red : job.dueStatus === 'warn' ? MB.amber : MB.text2;
          return (
            <div key={job.no} style={{ padding: '10px 14px', borderBottom: `1px solid ${MB.hair}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontFamily: MB.mono, fontSize: 9, color: MB.text3, width: 18 }}>{String(idx + 1).padStart(2, '0')}</span>
                <span style={{ fontFamily: MB.mono, fontSize: 13, fontWeight: 700, color: MB.text }}>{job.no}</span>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{job.customer}</span>
                <div style={{ flex: 1 }}/>
                <span style={{ fontFamily: MB.mono, fontSize: 11, color: dueColor, fontWeight: 700 }}>{job.due}</span>
                {job.dueStatus === 'over' && <span style={{ padding: '1px 4px', background: MB.red, color: MB.bg, borderRadius: 2, fontFamily: MB.mono, fontSize: 8, fontWeight: 700 }}>OVR</span>}
              </div>
              {/* stations */}
              <div style={{ display: 'flex', gap: 2, marginBottom: 4 }}>
                {MPH.map((p, i) => {
                  const st = job.timeline[i];
                  const isNow = i + 1 === job.nowPhase;
                  const bg = st === 'done' ? MB.mint : st === 'inprog' ? MB.cyan : st === 'mixed' ? MB.amber : MB.hair;
                  return (
                    <div key={p.i} style={{
                      flex: 1, height: 18, background: bg, opacity: st === 'pending' ? 0.4 : 1,
                      borderRadius: 2, display: 'grid', placeItems: 'center',
                      fontFamily: MB.mono, fontSize: 8.5, fontWeight: 700,
                      color: st === 'pending' ? MB.text3 : MB.bg,
                      boxShadow: isNow ? `0 0 0 1.5px ${MB.cyan}` : 'none',
                    }}>{String(p.i).padStart(2, '0')}</div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: MB.mono, fontSize: 10 }}>
                <span style={{ color: MB.cyan }}>{String(job.nowPhase).padStart(2, '0')} {job.nowLabel}</span>
                <span style={{ color: MB.text2 }}>{job.axes.length} AX · <span style={{ color: MB.cyan, fontWeight: 700 }}>{String(job.pct).padStart(2, '0')}%</span></span>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', borderTop: `1px solid ${MB.hair}`, background: MB.surface, paddingBottom: 8, flexShrink: 0 }}>
        {['JOBS', 'AXES', 'MAIL', 'MORE'].map((l, i) => (
          <div key={i} style={{ flex: 1, padding: '10px 0 4px', textAlign: 'center', fontFamily: MB.mono, fontSize: 9, fontWeight: 700, color: i === 0 ? MB.cyan : MB.text3, letterSpacing: '0.08em' }}>
            <div style={{ width: 16, height: 16, margin: '0 auto 4px', background: i === 0 ? MB.cyan : MB.hair, borderRadius: 2 }}/>
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// MOBILE C — River (pipeline)
// ============================================================
const MC = {
  bg: '#0a1428', panel: '#0f1c36', panel2: '#16264a',
  ink: '#e8eef9', ink2: '#9eafcc', ink3: '#5d6f8e',
  hair: '#1f3055', hair2: '#2a3e6b',
  inprog: '#7cb8ff', warn: '#f0b04a', danger: '#ef6b6b', done: '#3fb78a',
  accent: '#f0e7d2', star: '#f0b04a',
  mono: '"JetBrains Mono", monospace',
};

function MobileC() {
  return (
    <div style={{
      background: MC.bg, color: MC.ink, width: '100%', height: '100%',
      fontFamily: '"Inter Tight", "Noto Sans JP", system-ui, sans-serif',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <div style={{ height: 28, background: MC.panel, display: 'flex', justifyContent: 'space-between', padding: '0 18px', alignItems: 'center', fontSize: 12, fontWeight: 600, color: MC.ink, fontFamily: MC.mono, flexShrink: 0 }}>
        <span>9:41</span><span>•••</span>
      </div>
      <div style={{ padding: '14px 18px', background: MC.panel, borderBottom: `1px solid ${MC.hair}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div style={{ width: 26, height: 26, background: MC.accent, color: MC.bg, borderRadius: 6, display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 11, fontFamily: MC.mono }}>LW</div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>工場フロー</div>
          <div style={{ flex: 1 }}/>
          <span style={{ fontSize: 11, color: MC.ink3 }}>12軸</span>
        </div>
        {/* mini factory flow */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 2 }}>
          {MPH.map((p, i) => {
            const count = MJOBS.reduce((acc, j) => acc + j.axes.filter(a => a.at === i + 1).length, 0);
            const bottleneck = count >= 4;
            return (
              <div key={p.i} style={{ textAlign: 'center' }}>
                <div style={{
                  height: 26, borderRadius: 3,
                  background: count > 0 ? (bottleneck ? `${MC.warn}66` : MC.panel2) : 'transparent',
                  border: `1px solid ${bottleneck ? MC.warn : MC.hair}`,
                  display: 'grid', placeItems: 'center',
                  fontFamily: MC.mono, fontSize: 10, fontWeight: 700,
                  color: count > 0 ? MC.ink : MC.ink3,
                }}>{count || '·'}</div>
                <div style={{ fontFamily: MC.mono, fontSize: 7.5, color: MC.ink3, marginTop: 2 }}>{String(p.i).padStart(2, '0')}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {MJOBS.map(job => {
          const dueColor = job.dueStatus === 'over' ? MC.danger : job.dueStatus === 'warn' ? MC.warn : MC.ink2;
          return (
            <div key={job.no} style={{ padding: '14px 18px', borderBottom: `1px solid ${MC.hair}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                {job.starred && <svg width="11" height="11" viewBox="0 0 24 24" fill={MC.star}><path d="M12 2l3 6.5 7 1-5 5 1.5 7L12 18l-6.5 3.5L7 14.5l-5-5 7-1z"/></svg>}
                <span style={{ fontFamily: MC.mono, fontSize: 13, fontWeight: 700 }}>{job.no}</span>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{job.customer}</span>
                <div style={{ flex: 1 }}/>
                <span style={{ fontSize: 11, color: dueColor, fontWeight: 700, fontFamily: MC.mono }}>{job.due}</span>
              </div>
              {/* pipeline */}
              <div style={{ position: 'relative', height: 24, background: MC.bg, borderRadius: 12, overflow: 'visible', border: `1px solid ${MC.hair}` }}>
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${job.pct}%`, background: `linear-gradient(90deg, ${MC.done}22, ${MC.inprog}33)`, borderRadius: 12 }}/>
                {job.axes.map((ax, i) => {
                  const left = ((ax.at - 0.5) / MPH.length) * 100;
                  const color = job.dueStatus === 'over' ? MC.danger : MC.inprog;
                  return (
                    <div key={i} style={{
                      position: 'absolute', left: `${left}%`, top: '50%', transform: 'translate(-50%,-50%)',
                      padding: '2px 6px', background: MC.panel2, borderRadius: 999,
                      border: `1.5px solid ${color}`, fontSize: 9, fontWeight: 700, color: MC.ink,
                      whiteSpace: 'nowrap', zIndex: 2,
                    }}>{ax.name}</div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11 }}>
                <span style={{ color: MC.ink2 }}>{job.product}</span>
                <span style={{ fontWeight: 700, fontFamily: MC.mono, color: MC.ink }}>{job.pct}%</span>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', borderTop: `1px solid ${MC.hair}`, background: MC.panel, paddingBottom: 8, flexShrink: 0 }}>
        {[{ l: 'フロー', a: true }, { l: '工番' }, { l: '出図' }, { l: 'その他' }].map((n, i) => (
          <div key={i} style={{ flex: 1, padding: '10px 0 4px', textAlign: 'center', fontSize: 10.5, fontWeight: 600, color: n.a ? MC.accent : MC.ink3 }}>
            <div style={{ width: 18, height: 18, margin: '0 auto 3px', borderRadius: 4, background: n.a ? MC.accent : 'transparent', border: n.a ? 'none' : `1.5px solid ${MC.ink3}` }}/>
            {n.l}
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { MobileA, MobileB, MobileC });
