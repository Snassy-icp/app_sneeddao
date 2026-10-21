# Product pipeline (notes)

Ideas agreed in direction but not started, with where they are specced. Newest last.

| Item | What | Spec / notes |
|---|---|---|
| Sneed proxy | One GNSF per topic class lets SNS proposals change any allowlisted admin setting; propose buttons in Sneed Hub. Canister built and tested; deployment pending. | spec/sneed_proxy.md |
| Special prices | Admin and partner prices in every charging canister. Built, on staging; production proposals pending. | spec/special_prices.md |
| Wallet subaccounts | Hold, send, receive and approve from subaccounts in the Sneed Hub wallet. | spec/programmable_accounts.md (phase 1) |
| sneed_vault | Owned subaccount namespaces with per-subaccount funding rules (who may request how much, where, when). | spec/programmable_accounts.md |
| Sneed Monitor funding trees | Monitor any account or canister and top it up, in trees (A tops up B tops up C). | spec/programmable_accounts.md, spec/sneed_mon.md |
| sneed_mon_bot | User-owned automation bot inside Sneed Monitor: triggers, actions, dataflow; gas = its own cycles. | spec/sneed_mon_bot.md |
| Managed bots | For users who don't care about custody: Sneed as shared or sole custodian of their Sneedapp bots, keeping them topped up and upgraded along published versions. Custodian = sneed_guardian with a Sneedapp-bot child kind. | spec/sneed_mon_bot.md §17, spec/custody.md |
| Notification bot | A user-owned notification canister for heavy users (own caps, own cycles); the shared Sneed Notifications stays the default. | not specced |
| SNS staking bot | Like the ICP staking bot (icp_neuron_manager), but holding SNS neurons: stake, dissolve, follow, vote, disburse maturity, make proposals; sellable on Sneedex. | not specced; see spec/icp_neuron_manager.md for the ICP one |
| sneed_agent (AI bot) | A user-owned bot that runs AI agents with control over the user's other bots: it can send proposals (through bots that hold neurons), move funds within the budgets and rules it is given (sneed_vault grants, bot botkeys), and drive sneed_mon_bot workflows. Uses the Sneed Hub MCP tools and the same preview/confirm, caps and audit safety model. Where the model runs (on-chain inference vs. an off-chain worker the bot authorises) is the first design question. | not specced; see mcp/sneed-hub, spec/self-writing-dao/ for Mr Sneed's own design |
