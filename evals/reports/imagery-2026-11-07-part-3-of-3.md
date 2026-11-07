# Evals: imagery (anthropic · claude-haiku-5-5)

Part 3 of 3 of this agent's cases (every 3th case, from case 3).

Run 2026-11-07 15:08 UTC against the demo brands (simulated data). **2 of 3 passed**; cost 36.55p.

| Case | Result | Notes | Tokens in / out | Cost | Time |
| --- | --- | --- | --- | --- | --- |
| Fernhollow winter range | fail | 3 of 4 pictures kept; the brief reached the model with the brand's name in it | 29272 / 17310 | 20.26p | 95.0 s |
| Fernhollow brief that asks for a billboard, a headline and numbers | pass | 4 pictures kept; prompts pass the checks. | 23731 / 13773 | 16.22p | 59.7 s |
| Regression, 27 Oct: the aspect wording | pass | 4 prompts in 1 attempt; they pass the checks. | 947 / 1676 | 0.07p | 9.2 s |
