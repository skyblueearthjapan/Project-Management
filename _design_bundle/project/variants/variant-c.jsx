// Variation C — "River Flow"
// Novel: process as a horizontal pipeline. Each job's axes are "cars"
// sitting at their current station. Bottleneck where multiple cars stack.
// Hero up top shows the WHOLE FACTORY at a glance — all axes across all
// jobs distributed across the 10 phases. Glanceable, spatial.

const { PHASES: CPH, JOBS: CJOBS } = window.PMData;

const C = {
  bg: '#0a1428',
  panel: '#0f1c36',
  panel2: '#16264a',
  ink: '#e8eef9',
  ink2: '#9eafcc',
  ink3: '#5d6f8e',
  hair: '#1f3055',
  hair2: '#2a3e6b',

  // axis tokens by status (cool palette, no neon clichés)
  done:   '#3fb78a',
  inprog: '#7cb8ff',
  warn:   '#f0b04a',
  danger: '#ef6b6b',
  // accents for the brand
  accent: '#f0e7d2',  // warm cream as contrast
  star:   '#f0b04a',

  font: '"Inter Tight", "Noto Sans JP", system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
};

function CTopbar() {
  return (
    <div style={{
      height: 56, background: C.panel, borderBottom: `1px solid ${C.hair}`,
      display: 'flex', alignItems: 'center', padding: '0 24px', gap: 20, flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 30, height: 30, background: C.accent, color: C.bg, borderRadius: 7,
          display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 12,
          fontFamily: C.mono,
        }}>LW</div>
        <div style={{ fontFamily: C.font, fontSize: 14, color: C.ink, fontWeight: 700, letterSpacing: '-0.01em' }}>
          LINE WORKS <span style={{ color: C.ink3, fontWeight: 500 }}>· PM</span>
        </div>
      </div>

      <div style={{ flex: 1, maxWidth: 420, position: 'relative' }}>
        <input
          placeholder="工番・納入先・軸名で検索…"
          style={{
            width: '100%', height: 34, padding: '0 14px 0 36px',
            background: C.panel2, border: `1px solid ${C.hair}`, borderRadius: 8,
            fontSize: 12.5, color: C.ink, outline: 'none', fontFamily: 'inherit',
          }}
        />
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.ink3} strokeWidth="2" strokeLinecap="round"
             style={{ position: 'absolute', left: 12, top: 10 }}>
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
        </svg>
      </div>

      <div style={{ flex: 1 }}/>

      <div style={{ display: 'flex', gap: 4 }}>
        {['Today', 'Week', 'Month'].map((t, i) => (
          <button key={t} style={{
            padding: '6px 12px', fontSize: 12, fontWeight: 600,
            background: i === 1 ? C.panel2 : 'transparent',
            color: i === 1 ? C.ink : C.ink2,
            border: i === 1 ? `1px solid ${C.hair2}` : '1px solid transparent',
            borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
          }}>{t}</button>
        ))}
      </div>

      <button style={{
        height: 34, padding: '0 16px', borderRadius: 8, background: C.accent, color: C.bg,
        border: 'none', fontWeight: 700, fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6,
        fontFamily: 'inherit', cursor: 'pointer',
      }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
        出図
      </button>

      <div style={{ width: 30, height: 30, borderRadius: '50%', background: C.panel2, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, color: C.ink, border: `1px solid ${C.hair2}` }}>山</div>
    </div>
  );
}

// Hero: factory pipeline overview — all axes across all jobs distributed
// over the 10 phases. Shows bottlenecks instantly.
function CFactoryHero() {
  // Bucket axes by phase
  const buckets = CPH.map(p => ({
    phase: p, axes: []
  }));
  CJOBS.forEach(job => {
    job.axes.forEach(ax => {
      buckets[ax.at - 1].axes.push({ job, ax });
    });
  });

  return (
    <div style={{
      padding: '20px 24px', background: C.panel,
      borderBottom: `1px solid ${C.hair}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <h2 style={{
            margin: 0, fontSize: 16, fontWeight: 700, color: C.ink, letterSpacing: '-0.01em',
          }}>工場フロー <span style={{ color: C.ink3, fontWeight: 500, fontSize: 12, marginLeft: 6 }}>全 12軸 · 5工番</span></h2>
          <div style={{ fontSize: 11, color: C.ink3, marginTop: 3 }}>各軸が現在どの工程にいるかを一望できます。停滞している工程に色がつきます。</div>
        </div>
        <div style={{ display: 'flex', gap: 12, fontSize: 11, color: C.ink2 }}>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: C.inprog, marginRight: 6, verticalAlign: 'middle' }}/>進行中</span>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: C.warn, marginRight: 6, verticalAlign: 'middle' }}/>停滞</span>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: C.danger, marginRight: 6, verticalAlign: 'middle' }}/>期限超過</span>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: C.ink3, marginRight: 6, verticalAlign: 'middle' }}/>未着手</span>
        </div>
      </div>

      {/* River: phases as columns */}
      <div style={{
        display: 'grid', gridTemplateColumns: `repeat(${CPH.length}, 1fr)`,
        gap: 4, background: C.bg, padding: 10, borderRadius: 10, border: `1px solid ${C.hair}`,
        position: 'relative',
      }}>
        {/* phase headers + buckets */}
        {buckets.map((b, i) => {
          const count = b.axes.length;
          const isBottleneck = count >= 4;
          return (
            <div key={i} style={{ minHeight: 120, position: 'relative' }}>
              {/* header */}
              <div style={{ textAlign: 'center', marginBottom: 8 }}>
                <div style={{ fontFamily: C.mono, fontSize: 9.5, color: C.ink3, fontWeight: 600 }}>
                  {String(b.phase.i).padStart(2, '0')}
                </div>
                <div style={{
                  fontSize: 10.5, fontWeight: 700,
                  color: count > 0 ? C.ink : C.ink3,
                  letterSpacing: '0.02em',
                }}>{b.phase.ja}</div>
                <div style={{
                  fontFamily: C.mono, fontSize: 10, fontWeight: 700,
                  color: isBottleneck ? C.warn : (count > 0 ? C.inprog : C.ink3),
                  marginTop: 2,
                }}>{count} 軸</div>
              </div>
              {/* axis chips */}
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 3,
                background: count > 0 ? `linear-gradient(180deg, ${C.panel2} 0%, transparent 100%)` : 'transparent',
                padding: count > 0 ? '6px 4px' : 0, borderRadius: 6,
                border: isBottleneck ? `1px solid ${C.warn}66` : 'none',
              }}>
                {b.axes.map((entry, j) => {
                  const isOver = entry.job.dueStatus === 'over';
                  const isWarn = entry.job.dueStatus === 'warn';
                  const dotColor = isOver ? C.danger : isWarn ? C.warn : entry.ax.status === 'pending' ? C.ink3 : C.inprog;
                  return (
                    <div key={j} style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      background: C.panel2, padding: '4px 6px', borderRadius: 4,
                      borderLeft: `2px solid ${dotColor}`,
                      fontSize: 10,
                    }}>
                      <span style={{ fontFamily: C.mono, color: C.ink2, fontWeight: 600 }}>{entry.job.no.slice(-3)}</span>
                      <span style={{ color: C.ink, fontWeight: 600, fontSize: 10 }}>{entry.ax.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* connecting line under headers */}
        <div style={{
          position: 'absolute', left: 14, right: 14, top: 50,
          height: 1, background: `linear-gradient(90deg, ${C.hair} 0%, ${C.hair2} 50%, ${C.hair} 100%)`,
          pointerEvents: 'none',
        }}/>
      </div>
    </div>
  );
}

// Per-job pipeline row
function CPipeline({ job }) {
  return (
    <div style={{ marginTop: 12, padding: '10px 12px', background: C.panel, borderRadius: 8, border: `1px solid ${C.hair}` }}>
      {/* track */}
      <div style={{
        position: 'relative', height: 28,
        background: C.bg, borderRadius: 14,
        overflow: 'hidden',
      }}>
        {/* filled portion */}
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${job.pct}%`,
          background: `linear-gradient(90deg, ${C.done}22 0%, ${C.inprog}44 100%)`,
        }}/>
        {/* phase dividers */}
        {CPH.map((p, i) => (
          <div key={p.i} style={{
            position: 'absolute', left: `${(i / CPH.length) * 100}%`, top: 4, bottom: 4,
            width: 1, background: C.hair,
          }}/>
        ))}
        {/* axis tokens */}
        {job.axes.map((ax, i) => {
          const left = ((ax.at - 0.5) / CPH.length) * 100;
          const vertical = (i - (job.axes.length - 1) / 2) * 14;
          const isOver = job.dueStatus === 'over';
          const color = isOver ? C.danger : ax.status === 'pending' ? C.ink3 : C.inprog;
          return (
            <div key={i} style={{
              position: 'absolute', left: `${left}%`, top: '50%',
              transform: `translate(-50%, calc(-50% + ${vertical * 0}px))`,
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '3px 7px', background: C.panel2,
              borderRadius: 999, border: `1.5px solid ${color}`,
              boxShadow: ax.status === 'inprog' ? `0 0 0 3px ${color}22` : 'none',
              fontSize: 10, fontWeight: 700, color: C.ink,
              fontFamily: C.font, whiteSpace: 'nowrap', zIndex: 2,
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: color }}/>
              {ax.name}
            </div>
          );
        })}
      </div>
      {/* phase scale */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${CPH.length}, 1fr)`, marginTop: 6 }}>
        {CPH.map((p, i) => (
          <div key={p.i} style={{
            fontSize: 8.5, color: i + 1 === job.nowPhase ? C.inprog : C.ink3,
            fontWeight: i + 1 === job.nowPhase ? 700 : 500,
            textAlign: 'center', fontFamily: C.font,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            <span style={{ fontFamily: C.mono, opacity: 0.6 }}>{String(p.i).padStart(2, '0')}</span> {p.short}
          </div>
        ))}
      </div>
    </div>
  );
}

function CJobCard({ job }) {
  const dueColor = job.dueStatus === 'over' ? C.danger : job.dueStatus === 'warn' ? C.warn : C.ink2;
  return (
    <div style={{
      padding: '16px 24px', borderBottom: `1px solid ${C.hair}`,
      cursor: 'pointer',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        {job.starred ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill={C.star}><path d="M12 2l3 6.5 7 1-5 5 1.5 7L12 18l-6.5 3.5L7 14.5l-5-5 7-1z"/></svg>
        ) : <span style={{ width: 14 }}/>}
        <div style={{
          fontFamily: C.mono, fontSize: 16, fontWeight: 700, color: C.ink,
          fontVariantNumeric: 'tabular-nums',
        }}>{job.no}</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, letterSpacing: '-0.01em' }}>{job.customer}</div>
        <div style={{ fontSize: 12, color: C.ink2 }}>{job.product}</div>

        <div style={{ flex: 1 }}/>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5 }}>
          <span style={{ color: C.ink3 }}>納期</span>
          <span style={{ color: dueColor, fontWeight: 700, fontFamily: C.mono }}>{job.due}</span>
          {job.dueStatus === 'over' && (
            <span style={{ padding: '2px 7px', background: `${C.danger}22`, color: C.danger, borderRadius: 4, fontWeight: 700, fontSize: 10.5, border: `1px solid ${C.danger}55` }}>{Math.abs(job.daysLeft)}日超過</span>
          )}
          {job.dueStatus === 'warn' && (
            <span style={{ padding: '2px 7px', background: `${C.warn}22`, color: C.warn, borderRadius: 4, fontWeight: 700, fontSize: 10.5, border: `1px solid ${C.warn}55` }}>あと{job.daysLeft}日</span>
          )}
        </div>

        <div style={{
          width: 70, padding: '4px 10px', background: C.panel, borderRadius: 6,
          border: `1px solid ${C.hair2}`, textAlign: 'center',
        }}>
          <div style={{ fontFamily: C.mono, fontSize: 17, fontWeight: 700, color: C.ink, lineHeight: 1 }}>{job.pct}<span style={{ fontSize: 10, color: C.ink3 }}>%</span></div>
          <div style={{ fontSize: 9, color: C.ink3, marginTop: 1, letterSpacing: '0.05em' }}>{job.axes.length}軸</div>
        </div>
      </div>
      <CPipeline job={job}/>
    </div>
  );
}

function VariantC() {
  return (
    <div style={{
      background: C.bg, color: C.ink,
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      overflow: 'hidden', fontFamily: C.font,
    }}>
      <CTopbar/>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <CFactoryHero/>
        <div style={{ padding: '12px 24px 6px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>工番別パイプライン</h2>
          <span style={{ fontSize: 11, color: C.ink3 }}>5件</span>
        </div>
        <div>
          {CJOBS.map(j => <CJobCard key={j.no} job={j}/>)}
        </div>
      </div>
    </div>
  );
}

window.VariantC = VariantC;
