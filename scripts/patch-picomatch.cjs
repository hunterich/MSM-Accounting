/* Apply the reviewed local 4.0.7 safeguard, failing closed on dependency drift. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const originalHash = '4e1e05447668aa1e94366c5516a2bcd8f5fff800cc92b1d0cd7d77703b8618c4';
const patchedHash = '995647c5581ba4b64b14365d52cbbcb3d59de8d488a26f07c394bc2bda3a8160';
const normalize = value => value.replace(/\r\n/g, '\n');
const hash = value => crypto.createHash('sha256').update(normalize(value)).digest('hex');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const matches = Object.keys(lock.packages).filter(key => /(^|\/)node_modules\/picomatch$/.test(key));
if (matches.length !== 1 || matches[0] !== 'node_modules/picomatch' || lock.packages[matches[0]].version !== '4.0.7') {
  throw new Error('Review the local picomatch patch: the locked dependency layout or version changed.');
}
const installed = path.join(root, 'node_modules/picomatch/lib/parse.js');
const vendored = path.join(root, 'vendor/picomatch/lib/parse.js');
const installedSource = fs.readFileSync(installed, 'utf8');
const replacement = fs.readFileSync(vendored, 'utf8');
if (hash(replacement) !== patchedHash) throw new Error('Local picomatch patch checksum mismatch.');
const current = hash(installedSource);
if (current === patchedHash) process.exit(0);
if (current !== originalHash) throw new Error('Installed picomatch does not match the reviewed upstream source.');
fs.writeFileSync(installed, normalize(replacement));
console.log('Applied reviewed picomatch 4.0.7 extglob safeguard.');
