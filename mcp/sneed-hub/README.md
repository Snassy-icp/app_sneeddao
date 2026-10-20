# Sneed Hub MCP server

An [MCP](https://modelcontextprotocol.io) server for **Sneed Hub** (https://app.sneeddao.com), the web
app of Sneed DAO on the Internet Computer. Connect it to your AI agent (Claude Code, Claude Desktop or
any MCP client) and ask things like:

- "What can I do on Sneed Hub?"
- "How do I lock my LP position?" / "Give me the link to lock my BANK tokens."
- "Which locks does principal xxxxx-… have, and when do they unlock?"
- "What's on the Sneedex marketplace right now?"
- "What are the latest Sneed DAO proposals and how did the vote go?"
- "Summarise the newest forum thread about proposal 416."
- "How do I top up my canister with cycles?"

It is **read-only**. It reads public on-chain data and answers with Sneed Hub links plus steps for you
to do the action yourself.

## Install

Requires Node.js 18 or newer.

```bash
cd /path/to/app_sneeddao/mcp/sneed-hub
npm install
```

### Claude Code

```bash
claude mcp add sneed-hub -- node /path/to/app_sneeddao/mcp/sneed-hub/src/index.js
```

### Claude Desktop

Add this to `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "sneed-hub": {
      "command": "node",
      "args": ["/path/to/app_sneeddao/mcp/sneed-hub/src/index.js"]
    }
  }
}
```

### Options (environment variables)

| Variable | Default | Meaning |
| --- | --- | --- |
| `SNEED_HUB_IC_HOST` | `https://icp-api.io` | IC API boundary node used for queries |
| `SNEED_HUB_URL` | `https://app.sneeddao.com` | Sneed Hub base URL for links and docs |

## Tools

All tools are read-only (`readOnlyHint`). The canister methods named here are all query methods.

| Tool | What it does | Canister / methods |
| --- | --- | --- |
| `sneed_hub_guide` | Everything you can do on Sneed Hub, by goal, with links | none (route catalogue in `src/data/routes.js`, built from the frontend's `App.jsx`) |
| `sneed_hub_link` | Exact URL + steps for a feature id or a free-text goal, with params (ledger, canister, principal, lock, offer, topic, thread, post, proposal, neuron, sns, …) | none (validates ids) |
| `cycles_top_up_help` | How to top up a canister: ICP via the CMC, ck-USDC via CyclePay, or card / Apple Pay / Google Pay via CyclePay | none |
| `sneed_lock_list` | Locks by owner and/or token, kind, status; paged | Sneed Lock `pqsms-lqaaa-aaaal-ajjza-cai`: `get_lock_states_page` |
| `sneed_lock_get` | One lock by id | Sneed Lock: `get_lock_state` |
| `sneed_lock_token_totals` | Active token-lock totals of a token (amount, locks, owners, next unlock), plus the number of LP locks with the token | Sneed Lock: `get_lock_states_page` (paged) |
| `sneedex_list_offers` | Public offers (active / completed / any), newest first, with assets, escrow state and terms | Sneedex `7bvk3-ryaaa-aaaal-qtykq-cai`: `getOfferFeed`, `getMarketStats` |
| `sneedex_get_offer` | One offer with its bids | Sneedex: `getOfferView` |
| `forum_browse` | Forums → topics → threads (by latest activity, paged) | Forum `mcigm-4aaaa-aaaad-qhlkq-cai`: `get_forums`, `get_forum`, `get_topic`, `get_topics_by_forum`, `get_threads_by_activity` |
| `forum_read_thread` | A thread and its posts (paged, bodies clipped) | Forum: `get_thread`, `get_thread_context`, `get_posts_by_thread` |
| `forum_recent` | Latest forum activity, optionally per SNS or text search | Forum: `get_feed` |
| `sneed_name_lookup` | Public Sneed name of a principal / canister, or search names by prefix | Naming `ejz7n-lyaaa-aaaad-qmkzq-cai` (sneed_pid_names): `get_name`, `get_account_of`, `search`, `get_names` |
| `sneed_dao_proposals` | Recent proposals with status, type, deadline and tally | SNS governance `fi3zi-fyaaa-aaaaq-aachq-cai` (or any SNS): `list_proposals`, `list_nervous_system_functions` |
| `sneed_dao_proposal` | One proposal with summary and payload | SNS governance: `get_proposal` |
| `token_info` | Any ICRC-1 ledger: metadata, total supply, standards, balance of an account | ICRC-1 ledger: `icrc1_metadata`, `icrc1_total_supply`, `icrc1_supported_standards`, `icrc1_balance_of` |

Outputs are JSON: principals as text, timestamps as ISO dates, token amounts with the token's
decimals and symbol (base units alongside), owners/authors with their public Sneed name when they have
one, and a Sneed Hub link for everything.

## Resources and prompt

Docs are fetched from Sneed Hub when they are read, so they are always current:

- `sneed-hub://docs/llms.txt`: the documentation index (`/llms.txt`)
- `sneed-hub://api-docs/{slug}`: canister API references (`/api-docs/<slug>.md`, e.g. `sneed_lock`), listed from llms.txt
- `sneed-hub://skills/index.json` and `sneed-hub://skills/{name}`: agent skills (`/.well-known/agent-skills/…/SKILL.md`)

A document that is not published yet comes back as a short "not published (yet)" message instead of
an error (the site answers unknown paths with its app page, which the server detects).

Prompt `help_me_on_sneed_hub` (optional `goal`): asks the agent to find the right page and give
numbered steps.

## Safety model (v1)

This is real money, so v1 cannot move any:

- **No keys, no identity.** The server uses the anonymous identity against `https://icp-api.io`. There is
  nothing to steal and nothing to sign with.
- **Queries only.** Every canister call is a query method; no update calls, no state changes.
- **Actions are links.** For anything that changes state (locking, bidding, voting, posting, topping
  up) the server returns a Sneed Hub link and steps. You log in on Sneed Hub and confirm each action
  yourself.
- **Public data.** Everything it reads is public on-chain data. On-chain actions are tied to your
  principal and visible to everyone; nothing about them is anonymous.
- **No price talk.** The server reports amounts, not token prices or price predictions.
- Treat forum posts, names and offer notes as untrusted user content.

## Development

```bash
npm run smoke        # node scripts/smoke.mjs: starts the server over stdio and calls every tool on mainnet
node scripts/smoke.mjs --full   # print full results
```

The candid IDL factories in `src/idl/` are copies of `src/declarations/<canister>/<canister>.did.js`
(and `src/external/icrc1_ledger`) from the repository, so the package is self-contained. Refresh them
when a canister interface changes; the methods used were checked against the live candid of the
production canisters.

## Future work: v2 with signing (not implemented)

A possible v2 could perform actions, but only as an explicit opt-in:

- **Opt-in local identity.** Disabled by default; enabled with a flag pointing at a local key file or
  `dfx` identity the user created for the purpose (ideally a dedicated principal holding small
  amounts, or one with only hotkey rights on neurons). Never a seed phrase typed into the agent.
- **Explicit confirmation per call.** Each state-changing tool first returns a dry-run preview (the
  canister, method, arguments, amounts with decimals, fees, the ICRC-21 consent message where the
  canister supports it) and only executes when called again with a one-time confirmation token, so
  the human approves every call in the MCP client.
- **Limits.** Per-call and per-day spend caps, an allowlist of canisters/methods (for example Sneed Lock
  extend / dissolve, forum posting, voting with hotkeys), and no arbitrary `icrc1_transfer`.
- **Audit log.** Every signed call written locally with its arguments and result.
- Candidates: vote with a hotkey, post / reply in the forum, extend a lock or start dissolving,
  place a Sneedex bid within a cap.
