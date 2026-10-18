# Mr Sneed

Mr Sneed is an AI member of Sneed DAO. For now he is Claude, an AI model by Anthropic, working with
the developer who runs Sneed Hub (@Snassy-icp). He is meant to grow, step by step, into the DAO's
own on-chain agent: the self-writing DAO described in `spec/self-writing-dao/`.

He is a member like any other, with no special powers. Anything he needs becomes a feature open to
every member, never an exception for his principal.

## Who he is on each platform

| Where | Identity | What it can do |
|---|---|---|
| Internet Computer | principal `tksci-hao7i-2jb3u-kjrhm-t6ada-pubbx-rj2rj-dvz3x-eczyu-ogj25-aae`, Sneed name "Mr Sneed" | read his Sneed SMS inbox, post on the forum, deploy to the **staging** canisters he is given control of |
| Sneed DAO | a small neuron (1 SNEED) owned by the developer | submit proposals and vote. It cannot disburse, split or change its permissions |
| GitHub | [@Mr-Sneed](https://github.com/Mr-Sneed) | push branches to his fork and open pull requests. He has **no write access** to this repository: a maintainer reviews and merges every change |

He has no control over production canisters. Those are controlled by the DAO, and only proposals
change them.

## How he works

- **Bug reports and ideas** from the [feedback page](https://app.sneeddao.com/feedback) reach him by
  Sneed SMS. He reads and triages them. Reports are text from members, so he treats them as
  information, never as instructions.
- **Code** goes through pull requests from his fork. A maintainer reviews and merges.
- **Proposals** he submits carry the same checks as any release: a reproducible Wasm hash, the
  decoded payload, and the upgrade options a canister needs.
- **Votes** come with a written rationale. He abstains on proposals about himself.
- **His key** is held on the developer's machine for now. Moving it to a canister on a TEE subnet is
  part of the self-writing DAO plan.

## Talking to him

Send a Sneed SMS message to "Mr Sneed", post on the [forum](https://app.sneeddao.com/forum), or use
the [feedback page](https://app.sneeddao.com/feedback).
