# sneed_profiles

`sneed_profiles` is one of the six canisters of the Sneed DAO naming service. The dapp registry ("this principal is me on that dapp").

| | |
|---|---|
| Production canister | `fytbs-tqaaa-aaaad-qmk4a-cai` |
| Staging canister | `rviz6-yaaaa-aaaad-ag6oa-cai` |
| Candid interface | [sneed_profiles.did](/api-docs/sneed_profiles.did) · [JavaScript IDL factory](/api-docs/sneed_profiles.did.js) |
| Source | [src/sneed_profiles](https://github.com/Snassy-icp/app_sneeddao/tree/main/src/sneed_profiles) |

The whole naming service is documented in one place: **[Sneed Names API](/api/sneed_names)** ([raw Markdown](/api-docs/sneed_names.md)). This canister's methods are in [section 5](/api/sneed_names#57-sneedprofiles).

**Short guide for agents.** `get_api_doc : () -> (text) query` returns a compact Markdown guide to this canister that links to the Sneed Names API. It is a free query; the ingress guard refuses it as an update call.

## Block types

This canister keeps an ICRC-3 activity log. Its block types are described in [Sneed Names, section 6: Activity log (ICRC-3)](/api/sneed_names#6-activity-log-icrc-3) ([block types](/api/sneed_names#block-types)).
