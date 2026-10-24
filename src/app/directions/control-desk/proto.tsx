"use client";

import "@fontsource/ibm-plex-sans-condensed/400.css";
import "@fontsource/ibm-plex-sans-condensed/500.css";
import "@fontsource/ibm-plex-sans-condensed/600.css";
import { AdArt } from "../_shared/ad-art";
import { activity, approvals, brand, campaign, healthTrend, overall, squads, variants, type CheckStatus, type Variant } from "../_shared/sample";
import { CHECK_LABEL, FILTER_LABEL, useProto, type Filter } from "../_shared/use-proto";
import s from "./desk.module.css";

type P = ReturnType<typeof useProto>;

/** Sample daily health per live variant: 2 healthy, 1 slipping, 0 below threshold. */
function lane(v: Variant): number[] {
  const seed = v.id.charCodeAt(1);
  return Array.from({ length: campaign.day }, (_, d) => {
    if (v.id === "v1") return d < 5 ? 2 : d < 8 ? 1 : 0;
    if (v.id === "v3") return d % 7 === 5 || d % 7 === 6 ? 1 : 2;
    if (v.id === "v2") return d < 8 ? -1 : 2; // replacement, not live until approved
    return (seed + d) % 9 === 0 ? 1 : 2;
  });
}

const DOT: Record<CheckStatus, string> = { pass: s.good, review: s.warn, fail: s.bad };

export function ControlDesk() {
  const p = useProto("dark");
  return (
    <div className={s.room} data-theme={p.theme}>
      <header className={s.top}>
        <span className={s.wordmark}>Studio</span>
        <span className={s.sep} aria-hidden />
        <span className={s.campaign}>
          {brand.short} <span className={s.dim}>/</span> {campaign.name}
        </span>
        <nav className={s.tabs} aria-label="Screens">
          <button aria-current={p.screen === "campaign" ? "page" : undefined} onClick={() => p.setScreen("campaign")}>Campaign</button>
          <button aria-current={p.screen === "review" ? "page" : undefined} onClick={() => p.setScreen("review")}>Creative review</button>
        </nav>
        <span className={s.sample}>Sample data</span>
        <button className={s.themeBtn} onClick={p.toggleTheme}>{p.theme === "light" ? "Dark" : "Light"} theme</button>
      </header>
      {p.screen === "campaign" ? <Campaign p={p} /> : <Review p={p} />}
    </div>
  );
}

function Campaign({ p }: { p: P }) {
  const live = variants.filter((v) => v.id !== "v2").slice(0, 7).concat(variants[1]);
  const lo = 60, hi = 90;
  const pts = healthTrend.map((h, i) => `${(i / (healthTrend.length - 1)) * 200},${48 - ((h - lo) / (hi - lo)) * 48}`).join(" ");
  return (
    <div className={s.grid}>
      <section className={`${s.panel} ${s.readout}`} aria-labelledby="cd-health">
        <h2 id="cd-health" className={s.label}>Healthy spend share</h2>
        <p className={s.big}>{campaign.healthyShare}<span>%</span></p>
        <svg viewBox="0 0 200 48" className={s.spark} role="img" aria-label="Healthy spend share by day: rose from 64% to 84% by day 6, now 78%">
          <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
        <dl className={s.facts}>
          <div><dt>Day</dt><dd>{campaign.day}/{campaign.days}</dd></div>
          <div><dt>Spend</dt><dd>£{campaign.spend.toLocaleString("en-GB")}</dd></div>
          <div><dt>Budget</dt><dd>£{campaign.budget.toLocaleString("en-GB")}</dd></div>
          <div><dt>Live</dt><dd>{campaign.liveVariants}</dd></div>
        </dl>
      </section>

      <section className={`${s.panel} ${s.channels}`} aria-labelledby="cd-squads">
        <h2 id="cd-squads" className={s.label}>Squads</h2>
        <ul>
          {squads.map((q) => (
            <li key={q.key} data-squad={q.key}>
              <span className={s.light} data-on={q.key === "creative" ? "warn" : "good"} aria-hidden />
              <span className={s.chName}>{q.name}</span>
              <span className={s.chState}>{q.state}</span>
              <span className={s.chDetail}>{q.detail}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={`${s.panel} ${s.queue}`} aria-labelledby="cd-queue">
        <h2 id="cd-queue" className={s.label}>
          Needs you <span className={s.count}>{approvals.filter((a) => !p.decisions[a.id]).length}</span>
        </h2>
        <ul>
          {approvals.map((a) => {
            const d = p.decisions[a.id];
            return (
              <li key={a.id} data-state={d ?? "open"}>
                <p className={s.qTitle}>{a.title}</p>
                <p className={s.qWhy}>{a.why}</p>
                <p className={s.qAgent}>{a.agent}</p>
                {d ? (
                  <p className={s.done} role="status">
                    {d === "approved" ? "Approved" : "Declined"}
                    <button onClick={() => p.undo(a.id)}>Undo</button>
                  </p>
                ) : (
                  <div className={s.actions}>
                    <button className={s.approve} onClick={() => p.decide(a.id, "approved")}>Approve</button>
                    <button className={s.decline} onClick={() => p.decide(a.id, "declined")}>Decline</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className={`${s.panel} ${s.rundown}`} aria-labelledby="cd-rundown">
        <div className={s.rundownHead}>
          <h2 id="cd-rundown" className={s.label}>Rundown: health of each variant by day</h2>
          <ul className={s.key} aria-label="Key">
            <li><span className={s.good} />Above threshold</li>
            <li><span className={s.warn} />Slipping</li>
            <li><span className={s.bad} />Below threshold</li>
            <li><span className={s.off} />Not live</li>
          </ul>
        </div>
        <div className={s.scroll}>
        <table className={s.lanes}>
          <thead>
            <tr>
              <th scope="col">Variant</th>
              {Array.from({ length: campaign.day }, (_, d) => (
                <th key={d} scope="col" className={s.dayCol}>{d + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {live.map((v) => (
              <tr key={v.id}>
                <th scope="row">
                  <span className={s.laneName}>{v.name}</span>
                  <span className={s.dim}>{v.aspect} · {v.language}</span>
                </th>
                {lane(v).map((h, d) => (
                  <td key={d}>
                    <span
                      className={h === 2 ? s.good : h === 1 ? s.warn : h === 0 ? s.bad : s.off}
                      title={`Day ${d + 1}: ${["below threshold", "slipping", "above threshold"][h] ?? "not live"}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>

      <section className={`${s.panel} ${s.log}`} aria-labelledby="cd-log">
        <h2 id="cd-log" className={s.label}>Agent log</h2>
        <ol>
          {activity.map((n, i) => (
            <li key={i}>
              <time>{n.time}</time>
              <span className={s.logAgent}>{n.agent}</span>
              <span>{n.text}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function Review({ p }: { p: P }) {
  const v = p.selected;
  return (
    <div className={s.reviewGrid}>
      <section className={s.panel} aria-labelledby="cd-variants">
        <div className={s.rundownHead}>
          <h2 id="cd-variants" className={s.label}>Variants</h2>
          <div className={s.filters} role="group" aria-label="Show">
            {(["all", "pass", "review", "fail"] as Filter[]).map((f) => (
              <button key={f} aria-pressed={p.filter === f} onClick={() => p.setFilter(f)}>
                {FILTER_LABEL[f]} <span>{p.counts[f]}</span>
              </button>
            ))}
          </div>
        </div>
        <div className={s.scroll}>
        <table className={s.vtable}>
          <thead>
            <tr>
              <th scope="col">Variant</th>
              <th scope="col">Size</th>
              <th scope="col">Lang</th>
              <th scope="col">Brand</th>
              <th scope="col">Legal</th>
              <th scope="col">Access.</th>
              <th scope="col" className={s.num}>Pre-test</th>
            </tr>
          </thead>
          <tbody>
            {p.visible.map((x) => (
              <tr key={x.id} aria-selected={x.id === v.id} onClick={() => p.select(x.id)}>
                <th scope="row">
                  <button className={s.rowBtn} onClick={() => p.select(x.id)}>
                    <AdArt v={x} className={s.thumb} />
                    {x.name}
                  </button>
                </th>
                <td>{x.aspect}</td>
                <td>{x.language}</td>
                {(["brand", "legal", "accessibility"] as const).map((k) => (
                  <td key={k}>
                    <span className={`${s.dot} ${DOT[x.checks[k]]}`} />
                    <span className={s.srOnly}>{CHECK_LABEL[x.checks[k]]}</span>
                  </td>
                ))}
                <td className={s.num}>{x.pretest.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {p.visible.length === 0 && <p className={s.dim}>No variants with this status.</p>}
      </section>

      <aside className={`${s.panel} ${s.inspector}`} aria-label="Selected variant">
        <AdArt v={v} className={s.inspectArt} />
        <h2 className={s.inspectName}>{v.name}</h2>
        <p className={s.dim}>{v.aspect} · {v.language} · pre-test {v.pretest.toFixed(1)}/10</p>
        <ul className={s.checks}>
          {(["brand", "legal", "accessibility"] as const).map((k) => (
            <li key={k}>
              <span className={`${s.dot} ${DOT[v.checks[k]]}`} aria-hidden />
              <span>{k === "brand" ? "Brand" : k === "legal" ? "Legal" : "Accessibility"}</span>
              <span className={s.checkVal} data-status={v.checks[k]}>{CHECK_LABEL[v.checks[k]]}</span>
            </li>
          ))}
        </ul>
        {v.note && <p className={s.note}>{v.note}</p>}
        {p.decisions[v.id] ? (
          <p className={s.done} role="status">
            {p.decisions[v.id] === "approved" ? "Approved for launch" : "Sent back to Creative"}
            <button onClick={() => p.undo(v.id)}>Undo</button>
          </p>
        ) : (
          <div className={s.actions}>
            <button className={s.approve} disabled={overall(v) === "fail"} onClick={() => p.decide(v.id, "approved")}>Approve</button>
            <button className={s.decline} onClick={() => p.decide(v.id, "declined")}>Send back</button>
          </div>
        )}
      </aside>
    </div>
  );
}
