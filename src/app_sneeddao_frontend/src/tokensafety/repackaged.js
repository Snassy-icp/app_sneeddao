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
    // OhShii Launcher's ledger (e.g. 7rrmx-tyaaa-aaaal-qsraq-cai): 678,521 bytes, gzip header names
    // ic-icrc1-ledger.wasm, mtime 2025-08-01; unzips byte-for-byte to the official 2025-01-21 ledger.
    'f042ac293df25134660990dddd5d4c0525687fa3e1e69868bb42b2a9fca2d749': { rawSha: '0299be32447ce9880d3a48fa47346532a812685c4e76c96a3cc2e3ea002c6020', release: '2025-01-21', kind: 'ledger', u256: false, packagedBy: 'the OhShii Launcher', verifiedAt: '2026-10-20', source: 'the launcher\'s ledger artifact, sent by OhShii' },
};
