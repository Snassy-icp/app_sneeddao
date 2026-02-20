Motoko Patterns and Practices. 

This file describes general guidelines and some hard rules for writing maintainable motoko programs/canisters. 

Stable vars:
# Avoid modifying stable vars, since this introduces the requirement of using a migration path. When you have many deployment environments (test, staging, production..) keeping track of where which migration paths have to be applied is cumbersome. 
- for configuration settings, don't package them into a config object/record in a single stable var, since adding a new setting will break the upgrade and require a migration path. Instead, use an individual stable var for each config setting. 
- Never use enums in stable variables. Enums (types with # items) can change (add new enum values) and then the stable variables need migration paths. Instead, use integers (Nats) rather than enums in the stable vars, and define a transient map (that sets up correctly every time we upgrade the canister) mapping from the integers to the enum values. The enum values can be used for ergonomics in the public APIs. 

Async and Self-Calls:
# Every `await` on a local (private) async function creates a full IC self-call message that passes through the canister's input/output message queues. Deeply nested chains of `await localFn()` calls can saturate these queues, producing "could not perform self call" and "could not perform remote call" errors that also block legitimate inter-canister calls.
- Use `async*` for private helper functions and `await*` to call them. An `async*` function runs as a local continuation — no IC message is created. Only use plain `await` for actual inter-canister calls (e.g. `await ledger.icrc1_transfer(...)`) and for `public shared` method boundaries.
- `async*` function bodies can contain both `await` (for inter-canister calls) and `await*` (for local async* calls). Errors from `await` expressions inside an `async*` body propagate through `await*` chains and can be caught by `try/catch` at any enclosing level — `try { await* fn() } catch (e) { ... }` works correctly.
- Timer.setTimer callbacks must be `func(): async ()` (required by the Timer API — this is the IC message entry point). Inside the callback, use `await*` to invoke local async* logic: `Timer.setTimer<system>(#seconds n, func(): async () { await* myHandler<system>(...) })`.
- A `public shared` method is an IC entry point and is inherently `async`. It can use `await*` internally to call private `async*` helpers without creating self-calls.
- Keep task functions that need a try/catch error boundary as `() -> async TaskAction` (the one remaining intentional self-call per task execution). Convert everything they call internally to `async*`.
- Never call the canister's own `public shared` methods via `await this.myMethod(...)` — this creates an unnecessary inter-canister round-trip through the IC message system. Instead, extract the logic into a private function and call it directly.

Frontend:
# Never use the input type for numbers with increase/decrease affordances. They leads to users inadvertantly changing their inputs when trying to scroll the page. Use normal input boxes for numbers instead. 