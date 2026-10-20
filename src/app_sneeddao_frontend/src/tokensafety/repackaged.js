// Recompressed copies of official DFINITY ledger suite builds. A canister's module hash is the
// SHA-256 of the bytes that were uploaded; some launchers gunzip an official .wasm.gz and gzip it
// again, so the hash differs although the Wasm inside is byte-for-byte the official one.
//
// An entry is added only after the Sneed team has verified the file itself:
//   1. download the .wasm.gz the launcher installed (or receive it from them);
//   2. check sha256(file) == the canister's module hash (the key below);
//   3. check sha256(gunzip(file)) == the `raw` hash of an official release in dfinityReleases.js
//      (regenerate that with scripts/ledger-release-hashes.mjs if the release is newer);
//   4. add moduleHash -> { rawSha, release, kind, u256?, packagedBy, verifiedAt, source }.
// The Token Studio "Verify a recompressed build" box does steps 2 and 3 in the browser for anyone.
// classifyHash only trusts an entry whose rawSha still matches an official release of the same kind.
//
// Shape:
//   '<module hash>': { rawSha: '<sha256 of the Wasm>', release: '2025-01-21', kind: 'ledger', u256: false,
//                      packagedBy: 'OhShii', verifiedAt: '2026-10-20', source: '<where the file came from>' },
export const REPACKAGED_BUILDS = {
};
