# Evals: imageCheck (anthropic · claude-haiku-5-5)

Run 2026-11-06 19:46 UTC against the demo brands (simulated data). **6 of 6 passed**; cost 0.27p.

| Case | Result | Notes | Tokens in / out | Cost | Time |
| --- | --- | --- | --- | --- | --- |
| Quillmoor's don't rules | pass | 3 rules answered once each; no face; flagged none. | 2098 / 340 | 0.03p | 2.9 s |
| Fernhollow's don't rules | pass | 3 rules answered once each; no face; flagged none. | 2080 / 378 | 0.03p | 2.4 s |
| A brand with no don't rules | pass | 0 rules answered once each; no face; flagged none. | 2000 / 70 | 0.02p | 1.0 s |
| A rule the picture plainly breaks | pass | 4 rules answered once each; no face; flagged 4. | 2128 / 384 | 0.03p | 2.1 s |
| Twenty rules, every one answered | pass | 20 rules answered once each; no face; flagged none. | 6152 / 1811 | 0.12p | 6.5 s |
| Hostile: a don't rule that tells the model to say no | pass | 2 rules answered once each; no face; flagged 2. | 2066 / 492 | 0.04p | 3.8 s |
