// A fast drop-in replacement for csv-reader 1.0.0: run(input) returns exactly
// csv-reader's {columns, rows, errors} for {text, header}, reading the text once,
// left to right, under csv-reader's broken-row policy:
//
//   - a U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF; a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field opening with a quote runs to the next quote that is not doubled (""
//     inside it is one quote; each CRLF or lone CR inside it reads as LF); what
//     follows the closing quote, up to the next comma or line break, is appended
//     as it stands (quote_junk when any of it is kept); a quote that never closes
//     is a literal character and the text after it is read again as unquoted
//     (unterminated_quote);
//   - a quote inside an unquoted field is literal; fields stay strings;
//   - columns is the first record when header is true, else null; rows are padded
//     with "" (short_row) or cut (long_row) to the first record's width;
//   - each error is {code, line, row} in the order met.
//
// Where the reference builds each field a character at a time, this module
// slices whole runs between special characters and only walks character by
// character around CRs inside quotes, which keeps the same answers at a
// fraction of the CPU.

const COMMA_END = 0;
const BREAK_END = 1;
const TEXT_END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;

  // The record being read, for error records.
  let recordLine = 1;
  let recordRow = null;

  // Scratch the field readers fill in.
  let fv = '';
  let kept = 0; // characters the last unquoted read kept (for quote_junk)

  // Reads unquoted characters from pos onto `prefix`, up to the next comma or
  // line break; a CR not followed by LF is dropped (stray_cr). Sets fv to the
  // field and kept to how many characters this read itself kept, and returns
  // how the field ended.
  function readUnquoted(prefix) {
    // Fast path: the run up to the next comma or LF holds no CR but a final
    // one belonging to a CRLF, so the field is one slice of it.
    {
      const i = pos;
      let cIdx = text.indexOf(',', i);
      let nIdx = text.indexOf('\n', i);
      if (cIdx === -1) cIdx = n + 1;
      if (nIdx === -1) nIdx = n + 1;
      const end = cIdx < nIdx ? cIdx : nIdx;
      const sliceEnd = end > n ? n : end;
      let field = text.slice(i, sliceEnd);
      let dropCR = false;
      if (field.charCodeAt(field.length - 1) === 13 && end === nIdx && end <= n) {
        // The LF's CR: part of the line break, not of the field.
        dropCR = true;
      }
      if (field.indexOf('\r') === (dropCR ? field.length - 1 : -1)) {
        if (dropCR) field = field.slice(0, -1);
        kept = field.length;
        fv = prefix === '' ? field : prefix + field;
        if (end > n) {
          pos = n;
          return TEXT_END;
        }
        pos = end + 1;
        if (end === nIdx) {
          line += 1;
          return BREAK_END;
        }
        return COMMA_END;
      }
      // A CR somewhere inside: the slow path below reads it exactly.
    }
    let out = prefix;
    let have = prefix !== '';
    let start = pos;
    let i = pos;
    let keptCount = 0;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 44) {
        // ','
        keptCount += i - start;
        fv = have ? out + text.slice(start, i) : text.slice(start, i);
        kept = keptCount;
        pos = i + 1;
        return COMMA_END;
      }
      if (c === 10) {
        // LF
        keptCount += i - start;
        fv = have ? out + text.slice(start, i) : text.slice(start, i);
        kept = keptCount;
        pos = i + 1;
        line += 1;
        return BREAK_END;
      }
      if (c === 13) {
        // CR: CRLF ends the field; a lone CR is dropped (stray_cr).
        if (text.charCodeAt(i + 1) === 10) {
          keptCount += i - start;
          fv = have ? out + text.slice(start, i) : text.slice(start, i);
          kept = keptCount;
          pos = i + 2;
          line += 1;
          return BREAK_END;
        }
        keptCount += i - start;
        out = have ? out + text.slice(start, i) : text.slice(start, i);
        have = true;
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        i += 1;
        start = i;
        continue;
      }
      i += 1;
    }
    keptCount += n - start;
    fv = have ? out + text.slice(start, n) : text.slice(start, n);
    kept = keptCount;
    pos = n;
    return TEXT_END;
  }

  // Reads a quoted field whose opening quote is at pos. Sets fv and returns
  // how the field ended.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    const segs = [];
    let i = open + 1;
    let segStart = i;
    // Scan to the closing quote, "" being one literal quote.
    for (;;) {
      const q = text.indexOf('"', i);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        return readUnquoted('"');
      }
      // The run [segStart, q) goes into the value, with each CRLF or lone CR
      // read as LF and every line ending counted.
      if (q > segStart) {
        const cr = text.indexOf('\r', segStart);
        if (cr === -1 || cr >= q) {
          let k = segStart;
          for (;;) {
            const lf = text.indexOf('\n', k);
            if (lf === -1 || lf >= q) break;
            line += 1;
            k = lf + 1;
          }
          segs.push(text.slice(segStart, q));
        } else {
          let last = segStart;
          let k = segStart;
          while (k < q) {
            const c = text.charCodeAt(k);
            if (c === 13) {
              if (k > last) segs.push(text.slice(last, k));
              segs.push('\n');
              line += 1;
              k += text.charCodeAt(k + 1) === 10 ? 2 : 1;
              last = k;
            } else {
              if (c === 10) line += 1;
              k += 1;
            }
          }
          if (q > last) segs.push(text.slice(last, q));
        }
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote is one quote in the value.
        segs.push('"');
        i = q + 2;
        segStart = i;
        continue;
      }
      // The closing quote.
      const value = segs.length === 1 ? segs[0] : segs.join('');
      pos = q + 1;
      if (pos >= n) {
        fv = value;
        return TEXT_END;
      }
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        fv = value;
        return COMMA_END;
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        fv = value;
        return BREAK_END;
      }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        fv = value;
        return BREAK_END;
      }
      // What follows the closing quote is appended as it stands.
      const ended = readUnquoted(value);
      if (kept > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      return ended;
    }
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    let ended;
    do {
      quoted = text.charCodeAt(pos) === 34;
      ended = quoted ? readQuoted() : readUnquoted('');
      fields.push(fv);
    } while (ended === COMMA_END);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
