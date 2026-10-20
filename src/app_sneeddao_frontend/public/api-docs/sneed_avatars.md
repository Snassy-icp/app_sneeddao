# sneed_avatars

`sneed_avatars` is one of the six canisters of the Sneed DAO naming service. Avatar images, content-addressed by SHA-256 and served over HTTP.

| | |
|---|---|
| Production canister | `ev5f4-4yaaa-aaaad-qmk3q-cai` |
| Staging canister | `rapit-ziaaa-aaaad-ag6nq-cai` |
| Candid interface | [sneed_avatars.did](/api-docs/sneed_avatars.did) · [JavaScript IDL factory](/api-docs/sneed_avatars.did.js) |
| Source | [src/sneed_avatars](https://github.com/Snassy-icp/app_sneeddao/tree/main/src/sneed_avatars) |

The whole naming service is documented in one place: **[Sneed Names API](/api/sneed_names)** ([raw Markdown](/api-docs/sneed_names.md)). This canister's methods are in [section 5](/api/sneed_names#58-sneedavatars).

**Short guide for agents.** `get_api_doc : () -> (text) query` returns a compact Markdown guide to this canister that links to the Sneed Names API. It is a free query; the ingress guard refuses it as an update call.
