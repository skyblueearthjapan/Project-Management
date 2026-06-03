// Mobile views — Index, Detail, Admin
const { useState: useStateMo } = React;

function MobileTopbar({ title, onBack, right }) {
  return (
    <div style={{ padding: '10px 16px', background: T.surface, borderBottom: `1px solid ${T.hair}`, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
      {onBack ? (
        <button onClick={onBack} style={{ width: 28, height: 28, borderRadius: 6, background: 'transparent', border: 'none', color: T.ink, cursor: 'pointer', display: 'grid', placeItems: 'center', marginLeft: -6 }}>
          <Icon name="back" size={16}/>
        </button>
      ) : (
        <div style={{ width: 22, height: 22, borderRadius: 5, background: T.accent, display: 'grid', placeItems: 'center' }}>
          <div style={{ width: 9, height: 9, background: T.surface, borderRadius: 1 }}/>
        </div>
      )}
      <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em', color: T.ink }}>{title}</div>
      <div style={{ flex: 1 }}/>
      {right}
    </div>
  );
}

function MobileStatusBar() {
  return (
    <div style={{ height: 28, background: T.surface, display: 'flex', justifyContent: 'space-between', padding: '0 18px', alignItems: 'center', fontSize: 12, fontWeight: 600, color: T.ink, fontFamily: T.mono, flexShrink: 0 }}>
      <span>9:41</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: T.ink2 }}>
        <span style={{ width: 14, height: 8, border: `1.2px solid ${T.ink2}`, borderRadius: 2, position: 'relative' }}>
          <span style={{ position: 'absolute', inset: 1, width: 8, background: T.ink2, borderRadius: 1 }}/>
        </span>
      </span>
    </div>
  );
}

function MobileBottomNav({ tab, onTab }) {
  const items = [
    { k: 'index',  l: '工番',  icon: 'home' },
    { k: 'search', l: '検索', icon: 'search' },
    { k: 'admin',  l: '管理', icon: 'settings' },
  ];
  return (
    <div style={{ display: 'flex', borderTop: `1px solid ${T.hair}`, background: T.surface, paddingBottom: 8, flexShrink: 0 }}>
      {items.map((n, i) => (
        <button key={i} onClick={() => onTab(n.k)} style={{
          flex: 1, padding: '8px 0 4px', textAlign: 'center',
          fontSize: 10.5, fontWeight: 500, color: tab === n.k ? T.accent : T.ink3,
          background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: T.font,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
        }}>
          <Icon name={n.icon} size={18} stroke={tab === n.k ? 2.2 : 1.8}/>
          {n.l}
        </button>
      ))}
    </div>
  );
}

function MobileIndex({ onNav }) {
  const [filter, setFilter] = useStateMo('inprog');
  const jobs = AppData.JOBS;
  return (
    <>
      <MobileTopbar title="工番" right={
        <>
          <button style={{ width: 30, height: 30, borderRadius: 6, background: 'transparent', border: `1px solid ${T.hair}`, color: T.ink2, cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
            <Icon name="search" size={13}/>
          </button>
          <button onClick={() => window.openModal('release')} style={{
            width: 30, height: 30, borderRadius: 6, background: T.accent, color: T.surface,
            border: 'none', cursor: 'pointer', display: 'grid', placeItems: 'center',
          }}><Icon name="plus" size={13} stroke={2.6}/></button>
        </>
      }/>
      <div style={{ display: 'flex', gap: 18, padding: '10px 16px', borderBottom: `1px solid ${T.hair}`, background: T.surface, overflowX: 'auto', flexShrink: 0 }}>
        {[
          { k: 'all', l: 'すべて' },
          { k: 'inprog', l: '進行中' },
          { k: 'over', l: '超過' },
          { k: 'warn', l: '今週' },
          { k: 'starred', l: 'スター' },
        ].map(f => (
          <button key={f.k} onClick={() => setFilter(f.k)} style={{
            padding: '4px 0', fontSize: 12.5, fontWeight: 500,
            color: filter === f.k ? T.ink : T.ink2, background: 'transparent', border: 'none',
            borderBottom: filter === f.k ? `2px solid ${T.accent}` : '2px solid transparent',
            whiteSpace: 'nowrap', fontFamily: T.font, cursor: 'pointer',
          }}>{f.l}</button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'auto', background: T.surface }}>
        {jobs.map(job => (
          <div key={job.no} onClick={() => onNav({ view: 'detail', job: job.no })} style={{
            padding: '14px 16px', borderBottom: `1px solid ${T.hair}`, cursor: 'pointer',
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
              {job.starred && <Icon name="star" size={10} color={T.accent}/>}
              <span style={{ fontFamily: T.mono, fontSize: 13, fontWeight: 600 }}>{job.no}</span>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{job.customer}</span>
              <div style={{ flex: 1 }}/>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: dueColorOf(job.dueStatus), fontFamily: T.mono }}>{job.due}</span>
            </div>
            <div style={{ fontSize: 12, color: T.ink3, marginBottom: 10 }}>
              {job.product} · {job.axes.length}軸
            </div>
            <div style={{ position: 'relative', height: 3, background: T.hair, borderRadius: 2 }}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${job.pct}%`, background: T.accent, borderRadius: 2 }}/>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11.5 }}>
              <span style={{ color: T.ink2 }}><span style={{ fontFamily: T.mono, color: T.ink3 }}>{String(job.nowPhase).padStart(2, '0')}</span> {job.nowLabel}</span>
              <span style={{ color: T.ink, fontWeight: 600, fontFamily: T.mono }}>{job.pct}%</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function MobileDetail({ jobNo, onNav }) {
  const job = AppData.JOBS.find(j => j.no === jobNo) || AppData.JOBS[0];
  const [axisIdx, setAxisIdx] = useStateMo(0);
  const [tab, setTab] = useStateMo('progress'); // progress | files | activity
  const ax = job.axes[axisIdx];
  return (
    <>
      <MobileTopbar
        title={job.no}
        onBack={() => onNav({ view: 'index' })}
        right={
          <>
            <button onClick={() => window.openModal('mail')} style={{ width: 30, height: 30, borderRadius: 6, background: 'transparent', border: `1px solid ${T.hair}`, color: T.ink2, cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
              <Icon name="mail" size={13}/>
            </button>
            <button onClick={() => window.openModal('release')} style={{
              width: 30, height: 30, borderRadius: 6, background: T.accent, color: T.surface,
              border: 'none', cursor: 'pointer', display: 'grid', placeItems: 'center',
            }}><Icon name="plus" size={13} stroke={2.6}/></button>
          </>
        }
      />
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${T.hair}`, background: T.surface, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{job.customer}</div>
          <div style={{ fontSize: 12, color: T.ink3 }}>{job.product}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 12.5, marginTop: 6 }}>
          <span style={{ color: T.ink3 }}>納期</span>
          <span style={{ color: dueColorOf(job.dueStatus), fontWeight: 600, fontFamily: T.mono }}>{job.due}</span>
          {job.daysLeft !== null && (
            <span style={{ color: T.ink3, fontSize: 11.5 }}>
              · {job.daysLeft < 0 ? `${Math.abs(job.daysLeft)}日超過` : `あと${job.daysLeft}日`}
            </span>
          )}
        </div>
      </div>

      {/* Axis tabs (mobile, horizontal scroll) */}
      <div style={{ display: 'flex', gap: 14, padding: '0 16px', borderBottom: `1px solid ${T.hair}`, background: T.surface, overflowX: 'auto', flexShrink: 0 }}>
        {job.axes.map((a, i) => (
          <button key={i} onClick={() => setAxisIdx(i)} style={{
            padding: '10px 0', fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap',
            color: axisIdx === i ? T.ink : T.ink2, background: 'transparent', border: 'none',
            borderBottom: axisIdx === i ? `2px solid ${T.accent}` : '2px solid transparent',
            marginBottom: -1, cursor: 'pointer', fontFamily: T.font,
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: a.status === 'done' ? T.ink2 : a.status === 'inprog' ? T.accent : T.ink4 }}/>
            {a.name}
          </button>
        ))}
      </div>

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 0, background: T.surface, borderBottom: `1px solid ${T.hair}`, flexShrink: 0 }}>
        {[
          { k: 'progress', l: '進捗' },
          { k: 'files',    l: '図面', n: job.files.length },
          { k: 'activity', l: '履歴', n: job.activity.length },
        ].map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} style={{
            flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 600,
            color: tab === t.k ? T.ink : T.ink2, background: 'transparent', border: 'none',
            borderBottom: tab === t.k ? `2px solid ${T.accent}` : '2px solid transparent',
            cursor: 'pointer', fontFamily: T.font, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
          }}>
            {t.l}
            {t.n !== undefined && <span style={{ fontSize: 10, color: T.ink3, fontFamily: T.mono }}>{t.n}</span>}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto', background: T.surface }}>
        {tab === 'progress' && (
          <div style={{ padding: '18px 16px' }}>
            <AxisProgress ax={ax}/>
            <button onClick={() => window.openModal('release')} style={{
              marginTop: 18, width: '100%', padding: '10px 12px', fontSize: 13, fontWeight: 600,
              color: T.surface, background: T.accent, border: 'none', borderRadius: 6, cursor: 'pointer',
              fontFamily: T.font,
            }}>{ax.name} を出図</button>

            <div style={{ marginTop: 24, padding: '14px 16px', background: T.surfaceAlt, border: `1px solid ${T.hair}`, borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: T.ink3, letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 8 }}>全体進捗</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                <div style={{ fontFamily: T.mono, fontSize: 24, fontWeight: 600, color: T.ink, letterSpacing: '-0.02em' }}>{job.pct}<span style={{ fontSize: 13, color: T.ink3 }}>%</span></div>
                <div style={{ fontSize: 12, color: T.ink2 }}>{job.nowLabel} 進行中</div>
              </div>
              <div style={{ marginTop: 10, position: 'relative', height: 3, background: T.hair, borderRadius: 2 }}>
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${job.pct}%`, background: T.accent, borderRadius: 2 }}/>
              </div>
            </div>
          </div>
        )}
        {tab === 'files' && (
          <div>
            {job.files.length === 0 && <div style={{ padding: 32, textAlign: 'center', color: T.ink3, fontSize: 12.5 }}>図面はありません</div>}
            {job.files.map((f, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: `1px solid ${T.hair}` }}>
                <FileIcon type={f.type}/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: T.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                  <div style={{ fontSize: 11, color: T.ink3, marginTop: 1 }}>{f.axis} · <span style={{ fontFamily: T.mono }}>{f.date}</span></div>
                </div>
              </div>
            ))}
          </div>
        )}
        {tab === 'activity' && (
          <div style={{ padding: '4px 16px' }}>
            {job.activity.length === 0 && <div style={{ padding: 28, textAlign: 'center', color: T.ink3, fontSize: 12.5 }}>履歴はありません</div>}
            {job.activity.map((e, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, padding: '12px 0', borderBottom: i < job.activity.length - 1 ? `1px solid ${T.hair}` : 'none' }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: i === 0 ? T.accent : T.ink4, marginTop: 7, flexShrink: 0 }}/>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12.5, color: T.ink }}>{e.what}</div>
                  <div style={{ fontSize: 11, color: T.ink3, marginTop: 2, fontFamily: T.mono }}>{e.t} · {e.who}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function MobileAdmin({ onNav }) {
  const [tab, setTab] = useStateMo('contacts');
  return (
    <>
      <MobileTopbar title="管理"/>
      <div style={{ display: 'flex', gap: 18, padding: '10px 16px', borderBottom: `1px solid ${T.hair}`, background: T.surface, flexShrink: 0 }}>
        {[
          { k: 'contacts', l: '連絡先' },
          { k: 'templates', l: 'テンプレート' },
          { k: 'phases', l: '工程' },
        ].map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} style={{
            padding: '4px 0', fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap',
            color: tab === t.k ? T.ink : T.ink2, background: 'transparent', border: 'none',
            borderBottom: tab === t.k ? `2px solid ${T.accent}` : '2px solid transparent',
            cursor: 'pointer', fontFamily: T.font,
          }}>{t.l}</button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'auto', background: T.surface }}>
        {tab === 'contacts' && AppData.CONTACTS.map((c, i) => (
          <div key={i} style={{ padding: '12px 16px', borderBottom: `1px solid ${T.hair}` }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{c.name}</div>
            <div style={{ fontFamily: T.mono, fontSize: 11, color: T.ink2, marginTop: 2 }}>{c.email}</div>
            <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 3 }}>{c.company} · {c.note}</div>
          </div>
        ))}
        {tab === 'templates' && AppData.TEMPLATES.map((t, i) => (
          <div key={i} style={{ padding: '12px 16px', borderBottom: `1px solid ${T.hair}` }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.ink, display: 'flex', alignItems: 'center', gap: 6 }}>
              {t.name}
              {t.default && <span style={{ fontSize: 9.5, padding: '1px 6px', background: T.accentSoft, color: T.accent2, borderRadius: 3, fontWeight: 600 }}>デフォルト</span>}
            </div>
            <div style={{ fontFamily: T.mono, fontSize: 10.5, color: T.ink3, marginTop: 3 }}>{t.subject}</div>
          </div>
        ))}
        {tab === 'phases' && AppData.PHASES.map((p, i) => (
          <div key={p.i} style={{ padding: '12px 16px', borderBottom: `1px solid ${T.hair}`, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontFamily: T.mono, fontSize: 11.5, color: T.ink3, fontWeight: 600, width: 22 }}>{String(p.i).padStart(2, '0')}</span>
            <div style={{ fontSize: 13, fontWeight: 500, color: T.ink, flex: 1 }}>{p.ja}</div>
          </div>
        ))}
      </div>
    </>
  );
}

Object.assign(window, { MobileIndex, MobileDetail, MobileAdmin, MobileBottomNav, MobileStatusBar });
