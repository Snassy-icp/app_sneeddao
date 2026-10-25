// The minting-account verdicts that need no chain read (checks.js "Minting account cannot mint at will").

/// { grade: 'pass' | 'fail', label, link: 'canister' | 'principal' | undefined } for a minting account owner
/// whose verdict is known without a lookup, else null. None of the passing owners can send a ledger transfer,
/// so none can mint; any other self-authenticating principal can. `nnsSystem` and `blackholes` map ids to names.
export function knownMintingOwner(owner, ledgerId, nnsSystem = {}, blackholes = {}) {
    if (owner === ledgerId) return { grade: 'pass', label: 'The ledger itself: no one can transact as it', link: 'canister' };
    if (owner === '2vxsx-fae') return { grade: 'pass', label: 'The anonymous principal: cannot hold or move tokens', link: undefined };
    if (owner === 'aaaaa-aa') return { grade: 'pass', label: 'The management canister (aaaaa-aa): it never sends ledger transfers, so nothing can mint', link: undefined };
    if (nnsSystem[owner]) return { grade: 'pass', label: `The ${nnsSystem[owner]}: an NNS system canister that never transfers tokens`, link: 'canister' };
    if (blackholes[owner]) return { grade: 'pass', label: `The ${blackholes[owner]} canister: it never transfers tokens`, link: 'canister' };
    if (owner.length !== 27) return { grade: 'fail', label: 'A user principal: its holder can mint without limit', link: 'principal' };
    return null;
}
