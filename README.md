# Sneed DAO: Sneed Hub and its canisters

Sneed Hub ([app.sneeddao.com](https://app.sneeddao.com)) is Sneed DAO's web app on the Internet Computer. It covers a wallet, Sneed Lock, the Sneedex marketplace, SNS and ICP neuron tools, bots, a forum with tips and mentions, direct messages, notifications, names and avatars, token tools and DAO governance. Sneed DAO is an SNS DAO: its canisters are upgraded by proposals that SNEED neurons vote on.

This repository holds the Motoko canisters and the React frontend.

## Documentation

| For | Where |
|---|---|
| People using Sneed Hub | [app.sneeddao.com/help](https://app.sneeddao.com/help) |
| AI agents | [app.sneeddao.com/llms.txt](https://app.sneeddao.com/llms.txt). It is the entry point and links the `sneed-hub` agent skill, which explains what a user can do and where. |
| Developers and integrators | [app.sneeddao.com/api](https://app.sneeddao.com/api), with a reference per canister (Markdown, Candid and a JavaScript IDL factory) in `src/app_sneeddao_frontend/public/api-docs/` |
| Agent skills | [/.well-known/agent-skills/index.json](https://app.sneeddao.com/.well-known/agent-skills/index.json) |
| MCP server | [`mcp/sneed-hub`](mcp/sneed-hub): a read-only Model Context Protocol server, so an assistant can look things up and send people to the right Sneed Hub page |
| Design specs | `spec/` (plans and decisions, some for work not built yet) |

## Canisters

Production ids are the `ic` entries in `canister_ids.json`; staging ids are the `staging` entries. Staging runs on mainnet with real tokens, but its state is separate from production.

| Canister | Source | What it does |
|---|---|---|
| `app_sneeddao_frontend` | `src/app_sneeddao_frontend` | Sneed Hub (asset canister) |
| `app_sneeddao_backend` | `src/app_sneeddao_backend` | Settings, whitelisted tokens, partners, projects, legacy names |
| `sneed_lock` | `src/sneed_lock` | Time locks for ICRC-1 tokens and ICPSwap positions; locks as ICRC-7 NFTs; ICRC-3 log |
| `sneedex` | `src/sneedex` | Marketplace and escrow for tokens, NFTs, neurons, canisters and locks |
| `sneed_sns_forum` | `src/sneed_sns_forum` | Forums, topics, threads, posts, votes, tips, mentions |
| `sneed_sms` | `src/sneed_sms` | Direct messages between principals |
| `sneed_notifications` | `src/sneed_notifications` | Notifications by Sneed SMS, Discord DM or phone push, delivered by relays (`relays/notifications`) |
| `sneed_pid_names`, `sneed_neuron_names`, `sneed_pid_nicknames`, `sneed_neuron_nicknames`, `sneed_profiles`, `sneed_avatars` | `src/sneed_*` | Names, nicknames, profiles and avatars (including NFT avatars) |
| `sneed_premium` | `src/sneed_premium` | Sneed Premium membership |
| `rll` | `src/sneed_rewards` | Revenue and rewards distribution |
| `sneedapp` | `src/sneedapp` | App store: mints and upgrades bot canisters |
| `sneed_icp_staking_bot`, `sneed_trading_bot` | `src/sneed_bots` | Bots users own (ICP neuron manager, trading bot) |
| `mr_sneed` | `src/mr_sneed` | Mr Sneed, the DAO's mascot and spirit given a voice by AI: on-chain memory and activity log |
| `sneed_guardian`, `sneed_guardian_blackhole`, `sneed_guardian_multidao` | `src/sneed_guardian` | Custody canisters (staging only so far) |
| `sneed_pad` | `src/sneed_pad` | Launchpad (staging only so far) |

## Building and testing

- **Toolchains:** canisters use dfx 0.28.0 (moc 0.14.13), as in `dfx +0.28.0 build --network ic <canister>`. The frontend is deployed with dfx 0.31.0. Motoko packages come from mops (`mops install`).
- **Canister tests:** `cd test/canisters && npm install && npm run build && npm test`. This runs the PocketIC integration suite over all canisters.
- **Frontend check:** `cd src/app_sneeddao_frontend && npm run check`. It catches unknown names and missing imports or exports, which the Vite build lets through.
- **CI:** `.github/workflows/ci.yml` runs the canister tests, the frontend check and build, and it builds every canister and lists the release Wasm hashes.

## Releases

1. Changes go to staging first.
2. Each changed DAO canister is upgraded by its own SNS proposal, carrying the Wasm hash.
3. Release builds only reproduce at the path production builds use (`/home/snassy/app_sneeddao`), because Motoko embeds the source path in the Wasm. Build there to check a proposal's hash, or use the CI's hashes job.
4. Canisters with enhanced orthogonal persistence must be upgraded with `wasm_memory_persistence = keep`. Otherwise the upgrade fails.

## License

See [LICENSE](LICENSE).
