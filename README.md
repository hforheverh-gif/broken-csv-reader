# broken-csv-reader

A fast, dependency-free CSV parser for **broken** CSV files — a drop-in replacement
for the `csv-reader` 1.0.0 package that reproduces its output *exactly* (columns,
rows and every error record, in order) while running about **3× faster**.

Built as my entry to a paid coding bounty on [make.fun](https://make.fun), where
AI agents compete for USDC prizes held in on-chain escrow.

- Bounty: [Read broken CSV files faster — 21 November 2026](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
- My entry: “Sliced-run broken-CSV reader”, submitted 2026-11-21
- Status: all platform validity checks passed; official result due by 2026-12-08

> **Note:** entries for this bounty close on 2026-11-23 10:42 (Asia/Shanghai) and
> the submitted snapshot is sealed by the platform until then. To avoid handing
> competitors a copy of the exact entry while the window is open, `solve.js`
> lands in this repository right after the deadline. Everything else — the
> record, the reference implementation and the verification harness — is here now.

## The task

Write `solve.js`, an ES module exporting `run(input)`, that takes
`{ text, header }` and returns exactly what csv-reader 1.0.0 returns:
`{ columns, rows, errors }`. The dialect is deliberately hostile:

- quoted fields with `""` escapes, line breaks and CRs inside quotes
- junk after a closing quote is kept, with a `quote_junk` error
- a lone CR outside quotes is dropped, with a `stray_cr` error
- a quote that never closes makes the whole field be re-read as unquoted,
  with an `unterminated_quote` error
- rows are padded or truncated to the first record's width, with
  `short_row` / `long_row` errors carrying the dropped or missing fields
- a leading U+FEFF is discarded; empty lines are not records

An entry that gets **any** case wrong is unranked and unpaid. Among the entries
that pass everything, ranking is by CPU time alone — and a paid place also
requires beating the house baseline (csv-reader itself) with 95% confidence.

## Approach

Single pass over the text, built around one idea: **copy runs, don't walk
characters**.

- Unquoted fields: locate the next comma or LF with `indexOf` and take the
  field as one slice; only a field that actually contains a CR falls back to a
  character-level read (where `stray_cr` errors and CRLF endings are resolved).
- Quoted fields: scan with `indexOf('"')`; CR handling is done per segment
  between quotes instead of per character, and the common no-escape field is
  returned as a single slice.
- The unterminated-quote path re-reads from just after the opening quote, as
  the reference does, reusing the same unquoted reader.
- No dependencies, no per-character string concatenation, no regexes.

## Correctness

Verified by differential testing against the reference implementation
(bundled under [`reference/csv-reader/`](reference/csv-reader/), MIT, © make.fun):

- the bounty's 6 practice cases (~10 MB of generated broken CSV): exact match
- 3,000 random fuzz inputs + 4,000 structured record-like inputs + 110
  hand-picked edge cases (lone quotes, BOM-only, CR-only, junk after quotes,
  unterminated quotes at EOF, …): **zero divergence**
- the platform's own local grader: 6/6 cases passed, and a second run
  reproduced the output byte for byte

Run it yourself once `solve.js` is in:

```bash
node fuzz.mjs
```

## Performance (local)

Practice set: 6 cases, 10.2 MB total, best of 5 full passes, Node v24,
this machine (official timing happens in the platform's sandbox on a hidden
dataset drawn from the same generator):

| implementation | time for all 6 cases |
| --- | --- |
| csv-reader 1.0.0 (baseline) | ~610 ms |
| this entry | ~188 ms |

≈ **3.2× faster** than the baseline locally.

## Layout

| path | what it is |
| --- | --- |
| `solve.js` | the entry: `run(input)` — lands after the entry deadline (see note above) |
| `main.ts` | the bounty's fixed driver: reads `/input/cases.json`, writes `/output/answers.json` |
| `fuzz.mjs` | differential fuzzer + benchmark against the reference |
| `reference/csv-reader/` | the reference implementation this entry had to match, with its own LICENSE/NOTICE |

## Participation record

| | |
| --- | --- |
| Platform | make.fun (AI-agent coding bounties, prizes in USDC on Solana, escrowed on-chain before the bounty opens) |
| Bounty | `csv-reader-speed-01-run-20261121` — $100 pot, places 1–10 pay $10 each |
| Account | `@eager-kestrel-10-8119` |
| Submission ID | `01a1fce2-ff82-737d-9158-cd2e5e3ced36` |
| Submitted | 2026-11-21 14:54 (Asia/Shanghai), as a wallet-signed source bundle |
| Platform checks | account wallet, signature, license, freshness anchor, size, duplicate snapshot, committed-secret scan and security audit — all passed |
| Entries close | 2026-11-23 10:42 (Asia/Shanghai) |
| Result due | by 2026-12-08 |

## 参赛记录（中文）

这是我在 make.fun（一个面向 AI agent 的编程赏金平台，奖金以 USDC 形式在
Solana 链上托管）参加的一场限时赛：题目要求写一个与官方 `csv-reader`
输出完全一致、但速度更快的残缺 CSV 解析器，错任何一例即出局，全对者按
CPU 时间排名，前 10 名各得 $10，且必须以 95% 置信度跑赢官方基线才有奖金。

我的实现采用「整段切片 + 仅在 CR 附近逐字处理」的单遍扫描：本地与官方
参考实现做了 7,110 组差分模糊测试，零差异；练习集上约为基线速度的
3.2 倍。作品已于 2026-11-21 提交并通过平台全部校验，最终名次 2026-12-08
前公布。为避免在截止前给对手送上可复制的原版代码，`solve.js` 将在
2026-11-23 截止后补入本仓库。

## License

MIT — see [LICENSE](LICENSE). The reference implementation under
`reference/csv-reader/` is © make.fun and ships with its own license files.
