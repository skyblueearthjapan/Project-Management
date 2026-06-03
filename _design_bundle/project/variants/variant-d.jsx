// Variant D — "Minimal" (Stock-inspired)
// Quiet, white, single cyan accent. Strip everything decorative.
// One row per job, one thin progress bar. Numbers tabular.
// Goal: zero visual noise. Information first, chrome second.

const { PHASES: DPH, JOBS: DJOBS } = window.PMData;

const D = {
  bg: '#ffffff',
  surface: '#ffffff',
  hair: '#eceef2',
  hair2: '#dfe2e8',
  ink: '#0c1626',
  ink2: '#5a6473',
  ink3: '#9aa3b2',
  ink4: '#c4cad3',
  accent: '#06b6d4',     // cyan from Stock theme-color
  accent2: '#0891b2',
  accentSoft: '#ecfdff',
  warn: '#b45309',
  danger: '#b91c1c',
  done: '#0c1626',       // done is just ink — quiet, not green
  font: '"Inter Tight", "Noto Sans JP", system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
};

// ============================================================
// DESKTOP
// ============================================================

function DTopbar() {
  return (
    <div style={{
      height: 56, padding: '0 28px', display: 'flex', alignItems: 'center', gap: 20,
      borderBottom: `1px solid ${D.hair}`, background: D.surface, flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <div style={{
          width: 24, height: 24, borderRadius: 5, background: D.accent,
          display: 'grid', placeItems: 'center',
        }}>
          <div style={{ width: 10, height: 10, background: D.surface, borderRadius: 1 }}/>
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-0.01em', color: D.ink }}>
          Project Management
        </div>
      </div>

      <nav style={{ display: 'flex', gap: 2, marginLeft: 12 }}>
        {[
          { l: '工番', a: true },
          { l: '出図履歴' },
          { l: '連絡先' },
          { l: '管理' },
        ].map((t, i) => (
          <a key={i} style={{
            padding: '7px 12px', fontSize: 13, fontWeight: 500,
            color: t.a ? D.ink : D.ink2, borderRadius: 6,
            background: t.a ? D.hair : 'transparent',
            cursor: 'pointer',
          }}>{t.l}</a>
        ))}
      </nav>

      <div style={{ flex: 1 }}/>

      <div style={{ position: 'relative', width: 280 }}>
        <input
          placeholder="検索…"
          style={{
            width: '100%', height: 32, padding: '0 12px 0 34px',
            background: '#f7f8fa', border: `1px solid ${D.hair}`, borderRadius: 6,
            fontSize: 13, color: D.ink, outline: 'none', fontFamily: 'inherit',
          }}
        />
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={D.ink3} strokeWidth="2.2" strokeLinecap="round"
             style={{ position: 'absolute', left: 12, top: 10 }}>
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
        </svg>
      </div>

      <button style={{
        height: 32, padding: '0 14px', borderRadius: 6, background: D.accent, color: D.surface,
        border: 'none', fontWeight: 600, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
        出図
      </button>

      <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#f7f8fa', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 600, color: D.ink2, border: `1px solid ${D.hair}` }}>山</div>
    </div>
  );
}

function DPageHead() {
  return (
    <div style={{ padding: '28px 32px 16px', borderBottom: `1px solid ${D.hair}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.015em', color: D.ink }}>工番</h1>
        <div style={{ fontSize: 12, color: D.ink3 }}>
          5件 · 進行中
        </div>
      </div>
      <div style={{ display: 'flex', gap: 18, marginTop: 14, alignItems: 'center' }}>
        {['すべて', '進行中', '期限超過', '今週', 'スター付き'].map((t, i) => (
          <button key={i} style={{
            padding: '4px 0', fontSize: 13, fontWeight: 500,
            color: i === 1 ? D.ink : D.ink2, background: 'transparent', border: 'none',
            borderBottom: i === 1 ? `2px solid ${D.accent}` : '2px solid transparent',
            cursor: 'pointer', fontFamily: 'inherit',
          }}>{t}</button>
        ))}
      </div>
    </div>
  );
}

// Phase scale — tiny, only labels for milestone phases visible at this size.
// Bar uses single accent color. Current phase = small filled dot.
function DProgressBar({ job }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ position: 'relative', height: 4, background: D.hair, borderRadius: 2 }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${job.pct}%`, background: D.accent, borderRadius: 2,
        }}/>
        {/* phase ticks (subtle) */}
        {DPH.map((p, i) => (
          <div key={p.i} style={{
            position: 'absolute', left: `${(i / DPH.length) * 100}%`,
            top: -2, bottom: -2, width: 1, background: D.surface,
          }}/>
        ))}
        {/* current dot */}
        <div style={{
          position: 'absolute', left: `${((job.nowPhase - 0.5) / DPH.length) * 100}%`,
          top: '50%', transform: 'translate(-50%, -50%)',
          width: 9, height: 9, borderRadius: '50%', background: D.surface,
          border: `2px solid ${D.accent}`,
        }}/>
      </div>
      {/* phase labels — only show every other or current */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${DPH.length}, 1fr)`, marginTop: 6 }}>
        {DPH.map((p, i) => (
          <div key={p.i} style={{
            fontSize: 9.5, color: i + 1 === job.nowPhase ? D.ink : D.ink3,
            fontWeight: i + 1 === job.nowPhase ? 600 : 400,
            textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden',
          }}>
            {p.ja}
          </div>
        ))}
      </div>
    </div>
  );
}

function DJobRow({ job }) {
  const dueColor =
    job.dueStatus === 'over' ? D.danger :
    job.dueStatus === 'warn' ? D.warn :
    D.ink2;
  return (
    <div style={{
      padding: '20px 32px', borderBottom: `1px solid ${D.hair}`, cursor: 'pointer',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
        <div style={{
          fontFamily: D.mono, fontSize: 14, fontWeight: 600, color: D.ink,
          fontVariantNumeric: 'tabular-nums', width: 70,
        }}>{job.no}</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: D.ink, letterSpacing: '-0.005em' }}>{job.customer}</div>
        <div style={{ fontSize: 13, color: D.ink3 }}>{job.product}</div>
        <div style={{ fontSize: 12, color: D.ink3 }}>· {job.axes.length}軸</div>

        <div style={{ flex: 1 }}/>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 13 }}>
          <span style={{ color: D.ink3, fontSize: 12 }}>納期</span>
          <span style={{ color: dueColor, fontWeight: 600, fontFamily: D.mono }}>{job.due}</span>
          {job.dueStatus === 'over' && (
            <span style={{ fontSize: 11, color: D.danger, marginLeft: 2 }}>· {Math.abs(job.daysLeft)}日超過</span>
          )}
          {job.dueStatus === 'warn' && (
            <span style={{ fontSize: 11, color: D.warn, marginLeft: 2 }}>· あと{job.daysLeft}日</span>
          )}
        </div>

        <div style={{ width: 70, textAlign: 'right' }}>
          <span style={{
            fontFamily: D.mono, fontSize: 14, fontWeight: 600, color: D.ink,
            fontVariantNumeric: 'tabular-nums',
          }}>{job.pct}<span style={{ color: D.ink3, fontWeight: 500 }}>%</span></span>
        </div>
      </div>

      <DProgressBar job={job}/>
    </div>
  );
}

function VariantD() {
  return (
    <div style={{
      background: D.bg, color: D.ink, width: '100%', height: '100%',
      fontFamily: D.font, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      letterSpacing: '-0.005em',
    }}>
      <DTopbar/>
      <DPageHead/>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {DJOBS.map(j => <DJobRow key={j.no} job={j}/>)}
      </div>
    </div>
  );
}

// ============================================================
// DETAIL preview — to show the same minimal language carries
// ============================================================

function VariantDDetail() {
  const job = DJOBS[0];  // 25214
  return (
    <div style={{
      background: D.bg, color: D.ink, width: '100%', height: '100%',
      fontFamily: D.font, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      letterSpacing: '-0.005em',
    }}>
      <DTopbar/>
      {/* breadcrumb + header */}
      <div style={{ padding: '20px 32px 18px', borderBottom: `1px solid ${D.hair}` }}>
        <div style={{ fontSize: 12, color: D.ink3, marginBottom: 10 }}>
          <span style={{ cursor: 'pointer' }}>工番</span>
          <span style={{ margin: '0 6px', color: D.ink4 }}>/</span>
          <span style={{ fontFamily: D.mono }}>25214</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
          <h1 style={{ margin: 0, fontFamily: D.mono, fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em' }}>25214</h1>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{job.customer}</div>
          <div style={{ fontSize: 14, color: D.ink3 }}>{job.product}</div>
          <div style={{ flex: 1 }}/>
          <div style={{ fontSize: 13, color: D.ink2 }}>納期 <span style={{ color: D.warn, fontWeight: 600, fontFamily: D.mono }}>6/30</span> <span style={{ color: D.ink3, fontSize: 12 }}>· あと12日</span></div>
          <button style={{ padding: '6px 12px', fontSize: 12.5, fontWeight: 600, color: D.ink2, background: 'transparent', border: `1px solid ${D.hair2}`, borderRadius: 6, cursor: 'pointer' }}>メール</button>
          <button style={{ padding: '6px 14px', fontSize: 12.5, fontWeight: 600, color: D.surface, background: D.accent, border: 'none', borderRadius: 6, cursor: 'pointer' }}>出図</button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', display: 'grid', gridTemplateColumns: '1fr 320px' }}>
        {/* Main: per-axis pipelines stacked */}
        <div style={{ padding: '24px 32px', borderRight: `1px solid ${D.hair}` }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: D.ink }}>軸別進捗</h2>
            <div style={{ fontSize: 12, color: D.ink3 }}>{job.axes.length}軸 · 全体 {job.pct}%</div>
          </div>
          {job.axes.map((ax, i) => (
            <div key={i} style={{ marginBottom: 22 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{ax.name}</span>
                <span style={{ fontSize: 11.5, color: D.ink3 }}>{DPH[ax.at - 1].ja}</span>
                <div style={{ flex: 1 }}/>
                <span style={{ fontFamily: D.mono, fontSize: 12, color: D.ink2, fontVariantNumeric: 'tabular-nums' }}>{ax.pct}%</span>
              </div>
              <div style={{ position: 'relative', height: 4, background: D.hair, borderRadius: 2 }}>
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${((ax.at - 1) / 10) * 100 + (ax.pct / 100) * 10}%`, background: ax.status === 'pending' ? D.ink3 : D.accent, borderRadius: 2, opacity: ax.status === 'pending' ? 0.4 : 1 }}/>
                {DPH.map((p, j) => (
                  <div key={p.i} style={{ position: 'absolute', left: `${(j / 10) * 100}%`, top: -2, bottom: -2, width: 1, background: D.surface }}/>
                ))}
                <div style={{ position: 'absolute', left: `${((ax.at - 0.5) / 10) * 100}%`, top: '50%', transform: 'translate(-50%,-50%)', width: 8, height: 8, borderRadius: '50%', background: D.surface, border: `2px solid ${ax.status === 'pending' ? D.ink3 : D.accent}` }}/>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${DPH.length}, 1fr)`, marginTop: 5 }}>
                {DPH.map((p, j) => (
                  <div key={p.i} style={{ fontSize: 9, color: j + 1 === ax.at ? D.ink : D.ink4, textAlign: 'center', fontWeight: j + 1 === ax.at ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden' }}>{p.short}</div>
                ))}
              </div>
            </div>
          ))}

          <div style={{ marginTop: 32, paddingTop: 20, borderTop: `1px solid ${D.hair}` }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>図面</h2>
              <button style={{ padding: '4px 10px', fontSize: 12, color: D.ink2, background: 'transparent', border: `1px solid ${D.hair2}`, borderRadius: 5, cursor: 'pointer' }}>＋ 追加</button>
            </div>
            {['25214_昇降.pdf', '25214_回転.pdf', '25214_本体01.dxf'].map((f, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: i < 2 ? `1px solid ${D.hair}` : 'none' }}>
                <div style={{ width: 28, height: 28, borderRadius: 4, background: D.hair, color: D.ink2, display: 'grid', placeItems: 'center', fontSize: 9, fontWeight: 700, fontFamily: D.mono }}>{f.endsWith('.dxf') ? 'DXF' : 'PDF'}</div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{f}</div>
                <div style={{ flex: 1 }}/>
                <div style={{ fontSize: 11, color: D.ink3, fontFamily: D.mono }}>5/15</div>
              </div>
            ))}
          </div>
        </div>

        {/* Right rail: activity */}
        <div style={{ padding: '24px 24px', background: '#fafbfc', overflow: 'auto' }}>
          <h2 style={{ margin: '0 0 14px', fontSize: 13, fontWeight: 600, color: D.ink2, letterSpacing: '0.04em', textTransform: 'uppercase' }}>履歴</h2>
          {[
            { t: '5/22 14:30', who: '山田', what: '工場出図 — 昇降軸' },
            { t: '5/22 11:02', who: '田中', what: '材料チェック完了 — 回転軸' },
            { t: '5/20 09:15', who: '佐藤', what: '購入発注 — 水平軸' },
            { t: '5/18 16:40', who: '山田', what: '設計出図' },
            { t: '5/15 10:00', who: '山田', what: '工番作成' },
          ].map((e, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: i < 4 ? `1px solid ${D.hair}` : 'none' }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: i === 0 ? D.accent : D.ink4, marginTop: 6, flexShrink: 0 }}/>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12.5, color: D.ink }}>{e.what}</div>
                <div style={{ fontSize: 11, color: D.ink3, marginTop: 2, fontFamily: D.mono }}>{e.t} · {e.who}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// MOBILE D
// ============================================================
function MobileD() {
  return (
    <div style={{
      background: D.bg, color: D.ink, width: '100%', height: '100%',
      fontFamily: D.font, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      letterSpacing: '-0.005em',
    }}>
      <div style={{ height: 28, background: D.surface, display: 'flex', justifyContent: 'space-between', padding: '0 18px', alignItems: 'center', fontSize: 12, fontWeight: 600, color: D.ink, fontFamily: D.mono, flexShrink: 0 }}>
        <span>9:41</span><span>•••</span>
      </div>

      <div style={{ padding: '12px 18px', background: D.surface, borderBottom: `1px solid ${D.hair}`, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 22, height: 22, borderRadius: 5, background: D.accent, display: 'grid', placeItems: 'center' }}>
          <div style={{ width: 9, height: 9, background: D.surface, borderRadius: 1 }}/>
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-0.01em' }}>工番</div>
        <div style={{ flex: 1 }}/>
        <button style={{ width: 30, height: 30, borderRadius: 6, background: 'transparent', border: `1px solid ${D.hair}`, color: D.ink2 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        </button>
        <button style={{ width: 30, height: 30, borderRadius: 6, background: D.accent, color: D.surface, border: 'none' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
        </button>
      </div>

      <div style={{ display: 'flex', gap: 18, padding: '10px 18px', borderBottom: `1px solid ${D.hair}`, flexShrink: 0, background: D.surface, overflowX: 'auto' }}>
        {['すべて', '進行中', '超過', '今週', 'スター'].map((t, i) => (
          <button key={i} style={{
            padding: '4px 0', fontSize: 12.5, fontWeight: 500,
            color: i === 1 ? D.ink : D.ink2, background: 'transparent', border: 'none',
            borderBottom: i === 1 ? `2px solid ${D.accent}` : '2px solid transparent',
            whiteSpace: 'nowrap', fontFamily: 'inherit',
          }}>{t}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {DJOBS.map(job => {
          const dueColor = job.dueStatus === 'over' ? D.danger : job.dueStatus === 'warn' ? D.warn : D.ink3;
          return (
            <div key={job.no} style={{ padding: '14px 18px', borderBottom: `1px solid ${D.hair}` }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                <span style={{ fontFamily: D.mono, fontSize: 13, fontWeight: 600 }}>{job.no}</span>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{job.customer}</span>
                <div style={{ flex: 1 }}/>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: dueColor, fontFamily: D.mono }}>{job.due}</span>
              </div>
              <div style={{ fontSize: 12, color: D.ink3, marginBottom: 10 }}>
                {job.product} · {job.axes.length}軸
              </div>
              <div style={{ position: 'relative', height: 3, background: D.hair, borderRadius: 2 }}>
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${job.pct}%`, background: D.accent, borderRadius: 2 }}/>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11.5 }}>
                <span style={{ color: D.ink2 }}>{job.nowLabel}</span>
                <span style={{ color: D.ink, fontWeight: 600, fontFamily: D.mono }}>{job.pct}%</span>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', borderTop: `1px solid ${D.hair}`, background: D.surface, paddingBottom: 8, flexShrink: 0 }}>
        {[{ l: '工番', a: true }, { l: '検索' }, { l: '通知' }, { l: 'その他' }].map((n, i) => (
          <div key={i} style={{ flex: 1, padding: '10px 0 4px', textAlign: 'center', fontSize: 10.5, fontWeight: 500, color: n.a ? D.accent : D.ink3 }}>
            <div style={{ width: 18, height: 18, margin: '0 auto 3px', borderRadius: 4, background: n.a ? D.accent : 'transparent', border: n.a ? 'none' : `1.5px solid ${D.ink3}` }}/>
            {n.l}
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { VariantD, VariantDDetail, MobileD });
