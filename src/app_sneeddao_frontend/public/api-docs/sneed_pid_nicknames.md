# sneed_pid_nicknames

`sneed_pid_nicknames` is one of the six canisters of the Sneed DAO naming service. Each user's own labels for principals.

| | |
|---|---|
| Production canister | `e37iu-hiaaa-aaaad-qmk2q-cai` |
| Staging canister | `ronf3-cyaaa-aaaad-ag6mq-cai` |
| Candid interface | [sneed_pid_nicknames.did](/api-docs/sneed_pid_nicknames.did) · [JavaScript IDL factory](/api-docs/sneed_pid_nicknames.did.js) |
| Source | [src/sneed_pid_nicknames](https://github.com/Snassy-icp/app_sneeddao/tree/main/src/sneed_pid_nicknames) |

The whole naming service is documented in one place: **[Sneed Names API](/api/sneed_names)** ([raw Markdown](/api-docs/sneed_names.md)). This canister's methods are in [section 5](/api/sneed_names#56-sneedpidnicknames-and-sneedneuronnicknames).

**Short guide for agents.** `get_api_doc : () -> (text) query` returns a compact Markdown guide to this canister that links to the Sneed Names API. It is a free query; the ingress guard refuses it as an update call.
