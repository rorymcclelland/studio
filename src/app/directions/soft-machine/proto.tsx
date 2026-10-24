"use client";

import "@fontsource-variable/figtree";
import { AdArt } from "../_shared/ad-art";
import { activity, approvals, brand, campaign, overall, squads, type CheckStatus } from "../_shared/sample";
import { CHECK_LABEL, FILTER_LABEL, useProto, type Filter } from "../_shared/use-proto";
import s from "./soft.module.css";

type P = ReturnType<typeof useProto>;

const TONE: Record<CheckStatus, string> = { pass: "good", review: "review", fail: "attention" };

/** One ring segment per live variant (sample): healthy, slipping, or below threshold. */
const ring = Array.from({ length: campaign.liveVariants }, (_, i) => (i < 19 ? 2 : i < 22 ? 1 : 0));

export function SoftMachine() {
  const p = useProto();
  return (
    <div className={s.page} data-theme={p.theme}>
      <header className={s.top}>
        <span className={s.logo} aria-hidden />
        <span className={s.wordmark}>Studio</span>
        <nav className={s.tabs} aria-label="Screens">
          <button aria-current={p.screen === "campaign" ? "page" : undefined} onClick={() => p.setScreen("campaign")}>Campaign</button>
          <button aria-current={p.screen === "review" ? "page" : undefined} onClick={() => p.setScreen("review")}>Creative review</button>
        </nav>
        <span className={s.sample}>Sample data</span>
        <button className={s.themeBtn} onClick={p.toggleTheme}>{p.theme === "light" ? "Dark" : "Light"} theme</button>
      </header>
      <main className={s.main}>{p.screen === "campaign" ? <Campaign p={p} /> : <Review p={p} />}</main>
    </div>
  );
}

function Ring() {
  const r = 92;
  const c = 2 * Math.PI * r;
  const seg = c / ring.length;
  return (
    <svg viewBox="0 0 220 220" className={s.ring} role="img" aria-label={`${campaign.liveVariants} live variants: 19 healthy, 3 slipping, 2 below threshold`}>
      {ring.map((h, i) => (
        <circle
          key={i}
          cx="110"
          cy="110"
          r={r}
          fill="none"
          strokeWidth="18"
          strokeLinecap="butt"
          className={h === 2 ? s.segGood : h === 1 ? s.segReview : s.segAttention}
          strokeDasharray={`${seg - 4} ${c - seg + 4}`}
          strokeDashoffset={-i * seg}
          transform="rotate(-90 110 110)"
        />
      ))}
      <text x="110" y="104" textAnchor="middle" className={s.ringNum}>{campaign.healthyShare}%</text>
      <text x="110" y="130" textAnchor="middle" className={s.ringLabel}>of spend is healthy</text>
    </svg>
  );
}

function Campaign({ p }: { p: P }) {
  const open = approvals.filter((a) => !p.decisions[a.id]).length;
  return (
    <>
      <section className={s.hero} aria-labelledby="sm-summary">
        <div>
          <p className={s.brand}>{brand.name} · day {campaign.day} of {campaign.days}</p>
          <h1 id="sm-summary" className={s.summary}>
            Your winter campaign is mostly healthy.{" "}
            {open === 0 ? "Nothing is waiting for you." : open === 1 ? "One change needs your OK." : "Two changes need your OK."}
          </h1>
          <p className={s.sub}>
            {campaign.name}. £{campaign.spend.toLocaleString("en-GB")} of £{campaign.budget.toLocaleString("en-GB")} spent so far.
          </p>
        </div>
        <Ring />
      </section>

      <section aria-labelledby="sm-ok" className={s.section}>
        <h2 id="sm-ok" className={s.h2}>Waiting for your OK</h2>
        <ul className={s.asks}>
          {approvals.map((a) => {
            const d = p.decisions[a.id];
            return (
              <li key={a.id} className={s.ask} data-state={d ?? "open"}>
                <div>
                  <p className={s.askTitle}>{a.title}</p>
                  <p className={s.askWhy}>{a.why}</p>
                  <p className={s.askAgent}>From the {a.agent.toLowerCase()}</p>
                </div>
                {d ? (
                  <p className={s.done} role="status">
                    {d === "approved" ? "Done. The agent is on it." : "Declined. Nothing will change."}
                    <button onClick={() => p.undo(a.id)}>Undo</button>
                  </p>
                ) : (
                  <div className={s.askActions}>
                    <button className={s.yes} onClick={() => p.decide(a.id, "approved")}>Approve</button>
                    <button className={s.no} onClick={() => p.decide(a.id, "declined")}>Not now</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="sm-squads" className={s.section}>
        <h2 id="sm-squads" className={s.h2}>Your three squads</h2>
        <ul className={s.squads}>
          {squads.map((q) => (
            <li key={q.key} className={s.squad} data-squad={q.key}>
              <span className={s.pebble} aria-hidden />
              <p className={s.squadName}>{q.name}</p>
              <p className={s.squadState}>{q.state}</p>
              <p className={s.squadDetail}>{q.detail}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="sm-today" className={s.section}>
        <h2 id="sm-today" className={s.h2}>What the agents did today</h2>
        <ol className={s.today}>
          {activity.map((n, i) => (
            <li key={i}>
              <time>{n.time}</time>
              <p><strong>{n.agent}.</strong> {n.text}</p>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

function Review({ p }: { p: P }) {
  const v = p.selected;
  return (
    <>
      <div className={s.reviewHead}>
        <h1 className={s.reviewTitle}>Creative for the winter campaign</h1>
        <div className={s.filters} role="group" aria-label="Show">
          {(["all", "pass", "review", "fail"] as Filter[]).map((f) => (
            <button key={f} aria-pressed={p.filter === f} onClick={() => p.setFilter(f)}>
              {FILTER_LABEL[f]} <span>{p.counts[f]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className={s.reviewGrid}>
        <ul className={s.gallery}>
          {p.visible.map((x) => (
            <li key={x.id}>
              <button className={s.tile} aria-pressed={x.id === v.id} onClick={() => p.select(x.id)}>
                <span className={s.tileArt}><AdArt v={x} /></span>
                <span className={s.tileName}>{x.name}</span>
                <span className={s.tileMeta}>
                  <span className={s.chip} data-tone={TONE[overall(x)]}>{CHECK_LABEL[overall(x)]}</span>
                  {x.aspect} · {x.language}
                </span>
              </button>
            </li>
          ))}
          {p.visible.length === 0 && <li className={s.empty}>Nothing here right now.</li>}
        </ul>
        <aside className={s.focus} aria-label="Selected creative">
          <div className={s.focusArt}><AdArt v={v} /></div>
          <h2 className={s.focusName}>{v.name}</h2>
          <p className={s.focusMeta}>
            {v.aspect} · {v.language} · the test audience scored it {v.pretest.toFixed(1)} out of 10
          </p>
          <ul className={s.checks}>
            {(["brand", "legal", "accessibility"] as const).map((k) => (
              <li key={k} data-tone={TONE[v.checks[k]]}>
                <span>{k === "brand" ? "On brand" : k === "legal" ? "Legal" : "Accessible"}</span>
                <span>{CHECK_LABEL[v.checks[k]]}</span>
              </li>
            ))}
          </ul>
          {v.note && <p className={s.note}>{v.note}</p>}
          {p.decisions[v.id] ? (
            <p className={s.done} role="status">
              {p.decisions[v.id] === "approved" ? "Approved for launch." : "Sent back for another go."}
              <button onClick={() => p.undo(v.id)}>Undo</button>
            </p>
          ) : (
            <div className={s.askActions}>
              <button className={s.yes} disabled={overall(v) === "fail"} onClick={() => p.decide(v.id, "approved")}>Approve</button>
              <button className={s.no} onClick={() => p.decide(v.id, "declined")}>Send back</button>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

