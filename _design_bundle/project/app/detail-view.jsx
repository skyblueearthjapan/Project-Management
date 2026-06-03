// Detail view — single job, axis tabs, files, activity
const { useState: useStateD } = React;

function AxisProgress({ ax }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: T.ink }}>{ax.name}</span>
        <span style={{ fontSize: 11.5, color: T.ink3 }}>
          {ax.status === 'pending' ? '未着手' : `${AppData.PHASES[ax.at - 1].ja} 進行中`}
        </span>
        <div style={{ flex: 1 }}/>
        <span style={{ fontFamily: T.mono, fontSize: 12, color: T.ink2, fontVariantNumeric: 'tabular-nums' }}>{ax.pct}%</span>
      </div>
      <div style={{ position: 'relative', height: 4, background: T.hair, borderRadius: 2 }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${((ax.at - 1) / 10) * 100 + (ax.pct / 100) * 10}%`,
          background: ax.status === 'pending' ? T.ink3 : T.accent,
          opacity: ax.status === 'pending' ? 0.35 : 1,
          borderRadius: 2,
        }}/>
        {AppData.PHASES.map((p, j) => (
          <div key={p.i} style={{
            position: 'absolute', left: `${(j / 10) * 100}%`, top: -2, bottom: -2, width: 1, background: T.surface,
          }}/>
        ))}
        <div style={{
          position: 'absolute', left: `${((ax.at - 0.5) / 10) * 100}%`, top: '50%',
          transform: 'translate(-50%,-50%)', width: 8, height: 8, borderRadius: '50%',
          background: T.surface, border: `2px solid ${ax.status === 'pending' ? T.ink3 : T.accent}`,
        }}/>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${AppData.PHASES.length}, 1fr)`, marginTop: 5 }}>
        {AppData.PHASES.map((p, j) => (
          <div key={p.i} style={{
            fontSize: 9, color: j + 1 === ax.at ? T.ink : T.ink4,
            textAlign: 'center', fontWeight: j + 1 === ax.at ? 600 : 400,
            whiteSpace: 'nowrap', overflow: 'hidden',
          }}>{p.short}</div>
        ))}
      </div>
    </div>
  );
}

function FileIcon({ type }) {
  const map = {
    pdf:  { bg: T.surfaceAlt, fg: T.danger, label: 'PDF' },
    dxf:  { bg: T.surfaceAlt, fg: T.accent, label: 'DXF' },
    xlsx: { bg: T.surfaceAlt, fg: T.ok,     label: 'XLS' },
  };
  const s = map[type] || map.pdf;
  return (
    <div style={{
      width: 32, height: 32, borderRadius: 5, background: s.bg, color: s.fg,
      display: 'grid', placeItems: 'center', fontFamily: T.mono, fontSize: 9.5,
      fontWeight: 700, letterSpacing: '0.03em', border: `1px solid ${T.hair}`,
      flexShrink: 0,
    }}>{s.label}</div>
  );
}

function PDFPreview({ job, axisName }) {
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 24, background: T.surfaceAlt }}>
      {/* PDF toolbar */}
      <div style={{
        position: 'sticky', top: 0, marginBottom: 16, height: 36,
        background: T.surface, border: `1px solid ${T.hair}`, borderRadius: 6,
        display: 'flex', alignItems: 'center', padding: '0 6px', gap: 2, zIndex: 5,
      }}>
        <button style={iconBtn()}><Icon name="up" size={12}/></button>
        <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.ink2, padding: '0 8px', minWidth: 42, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>1 / 4</span>
        <button style={iconBtn()}><Icon name="down" size={12}/></button>
        <div style={{ width: 1, height: 16, background: T.hair, margin: '0 4px' }}/>
        <button style={iconBtn()}><Icon name="zoom-out" size={12}/></button>
        <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.ink2, padding: '0 6px', minWidth: 40, textAlign: 'center' }}>100%</span>
        <button style={iconBtn()}><Icon name="zoom-in" size={12}/></button>
        <div style={{ flex: 1 }}/>
        <button style={iconBtn()}><Icon name="print" size={12}/></button>
        <button style={iconBtn()}><Icon name="download" size={12}/></button>
      </div>

      <div style={{
        background: T.surface, width: 'min(720px, 100%)', margin: '0 auto',
        aspectRatio: '1 / 1.414', border: `1px solid ${T.hair}`,
        boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 12px 32px -16px rgba(0,0,0,0.12)',
        padding: 36, position: 'relative', boxSizing: 'border-box',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: `1px solid ${T.hair}`, paddingBottom: 10, marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.ink }}>{job.product} — {axisName}</div>
          <div style={{ fontFamily: T.mono, fontSize: 11, color: T.ink3 }}>{job.no} / Rev.A</div>
        </div>
        <div style={{
          background: `repeating-linear-gradient(0deg, transparent, transparent 19px, ${T.hair} 20px),repeating-linear-gradient(90deg, transparent, transparent 19px, ${T.hair} 20px)`,
          border: `1px solid ${T.hair}`,
          height: 380, position: 'relative',
        }}>
          <svg viewBox="0 0 600 420" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%' }}>
            <rect x="100" y="320" width="400" height="40" fill="none" stroke={T.ink} strokeWidth="1.5"/>
            <rect x="180" y="80" width="240" height="240" fill="none" stroke={T.ink} strokeWidth="1.8"/>
            <circle cx="300" cy="200" r="55" fill="none" stroke={T.ink} strokeWidth="1.5"/>
            <circle cx="300" cy="200" r="20" fill="none" stroke={T.ink} strokeWidth="1.2"/>
            <line x1="245" y1="200" x2="355" y2="200" stroke={T.ink3} strokeWidth="1" strokeDasharray="4 3"/>
            <line x1="300" y1="145" x2="300" y2="255" stroke={T.ink3} strokeWidth="1" strokeDasharray="4 3"/>
            <rect x="135" y="80" width="40" height="240" fill="none" stroke={T.ink} strokeWidth="1.2"/>
            <rect x="425" y="80" width="40" height="240" fill="none" stroke={T.ink} strokeWidth="1.2"/>
          </svg>
        </div>
        <div style={{ marginTop: 16, fontSize: 11, color: T.ink3, fontFamily: T.mono }}>
          材質: SS400 t=12 / 表面処理: 黒染め / 単位: mm
        </div>
        <div style={{ position: 'absolute', right: 14, bottom: 12, fontFamily: T.mono, fontSize: 10, color: T.ink4 }}>1 / 4</div>
      </div>
    </div>
  );
}

function iconBtn() {
  return {
    width: 26, height: 26, borderRadius: 4, background: 'transparent',
    border: 'none', color: T.ink2, cursor: 'pointer',
    display: 'grid', placeItems: 'center',
  };
}

function DetailView({ jobNo, onNav, onToast }) {
  const job = AppData.JOBS.find(j => j.no === jobNo) || AppData.JOBS[0];
  const [axisIdx, setAxisIdx] = useStateD(0);
  const [tab, setTab] = useStateD('files'); // files | activity
  const axis = job.axes[axisIdx];

  return (
    <>
      {/* Breadcrumb + header */}
      <div style={{ padding: '14px 28px 14px', borderBottom: `1px solid ${T.hair}`, background: T.surface }}>
        <div style={{ fontSize: 12, color: T.ink3, marginBottom: 8 }}>
          <a onClick={() => onNav({ view: 'index' })} style={{ cursor: 'pointer' }}>工番</a>
          <span style={{ margin: '0 6px', color: T.ink4 }}>/</span>
          <span style={{ fontFamily: T.mono, color: T.ink2 }}>{job.no}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
          <h1 style={{ margin: 0, fontFamily: T.mono, fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', color: T.ink }}>{job.no}</h1>
          <div style={{ fontSize: 17, fontWeight: 600, color: T.ink }}>{job.customer}</div>
          <div style={{ fontSize: 13, color: T.ink3 }}>{job.product}</div>
          <div style={{ flex: 1 }}/>
          <div style={{ fontSize: 13, color: T.ink2 }}>
            納期 <span style={{ color: dueColorOf(job.dueStatus), fontWeight: 600, fontFamily: T.mono }}>{job.due}</span>
            {job.daysLeft !== null && (
              <span style={{ color: T.ink3, fontSize: 12, marginLeft: 6 }}>
                · {job.daysLeft < 0 ? `${Math.abs(job.daysLeft)}日超過` : `あと${job.daysLeft}日`}
              </span>
            )}
          </div>
          <button onClick={() => window.openModal('mail')} style={ghostBtn()}><Icon name="mail" size={12}/> メール</button>
          <button onClick={() => window.openModal('release')} style={primaryBtn()}><Icon name="plus" size={12} stroke={2.6}/> 出図</button>
        </div>

        {/* Axis tabs */}
        <div style={{ display: 'flex', gap: 0, marginTop: 16, borderBottom: `1px solid ${T.hair}`, marginBottom: -15 }}>
          {job.axes.map((ax, i) => (
            <button key={i} onClick={() => setAxisIdx(i)} style={{
              padding: '8px 14px', fontSize: 12.5, fontWeight: 500,
              color: axisIdx === i ? T.ink : T.ink2,
              background: 'transparent', border: 'none',
              borderBottom: axisIdx === i ? `2px solid ${T.accent}` : '2px solid transparent',
              marginBottom: -1, cursor: 'pointer', fontFamily: T.font,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: ax.status === 'done' ? T.ink2 : ax.status === 'inprog' ? T.accent : T.ink4,
              }}/>
              {ax.name}
            </button>
          ))}
          <button style={{
            padding: '8px 12px', fontSize: 12.5, color: T.ink3, background: 'transparent',
            border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontFamily: T.font,
          }}>
            <Icon name="plus" size={10} stroke={2.5}/> 追加
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{
        flex: 1, display: 'grid', gridTemplateColumns: '1fr 380px', overflow: 'hidden',
      }}>
        {/* Left: PDF preview */}
        <PDFPreview job={job} axisName={axis.name}/>

        {/* Right: progress + files + activity */}
        <div style={{
          background: T.surface, borderLeft: `1px solid ${T.hair}`,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
          {/* Selected axis progress */}
          <div style={{ padding: '18px 22px', borderBottom: `1px solid ${T.hair}` }}>
            <AxisProgress ax={axis}/>
            <button onClick={() => window.openModal('release')} style={{
              marginTop: 14, width: '100%', padding: '8px 12px', fontSize: 12.5, fontWeight: 600,
              color: T.surface, background: T.accent, border: 'none', borderRadius: 6, cursor: 'pointer',
              fontFamily: T.font,
            }}>{axis.name} を出図</button>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: `1px solid ${T.hair}` }}>
            {[
              { k: 'files',    l: '図面',  n: job.files.length },
              { k: 'activity', l: '履歴',  n: job.activity.length },
            ].map(t => (
              <button key={t.k} onClick={() => setTab(t.k)} style={{
                flex: 1, padding: '10px 12px', fontSize: 12.5, fontWeight: 600,
                color: tab === t.k ? T.ink : T.ink2,
                background: 'transparent', border: 'none',
                borderBottom: tab === t.k ? `2px solid ${T.accent}` : '2px solid transparent',
                cursor: 'pointer', fontFamily: T.font, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
                {t.l}
                <span style={{ fontSize: 10.5, color: T.ink3, fontFamily: T.mono, fontVariantNumeric: 'tabular-nums' }}>{t.n}</span>
              </button>
            ))}
          </div>

          <div style={{ flex: 1, overflow: 'auto' }}>
            {tab === 'files' && (
              <div>
                {job.files.length === 0 && (
                  <div style={{ padding: 32, textAlign: 'center', color: T.ink3, fontSize: 12 }}>
                    図面はまだありません
                  </div>
                )}
                {job.files.map((f, i) => (
                  <div key={i} onClick={() => f.type === 'dxf' && onNav({ view: 'dxf', file: f.name })} style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 22px',
                    borderBottom: `1px solid ${T.hair}`,
                    cursor: f.type === 'dxf' ? 'pointer' : 'default',
                    transition: 'background 0.1s',
                  }}
                    onMouseEnter={e => e.currentTarget.style.background = T.surfaceAlt}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <FileIcon type={f.type}/>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: T.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                      <div style={{ fontSize: 11, color: T.ink3, marginTop: 1 }}>{f.axis} · <span style={{ fontFamily: T.mono }}>{f.date}</span></div>
                    </div>
                    <button style={iconBtn()}><Icon name="more" size={14}/></button>
                  </div>
                ))}
              </div>
            )}
            {tab === 'activity' && (
              <div style={{ padding: '4px 22px' }}>
                {job.activity.length === 0 && (
                  <div style={{ padding: 28, textAlign: 'center', color: T.ink3, fontSize: 12 }}>履歴はまだありません</div>
                )}
                {job.activity.map((e, i) => (
                  <div key={i} style={{
                    display: 'flex', gap: 10, padding: '12px 0',
                    borderBottom: i < job.activity.length - 1 ? `1px solid ${T.hair}` : 'none',
                  }}>
                    <div style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: i === 0 ? T.accent : T.ink4, marginTop: 7, flexShrink: 0,
                    }}/>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12.5, color: T.ink }}>{e.what}</div>
                      <div style={{ fontSize: 11, color: T.ink3, marginTop: 2, fontFamily: T.mono }}>{e.t} · {e.who}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function ghostBtn() {
  return {
    padding: '6px 11px', fontSize: 12.5, fontWeight: 600, color: T.ink2,
    background: 'transparent', border: `1px solid ${T.hair2}`, borderRadius: 6,
    cursor: 'pointer', fontFamily: T.font, display: 'flex', alignItems: 'center', gap: 5,
  };
}
function primaryBtn() {
  return {
    padding: '6px 13px', fontSize: 12.5, fontWeight: 600, color: T.surface,
    background: T.accent, border: 'none', borderRadius: 6, cursor: 'pointer',
    fontFamily: T.font, display: 'flex', alignItems: 'center', gap: 5,
  };
}

Object.assign(window, { DetailView, ghostBtn, primaryBtn, iconBtn, FileIcon, AxisProgress });
