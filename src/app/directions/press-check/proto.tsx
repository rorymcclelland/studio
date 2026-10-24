"use client";

import "@fontsource-variable/fraunces/full.css";
import "@fontsource-variable/instrument-sans";
import { AdArt } from "../_shared/ad-art";
import { activity, approvals, brand, campaign, overall, squads, type CheckStatus } from "../_shared/sample";
import { CHECK_LABEL, FILTER_LABEL, useProto, type Filter } from "../_shared/use-proto";
import s from "./press.module.css";

const STAMP: Record<CheckStatus, string> = { pass: "OK", review: "Query", fail: "Stop" };

export function PressCheck() {
  const p = useProto();
  return (
    <div className={s.table} data-theme={p.theme}>
      <header className={s.bar}>
        <span className={s.mark} aria-hidden />
        <span className={s.wordmark}>Studio</span>
        <nav className={s.tabs} aria-label="Screens">
          <button aria-current={p.screen === "campaign" ? "page" : undefined} onClick={() => p.setScreen("campaign")}>
            Campaign
          </button>
          <button aria-current={p.screen === "review" ? "page" : undefined} onClick={() => p.setScreen("review")}>
            Creative review
          </button>
        </nav>
        <span className={s.sample}>Sample data</span>
        <button className={s.themeBtn} onClick={p.toggleTheme}>{p.theme === "light" ? "Dark" : "Light"} theme</button>
      </header>

      <div className={s.layout}>
        <aside className={s.ticket} aria-label="Job ticket">
          <p className={s.ticketBrand}>{brand.name}</p>
          <h1 className={s.ticketTitle}>{campaign.name}</h1>
          <dl className={s.ticketFacts}>
            <div><dt>Live since</dt><dd>{campaign.launched}</dd></div>
            <div><dt>Day</dt><dd>{campaign.day} of {campaign.days}</dd></div>
            <div><dt>Spend</dt><dd>£{campaign.spend.toLocaleString("en-GB")} of £{campaign.budget.toLocaleString("en-GB")}</dd></div>
            <div><dt>Live variants</dt><dd>{campaign.liveVariants}</dd></div>
          </dl>
          <div className={s.bars} aria-hidden>
            <span /><span /><span /><span /><span /><span />
          </div>
          <p className={s.objective}>{campaign.objective}</p>
        </aside>

        <main className={s.sheet}>
          <span className={`${s.crop} ${s.tl}`} aria-hidden />
          <span className={`${s.crop} ${s.tr}`} aria-hidden />
          <span className={`${s.crop} ${s.bl}`} aria-hidden />
          <span className={`${s.crop} ${s.br}`} aria-hidden />
          {p.screen === "campaign" ? <Campaign p={p} /> : <Review p={p} />}
        </main>
      </div>
    </div>
  );
}

type P = ReturnType<typeof useProto>;

function Campaign({ p }: { p: P }) {
  return (
    <>
      <h2 className={s.lede}>
        Ten days in, {campaign.healthyShare}% of the spend is on creative that&apos;s working. Two changes are waiting
        for your sign-off.
      </h2>

      <section aria-labelledby="pc-stages" className={s.section}>
        <h3 id="pc-stages" className={s.h3}>Where each squad has got to</h3>
        <ol className={s.stages}>
          {squads.map((q) => (
            <li key={q.key} className={s.stage}>
              <span className={s.stageName}>{q.name}</span>
              <span className={s.stageState}>{q.state}</span>
              <span className={s.stageDetail}>{q.detail}</span>
              <span className={s.stageRule} style={{ ["--p" as string]: q.progress }} aria-hidden />
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="pc-sign" className={s.section}>
        <h3 id="pc-sign" className={s.h3}>For your sign-off</h3>
        <ul className={s.slips}>
          {approvals.map((a) => {
            const d = p.decisions[a.id];
            return (
              <li key={a.id} className={s.slip} data-state={d ?? "open"}>
                <p className={s.slipTitle}>{a.title}</p>
                <p className={s.slipWhy}>{a.why}</p>
                <p className={s.slipAgent}>Proposed by the {a.agent.toLowerCase()}</p>
                {d ? (
                  <p className={s.slipDone} role="status">
                    {d === "approved" ? "Signed off" : "Sent back"}{" "}
                    <button className={s.linkBtn} onClick={() => p.undo(a.id)}>Undo</button>
                  </p>
                ) : (
                  <div className={s.slipActions}>
                    <button className={s.primary} onClick={() => p.decide(a.id, "approved")}>Sign off</button>
                    <button className={s.secondary} onClick={() => p.decide(a.id, "declined")}>Send back</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="pc-notes" className={s.section}>
        <h3 id="pc-notes" className={s.h3}>Press notes</h3>
        <ul className={s.notes}>
          {activity.map((n, i) => (
            <li key={i}>
              <time>{n.time}</time>
              <span><strong>{n.agent}.</strong> {n.text}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function Review({ p }: { p: P }) {
  const v = p.selected;
  return (
    <div className={s.review}>
      <div>
        <h2 className={s.reviewTitle}>Proofs for the winter range</h2>
        <div className={s.filters} role="group" aria-label="Show">
          {(["all", "pass", "review", "fail"] as Filter[]).map((f) => (
            <button key={f} aria-pressed={p.filter === f} onClick={() => p.setFilter(f)}>
              {FILTER_LABEL[f]} <span>{p.counts[f]}</span>
            </button>
          ))}
        </div>
        <ul className={s.imposition}>
          {p.visible.map((x) => (
            <li key={x.id}>
              <button
                className={s.proof}
                aria-pressed={x.id === v.id}
                onClick={() => p.select(x.id)}
                data-ratio={x.aspect}
              >
                <AdArt v={x} className={s.art} />
                <span className={s.stamp} data-status={overall(x)}>{STAMP[overall(x)]}</span>
                <span className={s.proofLabel}>{x.name} · {x.aspect} · {x.language}</span>
              </button>
            </li>
          ))}
        </ul>
        {p.visible.length === 0 && <p className={s.empty}>No proofs with this status.</p>}
      </div>

      <aside className={s.detail} aria-label="Proof notes">
        <AdArt v={v} className={s.detailArt} />
        <h3 className={s.detailName}>{v.name}</h3>
        <p className={s.detailMeta}>{v.aspect} · {v.language} · pre-test {v.pretest.toFixed(1)} out of 10</p>
        <ul className={s.checks}>
          {(["brand", "legal", "accessibility"] as const).map((k) => (
            <li key={k} data-status={v.checks[k]}>
              <span className={s.checkName}>{k === "brand" ? "Brand" : k === "legal" ? "Legal" : "Accessibility"}</span>
              <span>{CHECK_LABEL[v.checks[k]]}</span>
            </li>
          ))}
        </ul>
        {v.note && <p className={s.query}>{v.note}</p>}
        <div className={s.slipActions}>
          {p.decisions[v.id] ? (
            <p className={s.slipDone} role="status">
              {p.decisions[v.id] === "approved" ? "Signed off for print" : "Sent back to the Creative squad"}{" "}
              <button className={s.linkBtn} onClick={() => p.undo(v.id)}>Undo</button>
            </p>
          ) : (
            <>
              <button className={s.primary} disabled={overall(v) === "fail"} onClick={() => p.decide(v.id, "approved")}>
                Sign off
              </button>
              <button className={s.secondary} onClick={() => p.decide(v.id, "declined")}>Send back</button>
            </>
          )}
        </div>
        {overall(v) === "fail" && <p className={s.hint}>Fix the failed check before signing off.</p>}
      </aside>
    </div>
  );
}
