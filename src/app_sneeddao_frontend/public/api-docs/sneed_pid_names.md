# sneed_pid_names

`sneed_pid_names` is one of the six canisters of the Sneed DAO naming service. Accounts (a name, checkmark and avatar shared by several principals), hotkeys, canister names and the name search index.

| | |
|---|---|
| Production canister | `ejz7n-lyaaa-aaaad-qmkzq-cai` |
| Staging canister | `qechb-aiaaa-aaaad-ag6lq-cai` |
| Candid interface | [sneed_pid_names.did](/api-docs/sneed_pid_names.did) · [JavaScript IDL factory](/api-docs/sneed_pid_names.did.js) |
| Source | [src/sneed_pid_names](https://github.com/Snassy-icp/app_sneeddao/tree/main/src/sneed_pid_names) |

The whole naming service is documented in one place: **[Sneed Names API](/api/sneed_names)** ([raw Markdown](/api-docs/sneed_names.md)). This canister's methods are in [section 5](/api/sneed_names#51-sneedpidnames-reads-queries).

**Short guide for agents.** `get_api_doc : () -> (text) query` returns a compact Markdown guide to this canister that links to the Sneed Names API. It is a free query; the ingress guard refuses it as an update call.

## Block types

This canister keeps an ICRC-3 activity log. Its block types are described in [Sneed Names, section 6: Activity log (ICRC-3)](/api/sneed_names#6-activity-log-icrc-3) ([block types](/api/sneed_names#block-types)).
