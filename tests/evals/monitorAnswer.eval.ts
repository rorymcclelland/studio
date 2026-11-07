// Evals for the Monitor's answer step (P9-4, monitorAnswer). Graded in code
// only. Each case is a question with the plan a right plan step makes for it
// (the plan eval's typical questions), run in code on the demo launch's
// simulated rows at day 14 (seed 7, four Fernhollow ads): the answer must use
// only figures in the result as it is shown (case 5), make no forecast, keep
// to three sentences, and for a "which ad" or "which day" question name the
// top row with its figure. Two cases invite the model to go beyond the
// result: a question that asks for a forecast too, and one that asks for a
// comparison the result doesn't hold. Real-model wording is the hand check
// (case 9, Sprint 9 test pack); the mock must pass these too (CI runs them
// with --mock).
import { monitorAnswerAgent, type MonitorAnswerOutput } from "@/lib/agents/monitor";
import { runModelStep } from "@/lib/agents/model-step";
import { createWorkflowRun } from "@/lib/agents/runs";
import type { EvalModule } from "@/lib/evals/types";
import { checkAnswer, MEASURE_LABELS, resultFrom, type AnswerablePlan, type QueryResult } from "@/lib/performance/ask-rules";
import { demoRows, DEMO_VIEWS } from "../helpers/monitor";

type In = { name: string; question: string; plan: AnswerablePlan };
type Ctx = { result: QueryResult };

const SIM_DAY = 14;

const p = (over: Partial<AnswerablePlan>): AnswerablePlan => ({ answerable: true, measures: ["cpa"], groupBy: "ad", days: { kind: "last", days: 7 }, ads: [], sort: null, limit: 30, ...over });

export const ANSWER_CASES: In[] = [
  { name: "Lowest cost per acquisition last week", question: "Which ad had the lowest cost per acquisition last week?", plan: p({ measures: ["cpa", "spend", "conversions"], sort: { by: "cpa", direction: "asc" } }) },
  { name: "Highest click-through rate so far", question: "Which ad has the highest click-through rate so far?", plan: p({ measures: ["ctr", "clicks", "impressions"], days: { kind: "all" }, sort: { by: "ctr", direction: "desc" } }) },
  { name: "Total spend so far", question: "How much have we spent in total so far?", plan: p({ measures: ["spend"], groupBy: "none", days: { kind: "all" } }) },
  { name: "The day with the most clicks", question: "Which day had the most clicks?", plan: p({ measures: ["clicks"], groupBy: "day", days: { kind: "all" }, sort: { by: "clicks", direction: "desc" } }) },
  { name: "One ad's return on ad spend last week", question: "What was the return on ad spend for ad 2 last week?", plan: p({ measures: ["roas", "revenue", "spend"], groupBy: "none", ads: [2] }) },
  {
    name: "Invited to forecast",
    question: "Which ad had the lowest cost per acquisition last week, and will it keep winning next month?",
    plan: p({ measures: ["cpa", "spend", "conversions"], sort: { by: "cpa", direction: "asc" } }),
  },
  {
    name: "Invited to compare beyond the result",
    question: "By what percentage did the best ad beat the worst on click-through rate last week?",
    plan: p({ measures: ["ctr"], sort: { by: "ctr", direction: "desc" } }),
  },
];

const mod: EvalModule<In, MonitorAnswerOutput, Ctx> = {
  agent: "monitorAnswer",
  cases: ANSWER_CASES.map((c) => ({ name: c.name, input: c })),
  async execute(env, c) {
    const m = env.member;
    const result = resultFrom(c.plan, demoRows(SIM_DAY), DEMO_VIEWS, SIM_DAY);
    const runId = await createWorkflowRun(m, "monitorPlan", 1, { eval: true }, async () => {}, { label: `Eval: answer (${c.name})` });
    const { output } = await runModelStep({ runId, workspaceId: m.workspaceId, userId: m.userId }, monitorAnswerAgent, { question: c.question, result }, 1, "Write the answer");
    return { runId, output, context: { result } };
  },
  grade(c, output, ctx) {
    const problems = [...checkAnswer(output.answer, ctx.result)];
    const top = ctx.result.rows[0];
    const sort = ctx.result.sort;
    if (top && sort && c.plan.groupBy === "ad" && !new RegExp(`\\bAd ${top.adNumber}\\b`, "i").test(output.answer)) problems.push(`doesn't name the top ad, Ad ${top.adNumber}`);
    if (top && sort && c.plan.groupBy === "day" && !new RegExp(`\\bday ${top.day}\\b`, "i").test(output.answer)) problems.push(`doesn't name the top day, day ${top.day}`);
    const key = sort?.by ?? c.plan.measures[0];
    if (top && !output.answer.includes(top.shown[key]!)) problems.push(`doesn't give the ${MEASURE_LABELS[key].toLowerCase()} as the table shows it (${top.shown[key]})`);
    return { pass: problems.length === 0, notes: problems.join("; ") || output.answer };
  },
};

export default mod;
