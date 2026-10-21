// The user's own browser Ethereum wallet (MetaMask, Rabby, Coinbase Wallet, ... through EIP-1193),
// used only to deposit ETH / ERC-20 into the ckETH minter's helper contract. Sneed Hub never sees
// or holds an Ethereum key: every transaction is shown and signed in the user's wallet.
import { encodeDepositEth, encodeDepositErc20, encodeErc20Approve, encodeErc20Allowance, encodeErc20BalanceOf, decodeUint, parseEthAddress } from './ckAddress';

export const MAINNET_CHAIN_ID = '0x1';
export const etherscanTx = (hash) => `https://etherscan.io/tx/${hash}`;
export const etherscanAddress = (a) => `https://etherscan.io/address/${a}`;

/// Wallets announced through EIP-6963 (several extensions side by side), plus window.ethereum.
/// Resolves after `waitMs` with [{ id, name, icon, provider }].
export function discoverEthWallets(waitMs = 400) {
    return new Promise((resolve) => {
        const found = new Map();
        const w = typeof window !== 'undefined' ? window : null;
        if (!w) { resolve([]); return; }
        const onAnnounce = (e) => {
            const d = e?.detail;
            if (d?.provider && d?.info?.uuid) found.set(d.info.uuid, { id: d.info.uuid, name: d.info.name || 'Wallet', icon: d.info.icon || null, provider: d.provider });
        };
        w.addEventListener('eip6963:announceProvider', onAnnounce);
        try { w.dispatchEvent(new Event('eip6963:requestProvider')); } catch { /* old browser */ }
        setTimeout(() => {
            w.removeEventListener('eip6963:announceProvider', onAnnounce);
            const list = [...found.values()];
            if (!list.length && w.ethereum) list.push({ id: 'injected', name: w.ethereum.isMetaMask ? 'MetaMask' : 'Browser wallet', icon: null, provider: w.ethereum });
            resolve(list);
        }, waitMs);
    });
}

const hexOf = (n) => `0x${BigInt(n).toString(16)}`;

export async function connectWallet(provider) {
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    if (!accounts?.length) throw new Error('The wallet shared no account.');
    const chainId = await provider.request({ method: 'eth_chainId' });
    return { account: parseEthAddress(accounts[0]).address || accounts[0], chainId };
}

/// Ask the wallet to switch to Ethereum mainnet (the ckETH minter only watches mainnet).
export async function ensureMainnet(provider) {
    const chainId = await provider.request({ method: 'eth_chainId' });
    if (String(chainId).toLowerCase() === MAINNET_CHAIN_ID) return;
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: MAINNET_CHAIN_ID }] });
    const after = await provider.request({ method: 'eth_chainId' });
    if (String(after).toLowerCase() !== MAINNET_CHAIN_ID) throw new Error('Switch your wallet to Ethereum mainnet first.');
}

const call = (provider, to, data) => provider.request({ method: 'eth_call', params: [{ to, data }, 'latest'] });

export const ethBalance = async (provider, account) => BigInt(await provider.request({ method: 'eth_getBalance', params: [account, 'latest'] }));
export const erc20Balance = async (provider, token, account) => decodeUint(await call(provider, token, encodeErc20BalanceOf(account)));
export const erc20Allowance = async (provider, token, owner, spender) => decodeUint(await call(provider, token, encodeErc20Allowance(owner, spender)));

/// Poll for a receipt; resolves with it (status '0x1' ok) or throws when the transaction reverted.
export async function waitForReceipt(provider, hash, { intervalMs = 4000, timeoutMs = 15 * 60 * 1000 } = {}) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
        const r = await provider.request({ method: 'eth_getTransactionReceipt', params: [hash] });
        if (r) {
            if (r.status === '0x0') throw new Error('The transaction failed on Ethereum (reverted).');
            return r;
        }
        await new Promise((res) => setTimeout(res, intervalMs));
    }
    throw new Error('Still not mined; check the transaction on Etherscan.');
}

const send = (provider, tx) => provider.request({ method: 'eth_sendTransaction', params: [tx] });

/// depositEth(principal, subaccount) on the helper contract with `amountWei` attached. Returns the tx hash.
export async function depositEthViaWallet(provider, { from, helper, principal, subaccount = null, amountWei }) {
    await ensureMainnet(provider);
    return send(provider, { from, to: helper, value: hexOf(amountWei), data: encodeDepositEth(principal, subaccount) });
}

/**
 * ERC-20 deposit: approve the helper for `amount` if the allowance is short (resetting a non-zero
 * allowance to 0 first, which tokens such as USDT require), then depositErc20. `onStep(step, hash)`
 * reports 'approve-reset' | 'approve' | 'deposit'. Returns the deposit tx hash.
 */
export async function depositErc20ViaWallet(provider, { from, helper, token, amount, principal, subaccount = null, onStep = () => {} }) {
    await ensureMainnet(provider);
    const allowance = await erc20Allowance(provider, token, from, helper);
    if (allowance < BigInt(amount)) {
        if (allowance > 0n) {
            const h0 = await send(provider, { from, to: token, data: encodeErc20Approve(helper, 0n) });
            onStep('approve-reset', h0);
            await waitForReceipt(provider, h0);
        }
        const h1 = await send(provider, { from, to: token, data: encodeErc20Approve(helper, amount) });
        onStep('approve', h1);
        await waitForReceipt(provider, h1);
    }
    const h = await send(provider, { from, to: helper, data: encodeDepositErc20(token, amount, principal, subaccount) });
    onStep('deposit', h);
    return h;
}
