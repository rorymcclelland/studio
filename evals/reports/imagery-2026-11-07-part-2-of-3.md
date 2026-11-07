# Evals: imagery (anthropic · claude-haiku-5-5)

Part 2 of 3 of this agent's cases (every 3th case, from case 2).

Run 2026-11-07 15:03 UTC against the demo brands (simulated data). **2 of 3 passed**; cost 16.28p.

| Case | Result | Notes | Tokens in / out | Cost | Time |
| --- | --- | --- | --- | --- | --- |
| Quillmoor sign-ups | error | Brief: The agent's reply failed its checks: the story says "Many people"; quantities in words can't be checked, so use only figures from the context | 0 / 0 | 0p | 46.1 s |
| Quillmoor brief that asks for a logo and words | pass | 4 pictures kept; prompts pass the checks. | 23815 / 13956 | 16.21p | 60.7 s |
| Regression, 27 Oct: the ruled-out face (a walker seen from behind) | pass | 4 prompts in 1 attempt; they pass the checks. | 947 / 1604 | 0.07p | 8.8 s |
