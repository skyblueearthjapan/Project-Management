// Index view — job list, desktop
const { useState: useStateI, useMemo: useMemoI } = React;

function IndexView({ onNav }) {
  const [filter, setFilter] = useStateI('inprog');
  const [query, setQuery] = useStateI('');
  const [sort, setSort] = useStateI('due');

  const jobs = useMemoI(() => {
    let list = AppData.JOBS;
    if (filter === 'over')    list = list.filter(j => j.dueStatus === 'over');
    if (filter === 'warn')    list = list.filter(j => j.dueStatus === 'warn');
    if (filter === 'starred') list = list.filter(j => j.starred);
    if (query) list = list.filter(j =>
      j.no.toLowerCase().includes(query.toLowerCase()) ||
      j.customer.toLowerCase().includes(query.toLowerCase()) ||
      j.product.toLowerCase().includes(query.toLowerCase()));
    return list;
  }, [filter, query]);

  const filters = [
    { k: 'all',     l: 'すべて',   n: AppData.JOBS.length },
    { k: 'inprog',  l: '進行中',   n: AppData.JOBS.length },
    { k: 'over',    l: '期限超過', n: AppData.JOBS.filter(j => j.dueStatus === 'over').length },
    { k: 'warn',    l: '今週',     n: AppData.JOBS.filter(j => j.dueStatus === 'warn').length },
    { k: 'starred', l: 'スター',   n: AppData.JOBS.filter(j => j.starred).length },
  ];

  return (
    <>
      {/* Page head */}
      <div style={{ padding: '24px 28px 0', background: T.surface }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.015em', color: T.ink }}>工番</h1>
          <div style={{ fontSize: 12, color: T.ink3 }}>{jobs.length}件 · 進行中</div>
        </div>
        <div style={{ display: 'flex', gap: 20, marginTop: 14, alignItems: 'center', borderBottom: `1px solid ${T.hair}` }}>
          {filters.map(f => (
            <button key={f.k} onClick={() => setFilter(f.k)} style={{
              padding: '6px 0', fontSize: 13, fontWeight: 500,
              color: filter === f.k ? T.ink : T.ink2, background: 'transparent', border: 'none',
              borderBottom: filter === f.k ? `2px solid ${T.accent}` : '2px solid transparent',
              marginBottom: -1, cursor: 'pointer', fontFamily: T.font,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              {f.l}
              <span style={{
                fontSize: 11, color: filter === f.k ? T.ink2 : T.ink3,
                background: T.surfaceAlt, padding: '0 5px', borderRadius: 3,
                fontFamily: T.mono, fontVariantNumeric: 'tabular-nums',
              }}>{f.n}</span>
            </button>
          ))}
          <div style={{ flex: 1 }}/>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: T.ink3, paddingBottom: 8 }}>
            <span>並び順</span>
            <select value={sort} onChange={e => setSort(e.target.value)} style={{
              background: 'transparent', border: 'none', color: T.ink, fontSize: 12,
              fontFamily: 'inherit', cursor: 'pointer', outline: 'none',
            }}>
              <option value="due">納期</option>
              <option value="pct">進捗</option>
              <option value="no">工番</option>
            </select>
          </div>
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflow: 'auto', background: T.surface }}>
        {jobs.length === 0 && (
          <div style={{ padding: 60, textAlign: 'center', color: T.ink3, fontSize: 13 }}>
            条件に合う工番がありません
          </div>
        )}
        {jobs.map(job => (
          <div key={job.no} onClick={() => onNav({ view: 'detail', job: job.no })} style={{
            padding: '18px 28px', borderBottom: `1px solid ${T.hair}`, cursor: 'pointer',
            transition: 'background 0.12s',
          }}
            onMouseEnter={e => e.currentTarget.style.background = T.surfaceAlt}
            onMouseLeave={e => e.currentTarget.style.background = T.surface}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
              <span style={{ width: 12 }}>
                {job.starred && <Icon name="star" size={12} color={T.accent}/>}
              </span>
              <div style={{
                fontFamily: T.mono, fontSize: 13.5, fontWeight: 600, color: T.ink,
                fontVariantNumeric: 'tabular-nums', width: 64,
              }}>{job.no}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.ink, letterSpacing: '-0.005em' }}>{job.customer}</div>
              <div style={{ fontSize: 13, color: T.ink3 }}>{job.product}</div>
              <div style={{ fontSize: 12, color: T.ink3 }}>· {job.axes.length}軸</div>

              <div style={{ flex: 1 }}/>

              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 13 }}>
                <span style={{ color: T.ink3, fontSize: 12 }}>納期</span>
                <span style={{ color: dueColorOf(job.dueStatus), fontWeight: 600, fontFamily: T.mono }}>{job.due}</span>
                {job.dueStatus === 'over' && (
                  <span style={{ fontSize: 11, color: T.danger, marginLeft: 2 }}>· {Math.abs(job.daysLeft)}日超過</span>
                )}
                {job.dueStatus === 'warn' && (
                  <span style={{ fontSize: 11, color: T.warn, marginLeft: 2 }}>· あと{job.daysLeft}日</span>
                )}
              </div>

              <div style={{ width: 60, textAlign: 'right' }}>
                <span style={{
                  fontFamily: T.mono, fontSize: 14, fontWeight: 600, color: T.ink,
                  fontVariantNumeric: 'tabular-nums',
                }}>{job.pct}<span style={{ color: T.ink3, fontWeight: 500 }}>%</span></span>
              </div>
            </div>

            <div style={{ paddingLeft: 24 }}>
              <ProgressBar job={job}/>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

window.IndexView = IndexView;
