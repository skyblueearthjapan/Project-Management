// Admin — contacts + email templates
const { useState: useStateA } = React;

function AdminView({ onNav, onToast }) {
  const [tab, setTab] = useStateA('contacts');
  const [query, setQuery] = useStateA('');

  const contacts = AppData.CONTACTS.filter(c =>
    !query || c.name.toLowerCase().includes(query.toLowerCase()) ||
    c.company.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <>
      <div style={{ padding: '24px 28px 0', background: T.surface }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.015em', color: T.ink }}>管理</h1>
        </div>
        <div style={{ display: 'flex', gap: 20, marginTop: 14, borderBottom: `1px solid ${T.hair}` }}>
          {[
            { k: 'contacts',  l: '連絡先',       n: AppData.CONTACTS.length },
            { k: 'templates', l: 'テンプレート', n: AppData.TEMPLATES.length },
            { k: 'phases',    l: '工程',         n: AppData.PHASES.length },
            { k: 'users',     l: 'ユーザー',     n: 4 },
          ].map(t => (
            <button key={t.k} onClick={() => setTab(t.k)} style={{
              padding: '6px 0', fontSize: 13, fontWeight: 500,
              color: tab === t.k ? T.ink : T.ink2, background: 'transparent', border: 'none',
              borderBottom: tab === t.k ? `2px solid ${T.accent}` : '2px solid transparent',
              marginBottom: -1, cursor: 'pointer', fontFamily: T.font,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              {t.l}
              <span style={{
                fontSize: 11, color: tab === t.k ? T.ink2 : T.ink3,
                background: T.surfaceAlt, padding: '0 5px', borderRadius: 3,
                fontFamily: T.mono, fontVariantNumeric: 'tabular-nums',
              }}>{t.n}</span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', background: T.surface }}>
        {tab === 'contacts' && (
          <div style={{ padding: '20px 28px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{ position: 'relative', width: 280 }}>
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="連絡先を検索…" style={{
                  width: '100%', height: 30, padding: '0 12px 0 32px',
                  background: T.surface, border: `1px solid ${T.hair2}`, borderRadius: 6,
                  fontSize: 12.5, color: T.ink, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
                }}/>
                <span style={{ position: 'absolute', left: 11, top: 9 }}><Icon name="search" size={12} stroke={2.2} color={T.ink3}/></span>
              </div>
              <div style={{ flex: 1 }}/>
              <button style={ghostBtn()}>CSV 出力</button>
              <button style={primaryBtn()} onClick={() => onToast('連絡先を追加しました')}>
                <Icon name="plus" size={12} stroke={2.6}/> 追加
              </button>
            </div>

            <div style={{ border: `1px solid ${T.hair}`, borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: T.surfaceAlt, borderBottom: `1px solid ${T.hair}` }}>
                    {['表示名', 'メール', '会社', 'メモ', ''].map((h, i) => (
                      <th key={i} style={{
                        padding: '10px 14px', textAlign: 'left', fontSize: 11,
                        fontWeight: 600, color: T.ink3, letterSpacing: '0.04em', textTransform: 'uppercase',
                        width: i === 4 ? 80 : undefined,
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((c, i) => (
                    <tr key={i} style={{ borderBottom: i < contacts.length - 1 ? `1px solid ${T.hair}` : 'none' }}>
                      <td style={{ padding: '12px 14px', fontWeight: 600, color: T.ink }}>{c.name}</td>
                      <td style={{ padding: '12px 14px', fontFamily: T.mono, fontSize: 11.5, color: T.ink2 }}>{c.email}</td>
                      <td style={{ padding: '12px 14px', color: T.ink2 }}>{c.company}</td>
                      <td style={{ padding: '12px 14px', color: T.ink3, fontSize: 12 }}>{c.note}</td>
                      <td style={{ padding: '12px 14px' }}>
                        <button style={{ ...ghostBtn(), padding: '4px 9px', fontSize: 11.5 }}>編集</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'templates' && (
          <div style={{ padding: '20px 28px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{ fontSize: 12.5, color: T.ink3 }}>メールテンプレート — {AppData.TEMPLATES.length}件</div>
              <div style={{ flex: 1 }}/>
              <button style={primaryBtn()} onClick={() => onToast('新規テンプレートを作成しました')}>
                <Icon name="plus" size={12} stroke={2.6}/> 新規
              </button>
            </div>

            <div style={{ border: `1px solid ${T.hair}`, borderRadius: 8, overflow: 'hidden' }}>
              {AppData.TEMPLATES.map((tpl, i) => (
                <div key={i} style={{
                  padding: '14px 18px', borderBottom: i < AppData.TEMPLATES.length - 1 ? `1px solid ${T.hair}` : 'none',
                  display: 'grid', gridTemplateColumns: '1fr auto', gap: 14, alignItems: 'center',
                }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ fontWeight: 600, color: T.ink, fontSize: 13.5 }}>{tpl.name}</div>
                      {tpl.default && (
                        <span style={{
                          fontSize: 10, padding: '1px 7px', background: T.accentSoft,
                          color: T.accent2, borderRadius: 3, fontWeight: 600,
                          letterSpacing: '0.04em',
                        }}>デフォルト</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11.5, color: T.ink3, marginTop: 3, fontFamily: T.mono }}>
                      件名: {tpl.subject}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button style={{ ...ghostBtn(), padding: '4px 9px', fontSize: 11.5 }}>編集</button>
                    <button style={{ ...ghostBtn(), padding: '4px 9px', fontSize: 11.5 }}>複製</button>
                    {!tpl.default && <button style={{ ...ghostBtn(), padding: '4px 9px', fontSize: 11.5, color: T.danger, borderColor: T.dangerSoft }}>削除</button>}
                  </div>
                </div>
              ))}
            </div>

            <div style={{
              marginTop: 20, padding: '12px 14px', background: T.accentSoft,
              border: `1px solid #cffafe`, borderRadius: 6, fontSize: 11.5, color: T.accent2,
              fontFamily: T.mono,
            }}>
              <strong style={{ letterSpacing: '0.04em', marginRight: 8 }}>VARIABLES</strong>
              {'{{job_no}} {{parent_job_no}} {{product_name}} {{customer_name}} {{due_date}} {{axis_name}} {{pdf_path}} {{releaser_name}} {{today}}'}
            </div>
          </div>
        )}

        {tab === 'phases' && (
          <div style={{ padding: '20px 28px' }}>
            <div style={{ fontSize: 12.5, color: T.ink3, marginBottom: 14 }}>工程定義 — 並び順を変更したり、名前を編集できます</div>
            <div style={{ border: `1px solid ${T.hair}`, borderRadius: 8, overflow: 'hidden' }}>
              {AppData.PHASES.map((p, i) => (
                <div key={p.i} style={{
                  padding: '12px 18px', borderBottom: i < AppData.PHASES.length - 1 ? `1px solid ${T.hair}` : 'none',
                  display: 'flex', alignItems: 'center', gap: 14,
                }}>
                  <span style={{ fontFamily: T.mono, fontSize: 12, color: T.ink3, fontWeight: 600, width: 24 }}>{String(p.i).padStart(2, '0')}</span>
                  <div style={{ flex: 1, fontSize: 13, fontWeight: 500, color: T.ink }}>{p.ja}</div>
                  <span style={{ fontSize: 11, color: T.ink3, fontFamily: T.mono }}>{p.short}</span>
                  <button style={{ ...ghostBtn(), padding: '4px 9px', fontSize: 11.5 }}>編集</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'users' && (
          <div style={{ padding: '20px 28px' }}>
            <div style={{ fontSize: 12.5, color: T.ink3, marginBottom: 14 }}>このシステムを使用するユーザー</div>
            <div style={{ border: `1px solid ${T.hair}`, borderRadius: 8, overflow: 'hidden' }}>
              {[
                { name: '山田 太郎', role: '設計', email: 'yamada@example.com' },
                { name: '田中 花子', role: '製造', email: 'tanaka@example.com' },
                { name: '佐藤 次郎', role: '購買', email: 'sato@example.com' },
                { name: '管理者',     role: '管理', email: 'admin@example.com' },
              ].map((u, i, arr) => (
                <div key={i} style={{
                  padding: '12px 18px', borderBottom: i < arr.length - 1 ? `1px solid ${T.hair}` : 'none',
                  display: 'flex', alignItems: 'center', gap: 14,
                }}>
                  <div style={{ width: 30, height: 30, borderRadius: '50%', background: T.surfaceAlt, border: `1px solid ${T.hair}`, display: 'grid', placeItems: 'center', fontSize: 12, color: T.ink2, fontWeight: 600 }}>{u.name[0]}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>{u.name}</div>
                    <div style={{ fontSize: 11, color: T.ink3, fontFamily: T.mono, marginTop: 1 }}>{u.email}</div>
                  </div>
                  <span style={{ fontSize: 11, color: T.ink2, padding: '2px 8px', background: T.surfaceAlt, border: `1px solid ${T.hair}`, borderRadius: 3 }}>{u.role}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

window.AdminView = AdminView;
