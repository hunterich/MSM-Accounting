/**
 * CSV and OFX/QFX bank statement parser.
 *
 * Supports:
 *  - Standard CSV with date/amount/description/balance columns
 *  - Indonesian bank CSV formats (BCA, Mandiri, BRI) with separate debit/credit columns
 *  - OFX / QFX files (SGML-style, not XML-wrapped)
 */

export interface ParsedStatementLine {
  date: Date
  description: string
  /** positive = credit/deposit, negative = debit/withdrawal */
  amount: number
  balance?: number
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseLocalDate(raw: string): Date | null {
  if (!raw) return null
  const s = raw.trim()

  // OFX date format: YYYYMMDDHHMMSS or YYYYMMDD
  if (/^\d{8,14}/.test(s)) {
    const y = parseInt(s.slice(0, 4), 10)
    const mo = parseInt(s.slice(4, 6), 10) - 1
    const d = parseInt(s.slice(6, 8), 10)
    const dt = new Date(y, mo, d)
    if (!isNaN(dt.getTime())) return dt
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/)
  if (dmy) {
    const dt = new Date(parseInt(dmy[3], 10), parseInt(dmy[2], 10) - 1, parseInt(dmy[1], 10))
    if (!isNaN(dt.getTime())) return dt
  }

  // YYYY-MM-DD or YYYY/MM/DD
  const ymd = s.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/)
  if (ymd) {
    const dt = new Date(parseInt(ymd[1], 10), parseInt(ymd[2], 10) - 1, parseInt(ymd[3], 10))
    if (!isNaN(dt.getTime())) return dt
  }

  // MM/DD/YYYY
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mdy) {
    const dt = new Date(parseInt(mdy[3], 10), parseInt(mdy[1], 10) - 1, parseInt(mdy[2], 10))
    if (!isNaN(dt.getTime())) return dt
  }

  const fallback = new Date(s)
  return isNaN(fallback.getTime()) ? null : fallback
}

function parseAmount(raw: string): number {
  if (!raw) return 0
  // Remove thousand separators (dots used in Indonesian format), keep minus and decimal comma/period
  const cleaned = raw
    .trim()
    .replace(/\./g, '') // remove dots (thousand sep in ID)
    .replace(/,/g, '.') // comma decimal → dot decimal
    .replace(/[^\d.\-]/g, '')
  const n = parseFloat(cleaned)
  return isNaN(n) ? 0 : n
}

// Split a CSV line respecting quoted fields
function splitCSVLine(line: string): string[] {
  const cols: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuote = !inQuote
    } else if ((ch === ',' || ch === ';') && !inQuote) {
      cols.push(cur.trim().replace(/^"|"$/g, ''))
      cur = ''
    } else {
      cur += ch
    }
  }
  cols.push(cur.trim().replace(/^"|"$/g, ''))
  return cols
}

// ---------------------------------------------------------------------------
// CSV parser
// ---------------------------------------------------------------------------

export function parseCSV(buffer: Buffer): ParsedStatementLine[] {
  const text = buffer.toString('utf-8')
  const rawLines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)

  if (rawLines.length < 2) return []

  // Find header row (first line that contains recognisable column keywords)
  let headerIdx = -1
  let headers: string[] = []
  for (let i = 0; i < Math.min(10, rawLines.length); i++) {
    const cols = splitCSVLine(rawLines[i]).map((c) => c.toLowerCase())
    if (
      cols.some((c) => c.includes('date') || c.includes('tanggal')) &&
      cols.some(
        (c) =>
          c.includes('amount') ||
          c.includes('debit') ||
          c.includes('credit') ||
          c.includes('jumlah') ||
          c.includes('mutasi')
      )
    ) {
      headerIdx = i
      headers = cols
      break
    }
  }

  if (headerIdx === -1) return []

  // Detect column indices
  const idx = {
    date: headers.findIndex((h) => h.includes('date') || h.includes('tanggal')),
    description: headers.findIndex(
      (h) =>
        h.includes('description') ||
        h.includes('keterangan') ||
        h.includes('memo') ||
        h.includes('uraian') ||
        h.includes('transaksi')
    ),
    amount: headers.findIndex(
      (h) => h.includes('amount') || h.includes('jumlah') || h.includes('nominal')
    ),
    debit: headers.findIndex((h) => h === 'debit' || h.includes('debet') || h === 'db'),
    credit: headers.findIndex((h) => h === 'credit' || h.includes('kredit') || h === 'cr'),
    balance: headers.findIndex(
      (h) => h.includes('balance') || h.includes('saldo') || h.includes('sal.')
    ),
  }

  if (idx.date === -1) return []

  // Fallback description column
  if (idx.description === -1) {
    idx.description = headers.findIndex(
      (h) => !['date', 'amount', 'debit', 'credit', 'balance', 'saldo'].some((k) => h.includes(k))
    )
  }

  const lines: ParsedStatementLine[] = []

  for (let i = headerIdx + 1; i < rawLines.length; i++) {
    const cols = splitCSVLine(rawLines[i])
    if (cols.length <= 1) continue

    const rawDate = cols[idx.date] ?? ''
    const date = parseLocalDate(rawDate)
    if (!date) continue

    const description =
      idx.description >= 0 ? (cols[idx.description] ?? '').trim() : rawLines[i].trim()

    let amount: number
    if (idx.debit >= 0 && idx.credit >= 0) {
      // Separate debit/credit columns (Indonesian bank format)
      const debit = parseAmount(cols[idx.debit] ?? '')
      const credit = parseAmount(cols[idx.credit] ?? '')
      amount = credit - debit
    } else if (idx.amount >= 0) {
      amount = parseAmount(cols[idx.amount] ?? '')
    } else {
      continue
    }

    const balance =
      idx.balance >= 0 && cols[idx.balance]
        ? parseAmount(cols[idx.balance])
        : undefined

    lines.push({ date, description, amount, balance })
  }

  return lines
}

// ---------------------------------------------------------------------------
// OFX / QFX parser
// ---------------------------------------------------------------------------

export function parseOFX(buffer: Buffer): ParsedStatementLine[] {
  const text = buffer.toString('utf-8')
  const lines: ParsedStatementLine[] = []

  // Extract all <STMTTRN>...</STMTTRN> blocks
  const trxPattern = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi
  let match: RegExpExecArray | null

  // Also handle legacy OFX (SGML, no closing tags) by splitting on <STMTTRN>
  const hasClosingTag = /<\/STMTTRN>/i.test(text)

  if (hasClosingTag) {
    while ((match = trxPattern.exec(text)) !== null) {
      const block = match[1]
      const parsed = parseOFXBlock(block)
      if (parsed) lines.push(parsed)
    }
  } else {
    // SGML style: split on opening tag
    const parts = text.split(/<STMTTRN>/i)
    for (let i = 1; i < parts.length; i++) {
      const parsed = parseOFXBlock(parts[i])
      if (parsed) lines.push(parsed)
    }
  }

  return lines
}

function parseOFXBlock(block: string): ParsedStatementLine | null {
  const get = (tag: string): string => {
    const re = new RegExp(`<${tag}>([^<\r\n]+)`, 'i')
    const m = block.match(re)
    return m ? m[1].trim() : ''
  }

  const rawDate = get('DTPOSTED')
  const date = parseLocalDate(rawDate)
  if (!date) return null

  const rawAmount = get('TRNAMT')
  if (!rawAmount) return null
  const amount = parseFloat(rawAmount.replace(',', '.'))
  if (isNaN(amount)) return null

  const description = get('MEMO') || get('NAME') || ''

  return { date, description, amount }
}

// ---------------------------------------------------------------------------
// Auto-detect and parse
// ---------------------------------------------------------------------------

export function parseStatement(buffer: Buffer, filename: string): ParsedStatementLine[] {
  const ext = filename.toLowerCase().split('.').pop() ?? ''

  if (ext === 'ofx' || ext === 'qfx') {
    return parseOFX(buffer)
  }

  if (ext === 'csv' || ext === 'txt') {
    return parseCSV(buffer)
  }

  // Try to auto-detect by content
  const peek = buffer.slice(0, 512).toString('utf-8')
  if (/<OFX>/i.test(peek) || /OFXHEADER:/i.test(peek) || /<STMTTRN>/i.test(peek)) {
    return parseOFX(buffer)
  }

  // Default to CSV
  return parseCSV(buffer)
}
