# Local picomatch safeguard

`lib/parse.js` is the MIT-licensed picomatch 4.0.7 file with the unmerged
[upstream proposal #235](https://github.com/micromatch/picomatch/pull/235)
adapted to literalize repeated extglobs containing wildcard stars and detect
repeated multi-character alternatives. It changes matching semantics for those
patterns. GitHub withdrew GHSA-fc5q-39xc-vjpf on 18 November 2026; this local
guard is retained at the owner's request as defense in depth, not as a claim
that all regular-expression denial-of-service cases are solved.

`scripts/patch-picomatch.cjs` checks the lockfile, the original 4.0.7 file and
the replacement checksums before applying this file during `npm ci`. It fails
on dependency drift and must be reviewed or removed when picomatch changes.
The npm audit continues to inspect the real dependency; this is not an audit
exception. `LICENSE` is the upstream MIT license.
