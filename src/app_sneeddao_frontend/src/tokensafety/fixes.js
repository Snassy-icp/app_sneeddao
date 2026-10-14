// What the studio offers for each failing or weak check: a label and where
// to go. Attached to the check tree's leaves by id; the tree view shows the
// button next to a warning or failure.
const lockTokens = (id) => ({ label: 'Lock tokens', href: `/lock_wizard?type=token&token=${id}` });
const lockPosition = (id) => ({ label: 'Lock the LP position', href: `/lock_wizard?type=position&token=${id}` });
const harden = (id, section, label) => ({ label, href: `/studio/${id}/harden#${section}` });
const handover = (id, label) => ({ label, href: `/studio/${id}/handover` });
const index = (id, label) => ({ label, href: `/studio/${id}/index` });

export const FIXES = {
    'controllers': (id) => handover(id, 'Hand control over'),
    'ctl:Ledger': (id) => handover(id, 'Hand control over'),
    'ctl:Index': (id) => index(id, 'Add or hand over the index'),
    'ctl:noarchive': (id) => handover(id, 'Hand control over'),
    'code': (id) => harden(id, 'control', 'Move to vetted code'),
    'code:standards': (id) => harden(id, 'control', 'Move to vetted code'),
    'mint:account': (id) => harden(id, 'minting', 'What can be done'),
    'mint:history': (id) => harden(id, 'minting', 'What can be done'),
    'dist:top1': lockTokens,
    'dist:top10': lockTokens,
    'dist:folded': lockTokens,
    'locks:total': lockTokens,
    'locks:sneedlock': lockTokens,
    'locks:cliffs': lockTokens,
    'lp:control': lockPosition,
    'lp:exists': (id) => harden(id, 'liquidity', 'Add liquidity'),
    'lp:none': (id) => harden(id, 'liquidity', 'Add liquidity'),
    'lp:depth': (id) => harden(id, 'liquidity', 'Deepen liquidity'),
    'cycles': (id) => harden(id, 'cycles', 'Top up and make observable'),
};

/// The fix for a leaf, if the studio has one (leaves of dynamic groups appear
/// after listing, so this is asked at render time rather than attached once).
export function fixFor(leafId, ledgerId) {
    const f = FIXES[leafId];
    return f ? f(ledgerId) : null;
}
