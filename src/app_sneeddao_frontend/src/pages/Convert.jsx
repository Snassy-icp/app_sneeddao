// /convert: BTC <-> ckBTC, ETH <-> ckETH and ERC-20 <-> ckERC20 through DFINITY's chain-fusion
// minters. ?asset=<ck ledger id>&tab=deposit|withdraw picks the asset and direction (the token
// cards' "Convert" button links here). Calls go straight from the user's identity to the minters
// and ledgers; Sneed Hub runs no canister in between and never holds a Bitcoin or Ethereum key.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Actor, HttpAgent } from '@dfinity/agent';
import { FaBitcoin, FaEthereum, FaCoins, FaArrowDown, FaArrowUp } from 'react-icons/fa';
import Header from '../components/Header';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../AuthContext';
import { CKBTC, CKETH, ckAssetForLedger, erc20AssetsFromInfo, ckLedgerIdl, ckethInfo } from '../utils/ckMinters';
import { BtcDeposit, BtcWithdraw } from '../components/convert/BtcConvert';
import { EthDeposit, EthWithdraw } from '../components/convert/EthConvert';
import { Notice, Button } from '../components/convert/ConvertUi';

const network = process.env.DFX_NETWORK;
const isMainnet = network === 'ic' || network === 'staging';
const host = isMainnet ? 'https://icp0.io' : 'http://localhost:4943';

function useMakeActor(identity) {
    const [agent, setAgent] = useState(null);
    useEffect(() => {
        let live = true;
        (async () => {
            const a = await HttpAgent.create({ host, ...(identity ? { identity } : {}) });
            if (!isMainnet) await a.fetchRootKey().catch(() => {});
            if (live) setAgent(a);
        })();
        return () => { live = false; };
    }, [identity]);
    return useMemo(() => (agent ? (idl, canisterId) => Actor.createActor(idl, { agent, canisterId }) : null), [agent]);
}

export default function Convert() {
    const { theme } = useTheme();
    const c = theme.colors;
    const { identity, isAuthenticated, login } = useAuth();
    const me = isAuthenticated && identity ? identity.getPrincipal() : null;
    const makeActor = useMakeActor(isAuthenticated ? identity : null);
    const [params, setParams] = useSearchParams();

    // the ckERC20 token list, from the minter (anonymous query), so new tokens appear by themselves
    const anonActor = useMakeActor(null);
    const [ethInfo, setEthInfo] = useState(null);
    useEffect(() => { if (anonActor && isMainnet) ckethInfo(anonActor).then(setEthInfo).catch(() => {}); }, [anonActor]);
    const [decimals, setDecimals] = useState({});
    const allErc20s = useMemo(() => erc20AssetsFromInfo(ethInfo, decimals), [ethInfo, decimals]);
    const erc20s = useMemo(() => allErc20s.filter((a) => a.decimals != null), [allErc20s]);
    // decimals of tokens the minter added after this release
    useEffect(() => {
        if (!anonActor) return;
        for (const a of allErc20s) {
            if (a.decimals != null) continue;
            anonActor(ckLedgerIdl, a.ledger).icrc1_decimals().then((d) => setDecimals((x) => ({ ...x, [a.ledger]: Number(d) }))).catch(() => {});
        }
    }, [anonActor, allErc20s]);

    const assetParam = params.get('asset');
    const asset = useMemo(() => {
        const all = [CKBTC, CKETH, ...erc20s];
        return all.find((a) => a.ledger === assetParam || a.key.toLowerCase() === String(assetParam || '').toLowerCase()) || ckAssetForLedger(assetParam) || CKBTC;
    }, [assetParam, erc20s]);
    const tab = params.get('tab') === 'deposit' ? 'deposit' : 'withdraw';
    const set = useCallback((patch) => {
        const next = new URLSearchParams(params);
        for (const [k, v] of Object.entries(patch)) next.set(k, v);
        setParams(next, { replace: true });
    }, [params, setParams]);
    const family = asset.kind;

    const familyBtn = (kind, label, Icon, target) => (
        <button type="button" onClick={() => set({ asset: target.ledger })} aria-pressed={family === kind}
            style={{ flex: '1 1 0', minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 10px', borderRadius: 12, cursor: 'pointer', fontWeight: 700, fontSize: 14,
                border: `1px solid ${family === kind ? c.accent : c.border}`, background: family === kind ? `${c.accent}22` : c.cardBg, color: family === kind ? c.primaryText : c.secondaryText }}>
            <Icon /> {label}
        </button>
    );
    const tabBtn = (k, label, Icon) => (
        <button type="button" role="tab" aria-selected={tab === k} onClick={() => set({ tab: k })}
            style={{ flex: '1 1 0', padding: '10px 8px', border: 'none', borderBottom: `2px solid ${tab === k ? c.accent : 'transparent'}`, background: 'transparent', color: tab === k ? c.primaryText : c.mutedText, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 14 }}>
            <Icon size={12} /> {label}
        </button>
    );

    return (
        <>
            <Header />
            <style>{'@keyframes ckspin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }'}</style>
            <div style={{ maxWidth: 760, margin: '0 auto', padding: '1.5rem 16px 3rem', boxSizing: 'border-box' }}>
                <h1 style={{ margin: '0 0 6px', color: c.primaryText, fontSize: '1.8rem' }}>Convert</h1>
                <p style={{ margin: '0 0 18px', color: c.secondaryText, lineHeight: 1.6 }}>
                    Move Bitcoin and Ethereum assets in and out of the Internet Computer. ckBTC, ckETH and ckUSDC (and the other ck tokens) are backed 1:1 and minted or burned by DFINITY's chain-fusion minters, which Sneed Hub calls for you.
                </p>

                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    {familyBtn('btc', 'Bitcoin', FaBitcoin, CKBTC)}
                    {familyBtn('eth', 'Ether', FaEthereum, CKETH)}
                    {familyBtn('erc20', 'ERC-20', FaCoins, erc20s.find((a) => a.symbol === 'ckUSDC') || erc20s[0])}
                </div>
                {family === 'erc20' && (
                    <div style={{ marginBottom: 10 }}>
                        <label htmlFor="ck-token" style={{ fontSize: 13, color: c.secondaryText, display: 'block', marginBottom: 4 }}>Token</label>
                        <select id="ck-token" value={asset.ledger} onChange={(e) => set({ asset: e.target.value })}
                            style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1px solid ${c.border}`, background: c.secondaryBg, color: c.primaryText, fontSize: 15 }}>
                            {erc20s.map((a) => <option key={a.ledger} value={a.ledger} style={{ background: c.secondaryBg, color: c.primaryText }}>{a.symbol} ⇄ {a.native}</option>)}
                        </select>
                    </div>
                )}

                <div role="tablist" style={{ display: 'flex', borderBottom: `1px solid ${c.border}`, marginBottom: 14 }}>
                    {tabBtn('deposit', `Get ${asset.symbol}`, FaArrowDown)}
                    {tabBtn('withdraw', `Withdraw ${asset.native}`, FaArrowUp)}
                </div>

                {!isMainnet && <Notice tone="warning" style={{ marginBottom: 12 }}>The minters live on mainnet; on a local replica this page cannot reach them.</Notice>}
                {!isAuthenticated && (
                    <Notice style={{ marginBottom: 12 }}>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                            <span>Log in to convert to and from your Sneed Hub wallet.</span>
                            <Button onClick={() => login()}>Log in</Button>
                        </div>
                    </Notice>
                )}

                {makeActor && me && family === 'btc' && tab === 'deposit' && <BtcDeposit makeActor={makeActor} me={me} />}
                {makeActor && me && family === 'btc' && tab === 'withdraw' && <BtcWithdraw makeActor={makeActor} me={me} />}
                {makeActor && me && family !== 'btc' && tab === 'deposit' && <EthDeposit makeActor={makeActor} me={me} asset={asset} />}
                {makeActor && me && family !== 'btc' && tab === 'withdraw' && <EthWithdraw makeActor={makeActor} me={me} asset={asset} />}

                <p style={{ fontSize: 12, color: c.mutedText, marginTop: 20, lineHeight: 1.6 }}>
                    Conversions use your main wallet account. Every step is a public transaction on the ckBTC/ckETH ledgers and on Bitcoin or Ethereum, linked to your principal. Approvals made here expire after an hour and show in your <Link to="/wallet" style={{ color: c.accent }}>wallet</Link>.
                    {' '}Minters: ckBTC {CKBTC.minter}, ckETH {CKETH.minter}.
                </p>
            </div>
        </>
    );
}
