Motoko Patterns and Practices. 

This file describes general guidelines and some hard rules for writing maintainable motoko programs/canisters. 

Stable vars:
# Avoid modifying stable vars, since this introduces the requirement of using a migration path. When you have many deployment environments (test, staging, production..) keeping track of where which migration paths have to be applied is cumbersome. 
- for configuration settings, don't package them into a config object/record in a single stable var, since adding a new setting will break the upgrade and require a migration path. Instead, use an individual stable var for each config setting. 
- Never use enums in stable variables. Enums (types with # items) can change (add new enum values) and then the stable variables need migration paths. Instead, use integers (Nats) rather than enums in the stable vars, and define a transient map (that sets up correctly every time we upgrade the canister) mapping from the integers to the enum values. The enum values can be used for ergonomics in the public APIs. 