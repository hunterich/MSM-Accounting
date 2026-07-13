export type Locale = 'id' | 'en';

const dict = {
  'app.title':        { id: 'Kasir Apotek',        en: 'Pharmacy POS' },
  'auth.email':       { id: 'Email',               en: 'Email' },
  'auth.password':    { id: 'Kata sandi',          en: 'Password' },
  'auth.login':       { id: 'Masuk',               en: 'Log in' },
  'auth.logout':      { id: 'Keluar',              en: 'Log out' },
  'auth.forbidden':   { id: 'Anda tidak memiliki akses POS', en: 'You do not have POS access' },
  'shift.register':   { id: 'Kasir/Register',      en: 'Register' },
  'shift.openingFloat': { id: 'Modal awal',        en: 'Opening float' },
  'shift.open':       { id: 'Buka shift',          en: 'Open shift' },
  'shift.continue':   { id: 'Lanjutkan shift',     en: 'Continue shift' },
  'shift.alreadyOpen': { id: 'Register ini sudah punya shift terbuka', en: 'This register already has an open shift' },
  'shift.close':      { id: 'Tutup shift',         en: 'Close shift' },
  'shift.countedCash': { id: 'Uang tunai dihitung', en: 'Counted cash' },
  'shift.expected':   { id: 'Seharusnya',          en: 'Expected' },
  'shift.variance':   { id: 'Selisih',             en: 'Variance' },
  'shift.zreport':    { id: 'Laporan Z',           en: 'Z-report' },
  'checkout.scan':    { id: 'Pindai / cari barang', en: 'Scan / search item' },
  'checkout.total':   { id: 'Total',               en: 'Total' },
  'checkout.pay':     { id: 'Bayar',               en: 'Pay' },
  'checkout.qty':     { id: 'Jml',                 en: 'Qty' },
  'checkout.empty':   { id: 'Keranjang kosong',    en: 'Cart is empty' },
  'checkout.cart':    { id: 'Keranjang',           en: 'Cart' },
  'checkout.subtotal': { id: 'Subtotal',           en: 'Subtotal' },
  'checkout.ppn':     { id: 'PPN 11%',             en: 'VAT 11%' },
  'checkout.stock':   { id: 'stok',                en: 'stock' },
  'checkout.exp':     { id: 'exp',                 en: 'exp' },
  'checkout.items':   { id: 'item',                en: 'items' },
  'cat.all':          { id: 'Semua',              en: 'All' },
  'cat.bebas':        { id: 'Obat bebas',         en: 'Obat bebas' },
  'cat.terbatas':     { id: 'Obat bebas terbatas', en: 'Obat bebas terbatas' },
  'cat.keras':        { id: 'Obat keras',         en: 'Obat keras' },
  'cat.umum':         { id: 'Umum',               en: 'General' },
  'modifiers.title':  { id: 'Pilih opsi',          en: 'Choose options' },
  'modifiers.required': { id: 'Wajib',             en: 'Required' },
  'modifiers.add':    { id: 'Tambah ke keranjang', en: 'Add to cart' },
  'tender.cash':      { id: 'Tunai',               en: 'Cash' },
  'tender.received':  { id: 'Uang diterima',       en: 'Cash received' },
  'tender.change':    { id: 'Kembalian',           en: 'Change' },
  'tender.complete':  { id: 'Selesaikan',          en: 'Complete' },
  'tender.exact':     { id: 'Uang pas',            en: 'Exact' },
  'receipt.title':    { id: 'Struk',               en: 'Receipt' },
  'receipt.print':    { id: 'Cetak',               en: 'Print' },
  'receipt.newSale':  { id: 'Transaksi baru',      en: 'New sale' },
  'common.cancel':    { id: 'Batal',               en: 'Cancel' },
  'offline.online':   { id: 'Online',              en: 'Online' },
  'offline.offline':  { id: 'Offline',             en: 'Offline' },
  'offline.queued':   { id: 'antre',               en: 'queued' },
  'offline.sync':     { id: 'Sinkronkan',          en: 'Sync now' },
  'offline.exceptions': { id: 'Perlu ditinjau',    en: 'Needs review' },
} as const;

export type StringKey = keyof typeof dict;

/** Translate a key. Defaults to Bahasa Indonesia; falls back to the key if unknown. */
export function t(key: StringKey, locale: Locale = 'id'): string {
  const entry = dict[key];
  if (!entry) return key;
  return entry[locale] ?? key;
}
