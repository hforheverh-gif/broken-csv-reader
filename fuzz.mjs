// Differential fuzzer + benchmark: ./solve.js vs the bundled csv-reader 1.0.0
// reference (reference/csv-reader/index.js). Zero divergence is the bar —
// the bounty disqualifies an entry that gets any case wrong.
//
//   node fuzz.mjs
import { readCsv } from './reference/csv-reader/index.js';
import { run as mine } from './solve.js';

function deepEqual(a, b) {
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (a !== null && typeof a === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return deepEqual(ka, kb) && ka.every((k) => deepEqual(a[k], b[k]));
  }
  return a === b;
}

let checked = 0;
let bad = 0;
function compare(input) {
  checked++;
  if (!deepEqual(mine(input), readCsv(input))) {
    bad++;
    if (bad <= 3) console.log('MISMATCH', JSON.stringify(input).slice(0, 200));
  }
}

// 1) Hand-picked edge cases.
const edges = ['', '\uFEFF', '\n', '\r', '\r\n', '\r\r', '\n\n\n', 'a', 'a,', ',a', ',',
  '"', '""', '"""', '""""', '"a', '"a"', '"a"x', '"a"\r', '"a"\r\n', '"a"\rb', 'a\rb',
  '\ra', '\r\na', '"a""b"', '"a"""', '"a""', 'a\r\nb\r\n', 'a\n\nb', '"x\ny"', '"x\ry"',
  '"x\r\ny"', 'h1,h2\n1', 'h1,h2\n1,2,3', 'h1\n1,2', '"",x', 'x,""', '\uFEFFa,b\n1,2',
  '"un,ter', '"un\ntwo', 'a,"b', '"a"junk"more', '"a"j\rk', '"a"j\r\n', 'q\r\r\nz',
  '\r,\r', '""""""', 'a\na\ra', '";\n;"', '"a\r"', '"a\r\r"', '"a\n\n"', 'x,"y"\r\nz', '"a" "b"'];
for (const text of edges) for (const header of [true, false]) compare({ text, header });
console.log(`edges: ${checked} checked, ${bad} mismatches`);

// 2) Random fuzz over CSV-ish pieces.
let seed = 123456789;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pieces = ['a', 'bb', 'ccc', ',', '"', '""', '\n', '\r', '\r\n', 'x,y', '"q"',
  '"a""b"', '', ' ', 'é', '\uFEFF', '"un', 'ter"', '\r\r', '\n\n', '1', '"\n"', '"\r"', ',"', '",'];
for (let t = 0; t < 3000; t++) {
  const len = 1 + Math.floor(rnd() * 40);
  let text = '';
  for (let k = 0; k < len; k++) text += pieces[Math.floor(rnd() * pieces.length)];
  compare({ text, header: rnd() < 0.5 });
}

// 3) Structured fuzz: record-like texts with ragged widths.
const flds = ['aa', 'b', '', '"q"', '"a,b"', 'x\ry', '"m\nn"', 'ccc', '"un', 'j"', '"a"z', '42'];
for (let t = 0; t < 4000; t++) {
  const rowsN = Math.floor(rnd() * 8);
  let text = rnd() < 0.3 ? '\uFEFF' : '';
  for (let r = 0; r < rowsN; r++) {
    const cols = 1 + Math.floor(rnd() * 4);
    const fs = [];
    for (let c = 0; c < cols; c++) fs.push(flds[Math.floor(rnd() * flds.length)]);
    text += fs.join(',') + (rnd() < 0.7 ? '\n' : rnd() < 0.5 ? '\r\n' : '\r');
    if (rnd() < 0.15) text += '\n';
  }
  compare({ text, header: rnd() < 0.5 });
}
console.log(`total: ${checked} cases, ${bad} mismatches`);

// 4) Benchmark on a synthetic ~2 MB broken-CSV input.
{
  const rows = [];
  for (let i = 0; i < 12000; i++) {
    rows.push(`identifier-${i}-abcdefghij,"display name, number ${i}",${(i * 37) % 100},some longer plain value ${i} xyz,${i % 3 ? 'plain-field-value' : '"quo""ted, with comma"'},notes-${i}-abcdefghij-klmnop,${(i * 91) % 1000},final value here ${i},x\ry,tail-${i}`);
  }
  const input = { text: rows.join('\n'), header: true };
  const bench = (fn) => {
    fn(input);
    let best = Infinity;
    for (let r = 0; r < 5; r++) {
      const t0 = process.hrtime.bigint();
      fn(input);
      best = Math.min(best, Number(process.hrtime.bigint() - t0) / 1e6);
    }
    return best;
  };
  const tRef = bench(readCsv);
  const tMine = bench(mine);
  console.log(`benchmark (~${(input.text.length / 1048576).toFixed(1)} MB): reference ${tRef.toFixed(1)} ms, mine ${tMine.toFixed(1)} ms, speedup ${(tRef / tMine).toFixed(2)}x`);
}
console.log(bad === 0 ? 'ALL MATCH' : 'DIVERGENCE FOUND');
