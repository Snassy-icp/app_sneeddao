// ETH <-> ckETH and ERC-20 <-> ckERC20 on the /convert page.
// Withdraw: approve the ckETH minter (ckETH for the amount, or ckETH for gas plus the ckERC20 token),
// then withdraw_eth / withdraw_erc20, and follow it with withdrawal_status.
// Deposit: (1) the user's browser Ethereum wallet calls the minter's helper contract with the
// user's principal as bytes32; (2) the minter's personal deposit address (deposit_eth /
// deposit_erc20); (3) manual instructions for the helper contract. Sneed Hub holds no Ethereum key.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FaSync, FaExternalLinkAlt, FaWallet } from 'react-icons/fa';
import ConfirmDialog from '../ConfirmDialog';
import { useDenomination } from '../../contexts/DenominationContext';
import { loadPrice, priceOf } from '../../utils/revenueData';
import { useStoreVersion } from '../../utils/revenueStore';
import { parseEthAddress, principalToBytes32, subaccountToBytes32, encodeDepositEth } from '../../utils/ckAddress';
import {
    CKETH, ckethInfo, ckethGasPrice, ckethMinter, ckethWithdraw, ckerc20Withdraw, ckethWithdrawals, ckethDepositAddress,
    ledgerInfo, planEthWithdrawal, planErc20Withdrawal, parseUnits, formatUnits, ethStatusText, DEPOSITS_UNAVAILABLE,
} from '../../utils/ckMinters';
import { discoverEthWallets, connectWallet, ethBalance, erc20Balance, depositEthViaWallet, depositErc20ViaWallet, etherscanTx, etherscanAddress } from '../../utils/ethWallet';
import { Card, Label, Button, Notice, Advanced, CopyValue, QrCode, Pill, Row, Steps, inputStyle, useC } from './ConvertUi';

const DASHBOARD = `https://${CKETH.minter}.raw.icp0.io/dashboard`;
const fmt = (v, d, max = 6) => formatUnits(v ?? 0n, d, max);

function useUsd(ledger) {
    useStoreVersion();
    useEffect(() => { loadPrice(ledger).catch(() => {}); }, [ledger]);
    return priceOf(ledger);
}

export function useCkethInfo(makeActor) {
    const [info, setInfo] = useState(null);
    const [error, setError] = useState('');
    useEffect(() => {
        let live = true;
        ckethInfo(makeActor).then((i) => live && setInfo(i)).catch((e) => live && setError(e.message));
        return () => { live = false; };
    }, [makeActor]);
    return { info, error };
}

// ---------------- Withdraw ----------------

export function EthWithdraw({ makeActor, me, asset, onDone }) {
    const c = useC();
    const isEth = asset.kind === 'eth';
    const { formatValue } = useDenomination();
    const usdPrice = useUsd(asset.ledger);
    const ethUsd = useUsd(CKETH.ledger);
    const { info } = useCkethInfo(makeActor);
    const [tok, setTok] = useState(null); // { balance, fee } of the asset
    const [eth, setEth] = useState(null); // ckETH, for gas on ERC-20 withdrawals
    const [price, setPrice] = useState(null);
    const [amountText, setAmountText] = useState('');
    const [recipient, setRecipient] = useState('');
    const [blocked, setBlocked] = useState(false);
    const [ack, setAck] = useState(false);
    const [confirm, setConfirm] = useState(false);
    const [step, setStep] = useState(null);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    const [history, setHistory] = useState(null);

    useEffect(() => { setAmountText(''); setResult(null); setError(''); setTok(null); }, [asset.ledger]);

    const loadBalances = useCallback(() => {
        if (!me) return;
        ledgerInfo(makeActor, asset.ledger, me).then(setTok).catch(() => {});
        if (!isEth) ledgerInfo(makeActor, CKETH.ledger, me).then(setEth).catch(() => {});
    }, [makeActor, me, asset.ledger, isEth]);
    useEffect(() => { loadBalances(); }, [loadBalances]);

    const loadPrice_ = useCallback(() => { ckethGasPrice(makeActor, isEth ? null : asset.ledger).then(setPrice).catch(() => {}); }, [makeActor, isEth, asset.ledger]);
    useEffect(() => { loadPrice_(); const t = setInterval(loadPrice_, 60_000); return () => clearInterval(t); }, [loadPrice_]);

    const loadHistory = useCallback(() => {
        if (!me) return;
        ckethWithdrawals(makeActor, me).then(setHistory).catch(() => {});
    }, [makeActor, me]);
    useEffect(() => { loadHistory(); }, [loadHistory]);
    const anyPending = history?.some((h) => ethStatusText(h.status).tone === 'pending');
    useEffect(() => {
        if (!anyPending) return undefined;
        const t = setInterval(loadHistory, 30_000);
        return () => clearInterval(t);
    }, [anyPending, loadHistory]);

    const addr = useMemo(() => (recipient.trim() ? parseEthAddress(recipient) : null), [recipient]);
    useEffect(() => {
        setBlocked(false);
        if (!addr?.ok) return;
        ckethMinter(makeActor).is_address_blocked(addr.address).then(setBlocked).catch(() => {});
    }, [makeActor, addr?.ok, addr?.address]);

    const amount = parseUnits(amountText, asset.decimals);
    const minAmount = info?.minimum_withdrawal_amount?.[0];
    const plan = isEth
        ? planEthWithdrawal({ amount, balance: tok?.balance, ledgerFee: tok?.fee, minAmount, price })
        : planErc20Withdrawal({ amount, tokenBalance: tok?.balance, tokenLedgerFee: tok?.fee, ckethBalance: eth?.balance, ckethLedgerFee: eth?.fee, price, symbol: asset.symbol, decimals: asset.decimals });
    const usd = (v, d = asset.decimals, p = usdPrice) => (p != null && v != null ? formatValue((Number(v) / 10 ** d) * p) : null);
    const canSubmit = !!me && plan.ok && addr?.ok && !blocked && ack && !step && !!price;

    const run = async () => {
        setConfirm(false); setError(''); setResult(null);
        try {
            const r = isEth
                ? await ckethWithdraw(makeActor, { recipient: addr.address, amount, ledgerFee: tok?.fee, onStep: setStep })
                : await ckerc20Withdraw(makeActor, { recipient: addr.address, amount, tokenLedgerId: asset.ledger, gasApprove: plan.gasApprove, ckethLedgerFee: eth?.fee, tokenLedgerFee: tok?.fee, onStep: setStep });
            setResult(r); setAmountText(''); setAck(false);
            loadBalances(); loadHistory(); onDone?.();
        } catch (e) { setError(e.message); }
        finally { setStep(null); }
    };

    const steps = isEth
        ? [{ key: 'approve', label: 'Approve the minter on the ckETH ledger' }, { key: 'withdraw', label: 'Ask the minter to send ETH' }]
        : [{ key: 'approve-gas', label: 'Approve ckETH for the Ethereum gas' }, { key: 'approve-token', label: `Approve the minter on the ${asset.symbol} ledger` }, { key: 'withdraw', label: `Ask the minter to send ${asset.native}` }];

    return (
        <Card>
            <h3 style={{ margin: '0 0 4px', color: c.primaryText }}>{asset.symbol} → {asset.native} on Ethereum</h3>
            <p style={{ margin: '0 0 14px', color: c.secondaryText, fontSize: 14, lineHeight: 1.55 }}>
                Burn {asset.symbol} and receive {asset.native} at an Ethereum address. {isEth ? 'The Ethereum fee comes out of the amount.' : 'The Ethereum gas is paid in ckETH, so you need a little ckETH too.'} It usually arrives within 20 minutes.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                    <Label hint={tok ? `Balance ${fmt(tok.balance, asset.decimals)} ${asset.symbol}` : null}>Amount ({asset.symbol})</Label>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <input inputMode="decimal" placeholder="0.0" value={amountText} onChange={(e) => setAmountText(e.target.value)} style={inputStyle(c, amountText !== '' && amount == null)} aria-label={`Amount in ${asset.symbol}`} />
                        <Button variant="ghost" onClick={() => plan.max != null && setAmountText(formatUnits(plan.max, asset.decimals).replace(/,/g, ''))} disabled={!plan.max}>Max</Button>
                    </div>
                    {amount != null && usd(amount) && <div style={{ fontSize: 12, color: c.mutedText, marginTop: 4 }}>≈ {usd(amount)}</div>}
                    {!isEth && eth && <div style={{ fontSize: 12, color: c.mutedText, marginTop: 4 }}>ckETH for gas: {fmt(eth.balance, 18)} ckETH</div>}
                </div>
                <div>
                    <Label hint={addr?.ok && addr.checksummed ? 'Checksum OK' : null}>Ethereum address</Label>
                    <input placeholder="0x…" value={recipient} onChange={(e) => setRecipient(e.target.value)} spellCheck={false} autoCapitalize="none" autoCorrect="off" style={{ ...inputStyle(c, addr && (!addr.ok || blocked)), fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 14 }} aria-label="Ethereum address" />
                    {addr && !addr.ok && <div style={{ color: c.error, fontSize: 12, marginTop: 4 }}>{addr.error}</div>}
                    {blocked && <div style={{ color: c.error, fontSize: 12, marginTop: 4 }}>The minter blocks this address; it will not send there.</div>}
                </div>
                {amount != null && amount > 0n && (
                    <div style={{ background: c.secondaryBg, border: `1px solid ${c.border}`, borderRadius: 12, padding: '8px 12px' }}>
                        <Row k="You burn" v={`${fmt(amount, asset.decimals)} ${asset.symbol}`} sub={usd(amount)} />
                        {isEth ? <>
                            <Row k="Ethereum fee (at most)" v={plan.networkFee != null ? `${fmt(plan.networkFee, 18)} ETH` : '…'} sub={usd(plan.networkFee, 18, ethUsd)} />
                            <Row k="You receive at least" v={plan.receive != null ? `${fmt(plan.receive, 18)} ETH` : '…'} sub={usd(plan.receive)} strong />
                        </> : <>
                            <Row k="Gas, paid in ckETH (at most)" v={plan.gasApprove != null ? `${fmt(plan.gasApprove, 18)} ckETH` : '…'} sub={usd(plan.gasApprove, 18, ethUsd)} />
                            <Row k="You receive" v={`${fmt(amount, asset.decimals)} ${asset.native}`} sub={usd(amount)} strong />
                        </>}
                    </div>
                )}
                {plan.errors.length > 0 && amountText !== '' && plan.errors.map((e) => <div key={e} style={{ color: c.error, fontSize: 13 }}>{e}</div>)}
                <Notice tone="warning">
                    Ethereum transactions cannot be reversed. Use an address on <b>Ethereum mainnet</b> that you control{isEth ? ', preferably a normal wallet: the minter sends ETH with a 21,000 gas limit, so sending to a smart-contract address will likely fail' : ''}. Never use an exchange deposit address that needs a memo or another network.
                    {isEth && minAmount != null && <> The minimum is {fmt(minAmount, 18)} ETH.</>}
                </Notice>
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14, color: c.primaryText, cursor: 'pointer' }}>
                    <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ marginTop: 3 }} />
                    I checked the address, and I understand this cannot be undone.
                </label>
                <Button onClick={() => setConfirm(true)} disabled={!canSubmit}>Withdraw to Ethereum</Button>
                {step && <Steps current={step} steps={steps} />}
                {error && <Notice tone="error">{error}</Notice>}
                {result && <Notice tone="success">Withdrawal requested (id #{String(result.blockIndex ?? result.ckethBlock)}). It shows below and arrives once the Ethereum transaction is finalized.</Notice>}
            </div>
            <Advanced title="Advanced: details">
                {price && <Row k="Gas limit / max fee per gas" v={`${String(price.gas_limit)} / ${fmt(price.max_fee_per_gas, 9, 3)} gwei`} />}
                {price && <Row k="Max transaction fee" v={`${fmt(price.max_transaction_fee, 18, 8)} ETH`} />}
                {tok && <Row k={`${asset.symbol} ledger fee (approval)`} v={`${fmt(tok.fee, asset.decimals, 8)} ${asset.symbol}`} />}
                {!isEth && eth && <Row k="ckETH ledger fee (approval)" v={`${fmt(eth.fee, 18, 8)} ckETH`} />}
                <div style={{ fontSize: 12, color: c.mutedText, lineHeight: 1.55 }}>
                    {isEth
                        ? `icrc2_approve on the ckETH ledger (${CKETH.ledger}) lets the minter (${CKETH.minter}) take exactly this amount within an hour; withdraw_eth burns it and the minter signs an Ethereum transaction for the amount minus the fee.`
                        : `Two approvals: ckETH (${CKETH.ledger}) for the gas, with a 20% margin in case the gas price rises (any unused allowance expires in an hour), and ${asset.symbol} (${asset.ledger}) for the amount. withdraw_erc20 burns both and the minter sends ${asset.native} (${asset.erc20}).`}
                </div>
            </Advanced>
            <EthWithdrawalHistory history={history} onRefresh={loadHistory} />
            <ConfirmDialog isOpen={confirm} onClose={() => setConfirm(false)} onConfirm={run} type="warning" title={`Withdraw to Ethereum?`}
                confirmText="Withdraw" confirmVariant="primary"
                message={<div style={{ textAlign: 'left', lineHeight: 1.6 }}>
                    <div>Burn <b>{fmt(amount, asset.decimals)} {asset.symbol}</b>{!isEth && plan.gasApprove != null ? <> plus up to <b>{fmt(plan.gasApprove, 18)} ckETH</b> for gas</> : null} and send {asset.native} to</div>
                    <code style={{ wordBreak: 'break-all', display: 'block', margin: '6px 0' }}>{addr?.address}</code>
                    <div>This cannot be reversed.</div>
                </div>} />
        </Card>
    );
}

function EthWithdrawalHistory({ history, onRefresh }) {
    const c = useC();
    if (!history) return null;
    return (
        <div style={{ marginTop: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: c.secondaryText }}>Your Ethereum withdrawals</span>
                <Button variant="ghost" onClick={onRefresh} style={{ padding: '4px 10px', fontSize: 12 }}><FaSync size={10} /> Refresh</Button>
            </div>
            {history.length === 0 && <div style={{ fontSize: 13, color: c.mutedText }}>None yet.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {history.slice(0, 20).map((h) => {
                    const s = ethStatusText(h.status);
                    return (
                        <div key={String(h.withdrawal_id)} style={{ border: `1px solid ${c.border}`, borderRadius: 10, padding: '8px 10px', fontSize: 13, color: c.primaryText }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                <span>{h.token_symbol} #{String(h.withdrawal_id)} → <span style={{ wordBreak: 'break-all' }}>{h.recipient_address.slice(0, 10)}…</span></span>
                                <Pill tone={s.tone}>{s.label}</Pill>
                            </div>
                            <div style={{ color: c.mutedText, fontSize: 12, marginTop: 4 }}>{s.detail}</div>
                            {s.tx && <a href={etherscanTx(s.tx)} target="_blank" rel="noreferrer" style={{ color: c.accent, fontSize: 12, wordBreak: 'break-all' }}>{s.tx} <FaExternalLinkAlt size={9} /></a>}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ---------------- Deposit ----------------

export function EthDeposit({ makeActor, me, asset }) {
    const c = useC();
    const isEth = asset.kind === 'eth';
    const { info, error: infoError } = useCkethInfo(makeActor);
    const helper = info?.deposit_with_subaccount_helper_contract_address?.[0] || null;
    const [method, setMethod] = useState('wallet');
    return (
        <Card>
            <h3 style={{ margin: '0 0 4px', color: c.primaryText }}>{asset.native} on Ethereum → {asset.symbol}</h3>
            <p style={{ margin: '0 0 14px', color: c.secondaryText, fontSize: 14, lineHeight: 1.55 }}>
                Send {asset.native} from Ethereum mainnet and the ckETH minter credits the same amount of {asset.symbol} to your Sneed Hub wallet once Ethereum has finalized the block (about 20 minutes).
            </p>
            {infoError && <Notice tone="error">Could not reach the ckETH minter: {infoError}</Notice>}
            <div role="tablist" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                {[['wallet', 'Browser wallet'], ['address', 'Deposit address']].map(([k, label]) => (
                    <button key={k} role="tab" aria-selected={method === k} type="button" onClick={() => setMethod(k)}
                        style={{ padding: '6px 12px', borderRadius: 999, border: `1px solid ${method === k ? c.accent : c.border}`, background: method === k ? `${c.accent}22` : 'transparent', color: method === k ? c.primaryText : c.secondaryText, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>{label}</button>
                ))}
            </div>
            {method === 'wallet' && <WalletDeposit me={me} asset={asset} helper={helper} />}
            {method === 'address' && <AddressDeposit makeActor={makeActor} me={me} asset={asset} info={info} />}
            <Advanced title="Advanced: deposit by hand through the helper contract">
                {helper ? <ManualHelper me={me} asset={asset} helper={helper} isEth={isEth} /> : <div style={{ fontSize: 13, color: c.mutedText }}>Loading the helper contract from the minter…</div>}
            </Advanced>
        </Card>
    );
}

function WalletDeposit({ me, asset, helper }) {
    const c = useC();
    const isEth = asset.kind === 'eth';
    const [wallets, setWallets] = useState(null);
    const [wallet, setWallet] = useState(null); // { provider, name, account }
    const [bal, setBal] = useState(null);
    const [amountText, setAmountText] = useState('');
    const [busy, setBusy] = useState(null);
    const [hashes, setHashes] = useState([]);
    const [error, setError] = useState('');
    const [confirm, setConfirm] = useState(false);

    useEffect(() => { discoverEthWallets().then(setWallets); }, []);
    useEffect(() => { setBal(null); setAmountText(''); setHashes([]); setError(''); }, [asset.ledger]);

    const refreshBal = useCallback(async (w = wallet) => {
        if (!w) return;
        try { setBal(isEth ? await ethBalance(w.provider, w.account) : await erc20Balance(w.provider, asset.erc20, w.account)); } catch { setBal(null); }
    }, [wallet, isEth, asset.erc20]);
    useEffect(() => { refreshBal(); }, [refreshBal]);

    const connect = async (w) => {
        setError('');
        try {
            const { account, chainId } = await connectWallet(w.provider);
            const next = { ...w, account, chainId };
            setWallet(next);
        } catch (e) { setError(e?.message || String(e)); }
    };

    const amount = parseUnits(amountText, asset.decimals);
    const tooMuch = amount != null && bal != null && amount > bal;
    const canSend = !!me && !!wallet && !!helper && amount != null && amount > 0n && !tooMuch && !busy;

    const run = async () => {
        setConfirm(false); setError(''); setHashes([]);
        try {
            if (isEth) {
                setBusy('deposit');
                const h = await depositEthViaWallet(wallet.provider, { from: wallet.account, helper, principal: me, amountWei: amount });
                setHashes([{ step: 'deposit', hash: h }]);
            } else {
                await depositErc20ViaWallet(wallet.provider, {
                    from: wallet.account, helper, token: asset.erc20, amount, principal: me,
                    onStep: (step, hash) => { setBusy(step); setHashes((x) => [...x, { step, hash }]); },
                });
            }
            setAmountText('');
            refreshBal();
        } catch (e) { setError(e?.code === 4001 ? 'You rejected the request in your wallet.' : (e?.message || String(e))); }
        finally { setBusy(null); }
    };

    if (wallets == null) return <div style={{ fontSize: 14, color: c.mutedText }}>Looking for an Ethereum wallet in this browser…</div>;
    if (!wallets.length) {
        return (
            <Notice>
                No Ethereum wallet found in this browser. Install one (for example MetaMask or Rabby) and reload, use the <b>Deposit address</b> tab to send from anywhere, or see <b>Advanced</b> for doing it by hand.
            </Notice>
        );
    }
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {!wallet && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {wallets.map((w) => (
                        <Button key={w.id} variant="ghost" onClick={() => connect(w)}>
                            {w.icon ? <img src={w.icon} alt="" style={{ width: 18, height: 18 }} /> : <FaWallet />} Connect {w.name}
                        </Button>
                    ))}
                </div>
            )}
            {wallet && (
                <>
                    <Row k={`From (${wallet.name})`} v={<a href={etherscanAddress(wallet.account)} target="_blank" rel="noreferrer" style={{ color: c.accent, wordBreak: 'break-all' }}>{wallet.account.slice(0, 8)}…{wallet.account.slice(-6)}</a>}
                        sub={bal != null ? `Balance ${fmt(bal, asset.decimals)} ${asset.native}` : null} />
                    {String(wallet.chainId).toLowerCase() !== '0x1' && <Notice tone="warning">Your wallet is not on Ethereum mainnet. It will be asked to switch before sending.</Notice>}
                    <div>
                        <Label>Amount ({asset.native})</Label>
                        <input inputMode="decimal" placeholder="0.0" value={amountText} onChange={(e) => setAmountText(e.target.value)} style={inputStyle(c, (amountText !== '' && amount == null) || tooMuch)} aria-label={`Amount in ${asset.native}`} />
                        {tooMuch && <div style={{ color: c.error, fontSize: 12, marginTop: 4 }}>More than the wallet holds{isEth ? ' (keep some ETH for gas)' : ''}.</div>}
                    </div>
                    <Notice>
                        Your wallet will show {isEth ? 'one transaction' : 'up to three transactions (reset and set the allowance if needed, then deposit)'} to the ckETH minter's helper contract <code style={{ wordBreak: 'break-all' }}>{helper}</code>, which records your principal so the minter knows whom to credit. You pay the Ethereum gas from your wallet.
                    </Notice>
                    <Button onClick={() => setConfirm(true)} disabled={!canSend}>Deposit {asset.native}</Button>
                    {busy && <Steps current={busy} steps={isEth ? [{ key: 'deposit', label: 'Deposit through the helper contract' }] : [{ key: 'approve-reset', label: 'Reset the allowance (if any)' }, { key: 'approve', label: 'Allow the helper contract to move the tokens' }, { key: 'deposit', label: 'Deposit through the helper contract' }]} />}
                </>
            )}
            {error && <Notice tone="error">{error}</Notice>}
            {hashes.length > 0 && (
                <Notice tone="success">
                    {hashes.map((h) => <div key={h.hash}>{h.step === 'deposit' ? 'Deposit sent' : 'Approval sent'}: <a href={etherscanTx(h.hash)} target="_blank" rel="noreferrer" style={{ color: c.accent, wordBreak: 'break-all' }}>{h.hash}</a></div>)}
                    {hashes.some((h) => h.step === 'deposit') && <div style={{ marginTop: 4 }}>{asset.symbol} appears in your wallet once Ethereum has finalized the block (about 20 minutes).</div>}
                </Notice>
            )}
            <ConfirmDialog isOpen={confirm} onClose={() => setConfirm(false)} onConfirm={run} type="info" title={`Deposit ${asset.native}?`} confirmText="Continue in wallet"
                message={<div style={{ textAlign: 'left', lineHeight: 1.6 }}>
                    Send <b>{fmt(amount, asset.decimals)} {asset.native}</b> from {wallet?.account?.slice(0, 10)}… to the helper contract, crediting <b>{asset.symbol}</b> to your principal <code style={{ wordBreak: 'break-all' }}>{me?.toText()}</code>.
                </div>} />
        </div>
    );
}

function AddressDeposit({ makeActor, me, asset, info }) {
    const c = useC();
    const isEth = asset.kind === 'eth';
    const [dep, setDep] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    useEffect(() => { setDep(null); setError(''); }, [asset.ledger]);
    const minFromInfo = isEth
        ? info?.minimum_eth_deposit_amount?.[0]
        : info?.minimum_deposit_amounts?.[0]?.find((m) => m.erc20_contract_address.toLowerCase() === asset.erc20.toLowerCase())?.minimum_deposit_amount;
    const get = async () => {
        setBusy(true); setError('');
        try { setDep(await ckethDepositAddress(makeActor, { erc20: isEth ? null : asset.erc20 })); }
        catch (e) { setError(e.message); }
        finally { setBusy(false); }
    };
    const unavailable = dep && BigInt(dep.minimum) === DEPOSITS_UNAVAILABLE;
    const st = dep?.status;
    const scanning = st && 'Scanning' in st ? st.Scanning : null;
    const until = scanning ? new Date(Number(BigInt(scanning.valid_until) / 1_000_000n)) : null;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ margin: 0, fontSize: 14, color: c.secondaryText, lineHeight: 1.55 }}>
                The minter can give you a personal Ethereum address. Anything you send there (from any wallet or exchange) is swept and credited as {asset.symbol}, as long as it arrives in time and reaches the minimum.
            </p>
            {!dep && <Button onClick={get} disabled={!me || busy}>{busy ? 'Asking the minter…' : 'Get my deposit address'}</Button>}
            {minFromInfo != null && !dep && <div style={{ fontSize: 12, color: c.mutedText }}>Minimum: {fmt(minFromInfo, asset.decimals)} {asset.native} in total.</div>}
            {error && <Notice tone="error">{error}</Notice>}
            {unavailable && <Notice tone="warning">The minter cannot detect {asset.native} deposits at an address right now. Use your browser wallet instead.</Notice>}
            {dep && !unavailable && (
                <>
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                        <QrCode text={dep.address} />
                        <div style={{ flex: '1 1 240px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <Label hint="Ethereum mainnet only">Your deposit address</Label>
                            <CopyValue value={dep.address} label="deposit address" />
                            <Row k="Send at least" v={`${fmt(dep.minimum, asset.decimals)} ${asset.native}`} />
                            {until && <Row k="Watched until" v={until.toLocaleString()} />}
                            {st && 'AwaitingSweep' in st && <Notice tone="success">Deposit of {fmt(st.AwaitingSweep.scanned_balance, asset.decimals)} {asset.native} detected; the minter is sweeping it.</Notice>}
                        </div>
                    </div>
                    <Notice tone="warning">
                        Only <b>{asset.native} on Ethereum mainnet</b>. Below the minimum (all transfers together) nothing is credited. Send before the time above; afterwards press the button again so the minter watches it again. The minter takes a registration fee from the deposit.
                    </Notice>
                    <Button variant="ghost" onClick={get} disabled={busy}><FaSync size={11} /> Check status</Button>
                </>
            )}
        </div>
    );
}

function ManualHelper({ me, asset, helper, isEth }) {
    const c = useC();
    if (!me) return <div style={{ fontSize: 13, color: c.mutedText }}>Log in to see your encoded principal.</div>;
    const p32 = principalToBytes32(me);
    const s32 = subaccountToBytes32(null);
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13, color: c.primaryText }}>
            <Notice tone="warning">
                For people who know Ethereum. Call the contract from a wallet you control on Ethereum mainnet. Do not send from an exchange (it cannot call a contract), and never send {asset.native} straight to the minter's own address: it would not know whom to credit. Check the helper address on the <a href={DASHBOARD} target="_blank" rel="noreferrer" style={{ color: c.accent }}>minter dashboard</a> first; it can change.
            </Notice>
            <div><Label>Helper contract</Label><CopyValue value={helper} label="helper contract" /></div>
            <div><Label>Function</Label><CopyValue mono value={isEth ? 'depositEth(bytes32 principal, bytes32 subaccount)  (payable: attach the ETH)' : 'depositErc20(address erc20Address, uint256 amount, bytes32 principal, bytes32 subaccount)'} /></div>
            {!isEth && <div><Label hint="approve(helper, amount) on the token first">Token contract</Label><CopyValue value={asset.erc20} label="token contract" /></div>}
            <div><Label hint="length byte, principal bytes, zero padding">principal (bytes32)</Label><CopyValue value={p32} label="principal bytes32" /></div>
            <div><Label hint="your main account">subaccount (bytes32)</Label><CopyValue value={s32} label="subaccount bytes32" /></div>
            {isEth && <div><Label hint="for wallets that take raw data; set the value to the ETH amount">Call data</Label><CopyValue value={encodeDepositEth(me)} label="call data" /></div>}
        </div>
    );
}
