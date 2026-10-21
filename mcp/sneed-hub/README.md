# Sneed Hub MCP server

An [MCP](https://modelcontextprotocol.io) server for **Sneed Hub** (https://app.sneeddao.com), the web
app of Sneed DAO on the Internet Computer. Connect it to your AI agent (Claude Code, Claude Desktop or
any MCP client) and use every Sneed service from a chat:

- "Put my old Diamond Club NFT up on Sneedex for 5 ICP."
- "Which proposals can my neurons still vote on? Vote yes on 448."
- "Reply to the newest thread about proposal 416 and tip the author 10 SNEED."
- "Lock 1,000 SNEED for 30 days." / "Claim my rewards."
- "What's in my Sneed SMS inbox?" / "Which tokens does principal xxxxx-… hold?"

Reads work out of the box. Writes are **off** until you turn them on, and every write is previewed and
needs your explicit OK.

## Install

Requires Node.js 18 or newer.

```bash
cd /path/to/app_sneeddao/mcp/sneed-hub
npm install
```

### Claude Code

Read-only:

```bash
claude mcp add sneed-hub -- node /path/to/app_sneeddao/mcp/sneed-hub/src/index.js
```

With writes:

```bash
claude mcp add sneed-hub -e SNEED_MCP_WRITES=1 -- node /path/to/app_sneeddao/mcp/sneed-hub/src/index.js
```

### Claude Desktop

`claude_desktop_config.json` (Settings, Developer, Edit Config):

```json
{
  "mcpServers": {
    "sneed-hub": {
      "command": "node",
      "args": ["/path/to/app_sneeddao/mcp/sneed-hub/src/index.js"],
      "env": { "SNEED_MCP_WRITES": "1" }
    }
  }
}
```

## Who signs: "act as me" or the agent's own identity

### Act as me (recommended for people)

You want the agent to act on **your** things (your NFTs, your neurons, your forum account):

1. Ask the agent to connect (tool `connect_as_me`). It gives you a Sneed Hub link
   (`/connect-agent?key=…&name=…&callback=http://127.0.0.1:…`). The link only works on the computer
   the agent runs on.
2. Open it in the browser where you use Sneed Hub and log in. Check that the code on the page matches
   the one the agent shows.
3. Choose what the agent may touch. The default is the Sneed canisters only (Sneedex, Sneed Lock, forum,
   SMS, notifications, names, rewards, Sneedapp, Premium, Monitor). You can add your ICP, your SNEED,
   Sneed DAO governance (to vote), NFT collections or token ledgers you name, or "everything".
4. Choose for how long: 1 hour, 24 hours (default) or 7 days. It never outlasts your own login.
5. Approve. Sneed Hub signs a delegation from your login to a key the agent generated for this session,
   limited to those canisters (the IC itself refuses calls to any other canister) and that time, and hands
   it to the agent over 127.0.0.1. If the browser can't reach the agent, the page offers to send it by
   opening the agent's page, or shows a code to paste (`connect_as_me` with `code`).

The agent then signs as **your principal**. No key, seed phrase or passkey leaves your browser, and the
delegation is useless without the session key that stays on your computer
(`~/.config/sneed-hub-mcp/delegation.json`, mode 600). A delegation **cannot be revoked on-chain**: it
ends at its expiry. `disconnect` deletes it, along with the only copy of the session key. Short expiries
are the safe default.

### The agent's own identity (for autonomous agents)

When no delegation is connected, the agent signs with its own principal, chosen in this order:

1. `SNEED_MCP_DFX_IDENTITY=<name>`: a **plaintext** dfx identity
   (`~/.config/dfx/identity/<name>/identity.pem`, Ed25519 or secp256k1). Encrypted identities are refused
   with a message. The server never asks for passwords.
2. `SNEED_MCP_IDENTITY_PEM=/path/key.pem`: any Ed25519 (PKCS#8) or secp256k1 (EC) PEM.
3. Otherwise a fresh Ed25519 key is generated on first use at `~/.config/sneed-hub-mcp/identity.json`
   (mode 600; override with `SNEED_MCP_IDENTITY`).

No tool ever prints a private key. `whoami` shows the mode, the principal, its ICP and SNEED
balances, the caps, and how to:

- **Fund it:** send a small amount of ICP or SNEED to the principal.
- **Let it vote without holding your tokens:** on Sneed Hub open your SNEED neuron (/neurons) and
  "Add hotkey" with the agent's principal. A hotkey can vote and submit proposals, not disburse.

## Safety model

- **Writes off by default.** Write tools are registered only with `SNEED_MCP_WRITES=1` (or
  `"writes": true` in the config file).
- **Preview, then confirm.** Every write tool, called without `confirm`, returns a preview: the signer
  ("as <principal> (you, …)" in act-as-me mode), the exact canister calls in order with decoded arguments,
  and every amount that leaves the account, ledger fees included. With it comes a one-time token that is
  random, single-use, expires in 10 minutes, and is bound to the tool, the exact arguments, the signer
  and the planned calls and spends. The agent must show you the preview and call again with
  `confirm: <token>` only after you agree. If the arguments, the signer or the on-chain plan (fees,
  amounts) changed in the meantime, nothing runs. A blocked preview (cap, balance, permission, scope)
  gets no token at all.
- **Daily caps per token** (UTC day, counted across all writes): 1 ICP and 1000 SNEED by default. Any
  other token can't be spent until you give it a cap. Set caps in the config file
  (`"caps": {"<ledger id>": "<whole tokens>"}`) or with `SNEED_MCP_CAPS`.
- **No plain transfers.** Sending tokens to an arbitrary account stays disabled unless
  `SNEED_MCP_ALLOW_TRANSFERS=1`. Purpose-bound transfers that are part of a Sneed flow still work: a tip
  to a post's author, a bid escrow, a lock deposit, a fee deposit.
- **Delegation scope.** In act-as-me mode the IC refuses calls outside the canisters you approved. The
  preview says so up front.
- **Audit log.** Every executed write is appended to `~/.config/sneed-hub-mcp/audit.jsonl` (mode 600) with
  its signer, arguments, calls, spends and the reply.
- **Mirrors Sneed Hub.** Each write makes the same calls in the same order as the Sneed Hub page for that
  action. For multi-step flows (offers, locks, bids) a failure says exactly what happened and how to
  recover.

**Privacy:** everything on-chain is public and tied to the signing principal: posts, tips, votes, locks,
offers, bids and names. Nothing about them is anonymous. Sneed SMS messages are private to their
participants but not end-to-end encrypted: SMS admins can read them.

## Tools

Reads (all modes; no keys needed for public data):

| Tool | What it does |
| --- | --- |
| `sneed_hub_guide`, `sneed_hub_link`, `cycles_top_up_help` | What you can do on Sneed Hub, exact links and steps |
| `sneed_lock_list`, `sneed_lock_get`, `sneed_lock_token_totals` | Sneed Lock locks and totals |
| `sneedex_list_offers`, `sneedex_get_offer` | Sneedex offers and bids |
| `forum_browse`, `forum_read_thread`, `forum_recent` | The forum |
| `sneed_name_lookup`, `principal_profile` | Names, avatars, NFT avatars, your private nickname for a principal |
| `sneed_dao_proposals`, `sneed_dao_proposal` | SNS proposals |
| `sns_my_neurons` | A principal's SNS neurons and the open proposals they can still vote on |
| `token_info`, `wallet_balances` | Any ICRC-1 token; a principal's balances across Sneed Hub's whitelisted tokens |
| `sms_read` | The signer's Sneed SMS inbox, outbox, or a message with its thread |
| `notifications_read` | The signer's notification channels, routing, apps, history |
| `mon_read` | Sneed Monitor tiers and the signer's watches and balance (needs `SNEED_MCP_CANISTER_SNEED_MON` until it has a production id) |
| `premium_status` | Premium membership and the prices that apply to a principal |
| `sneedapp_apps`, `sneedapp_my_bots` | Sneedapp apps and versions; a principal's bots with their versions |
| `rll_rewards` | Claimable rewards, past claims, distribution stats |
| `special_prices` | Admin and partner prices of a charging Sneed canister |
| `icrc3_log` | The ICRC-3 activity log of any Sneed canister (or ledger) |
| `whoami`, `connect_as_me`, `disconnect` | Signer, act-as-me connection |

Writes (only with `SNEED_MCP_WRITES=1`; each is preview, then confirm):

| Tool | Calls (as Sneed Hub makes them) |
| --- | --- |
| `forum_create_thread`, `forum_post`, `forum_edit_post` | `create_thread`, `create_post`, `update_post` (own posts only) |
| `forum_tip_post` | `icrc1_transfer` to the author, then `create_tip` with the block index |
| `sms_send` | `send_message` |
| `name_set` | `sneed_pid_names.set_my_name` |
| `sns_vote` | `manage_neuron` RegisterVote per neuron with the Vote permission and an uncast ballot |
| `sns_make_motion_proposal` | `manage_neuron` MakeProposal { Motion } from a neuron with Submit permission. Proxy proposals (spec/sneed_proxy.md) are a TODO in `src/tools/w_gov.js` |
| `sneedex_bid`, `sneedex_buyout` | `reserveBid`, `getBidEscrowSubaccount`, `icrc1_transfer`, `confirmBid` |
| `sneedex_create_offer` | creation fee deposit (if short), `createOffer`, `addAsset`…, `finalizeAssets`, escrow per asset (ICRC-37 approval + `escrowICRC7NFTsByApproval`, or the ICRC-7 transfer path with the canary check + `escrowICRC7NFTs`; EXT transfer to the checked escrow account id + `escrowEXTNFTs`; tokens + `escrowICRC1Tokens`), `activateOffer` |
| `sneed_lock_create_token_lock` | lock fee checked with `getEffectiveLockFee`, ICP to the payment subaccount (if short), tokens to your Sneed Lock wallet subaccount (if short), `create_lock` |
| `mon_watch`, `mon_unwatch` | optional top-up + `credit_deposit`, `watch` / `unwatch`, Notifications `allow_app` |
| `notifications_allow_app`, `notifications_set_channels` | `allow_app`, `set_settings` (your other settings unchanged) |
| `rll_claim` | `claim_full_balance_of_hotkey` per token above its fee |

Resources: `sneed-hub://docs/llms.txt`, `sneed-hub://api-docs/{slug}`, `sneed-hub://skills/{name}` (fetched
live from Sneed Hub). Prompt: `help_me_on_sneed_hub`.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `SNEED_MCP_WRITES` | off | `1` registers the write tools |
| `SNEED_MCP_ALLOW_TRANSFERS` | off | `1` allows plain transfers to arbitrary accounts |
| `SNEED_MCP_CAPS` | `{"ICP ledger":"1","SNEED ledger":"1000"}` | JSON daily caps in whole tokens, by ledger id (or symbol) |
| `SNEED_MCP_DFX_IDENTITY` | | Own identity: a plaintext dfx identity by name |
| `SNEED_MCP_IDENTITY_PEM` | | Own identity: a PEM file |
| `SNEED_MCP_IDENTITY` | `<config dir>/identity.json` | Own identity: the generated key's path |
| `SNEED_MCP_CONFIG_DIR` | `~/.config/sneed-hub-mcp` | Keys, delegation, spending, audit log |
| `SNEED_MCP_CONFIG` | `<config dir>/config.json` | Optional file: `writes`, `allow_transfers`, `caps`, `dfx_identity`, `identity_pem`, `audit_log`, `canisters` |
| `SNEED_MCP_AUDIT_LOG` | `<config dir>/audit.jsonl` | Audit log path |
| `SNEED_MCP_CANISTER_<NAME>` | production ids | Override a canister id, e.g. `SNEED_MCP_CANISTER_SNEED_MON` |
| `SNEED_HUB_IC_HOST` | `https://icp-api.io` | IC API host |
| `SNEED_MCP_FETCH_ROOT_KEY` | off | `1` for local replicas / PocketIC only |
| `SNEED_HUB_URL` | `https://app.sneeddao.com` | Sneed Hub base URL for links and `/connect-agent` |

## Development

```bash
npm test             # unit tests: safety layer, identities and PEMs, delegations and the connect listener, helpers
npm run smoke        # starts the server and calls every read tool on mainnet (writes forced off, throwaway key)
```

Integration tests of the write tools against real canisters run on PocketIC, in the repository's canister
test suite: `cd test/canisters && npm run build && npx vitest run tests/mcp-writes.test.js`. They cover
name, forum thread/post/edit, SMS, a Sneed Lock token lock with its fee, a Sneedex offer of ICRC-7 + EXT
NFTs created in act-as-me mode through the `/connect-agent` page's own code, the replica refusing a
canister outside the delegation, a bid, and the audit log.

The IDL factories in `src/idl/` are copies of the canisters' generated `service.did.js`
(`test/canisters/build/*.did.js`, built from the current sources) plus `src/external` for ICRC-1 and
ICRC-7, so the package is self-contained. Refresh them when an interface changes. Methods that are not
deployed to production yet fall back where possible: Premium prices fall back to the tiers, and
special prices say they are not available yet.
