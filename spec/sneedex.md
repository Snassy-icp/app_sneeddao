Sneedex Market[lace

We're going to build a marketplace called Sneedex. It will be based on offers that can hold one or more assets, and bids. The assets will be held in escrow in the marketplace canister. 

The core of an offer is these three fields: minimum bid price, buyout price, expiration date. 
Every offer must have either a buyout price or an expiration date - it can have both. 
If an offer does not have a minimum bid, the buyout price is considered the minimum bid. 
The offer must also contain the ledger PID of an ICRC1 token that the price is given in. All prices are in e8s. 

This construction allows for auctions (have a min bid and eiter a buyout and/or an expiration date),
as well as for limit orders (no min bid, but a buyout and optionally an expiration date) 

The assets that an offer can list include: Canisters, SNS Neurons, ICRC1 Tokens. The bids must be in the specified ICRC1 token. 

The list of supported asset types can grow over time, and we must support this while respecting stable canister state. 
Thus we will have a list of asset type ids and names that we can add and remove to, and all references to asset types will be via this id. 

When we need to do something with an asset, we will call a central API where we can register handlers for the asset types we support. 

We want to use the new persistent actors for this. 

Each offer gets a unique Nat id from a counter, starting at 0. 

To register assets into escrow:

for canisters: 1) Add the sneedex canister as a controller (but do not remove yourself). 2) call the sneedex canister, 3) sneedex canister will verify that the caller and itself are in the list of controllers for the canister (and that the caller is the creator of the offer and that the canister is listed as an asset in the offer). 4) if so it will make a snapshot of the list of controllers (except itself) and store it in the offer and then remove all controllers except itself. We now have the canister safely in escrow, and we have recorded who it belongs to in the offer creator field as well as in the controller list snapshot. 

For SNS Neurons: SNS Neurons have a list of hotkeys that can have full permissions to be considered owners (like controllers). We do the same general process, we verify both caller and the sneedex canister have owner hotkeys, take a snapshot of all hotkeys, clear all hotkeys except sneedex canister. 

For ICRC1 tokens: 1) The user sends the token to a subaccount on the sneedex canister that is generated from the user's principal and the offer id. 2) The sneedex canister verifies that the amount declared in the offer is present in the subaccount generated from the caller (who is also verified to be the offer creator) and the offer id. When ICRC1 tokens are sent to a bid, the bid id is used instead of the offer id. 

The user creates a new offer, which has an offer id. Then the user declares the assets (canisters, SNS Neurons, ICRC1 Tokens) they want to bundle into the offer.
Then they make the assets available to the sneedex canister (add sneedex as controller, owner hotkey, or send ICRC1 tokens to caller+offer_id subaccount).
Then they activate the offer, at which time the sneedex canister gains exclusive access to the assets in the offer. 

Then users can make bids until the offer resolves, either via buyout or expiration - or by being cancelled (possible until there are bids). 

If the offer expires without bids it fails, and the creator/seller can reclaim their assets (this can be done automatically, but if it fails the seller can also reclaim them with a call to a function). If there is at least one bid at the expiration date, or there is a bid matching the buyout price, the best bid wins and the auction succeeds, which means that now the buyer with the winning bid may claim the assets in the offer and the offer creator/seller may claim the tokens in the winning bid. 

At any point before the expiration date, and before a buyout is reached, and there is at least one bid, the offer creator can decide to accept the best bid and close the offer with the best bid at the time winning it. 

The state of the auction is represented by a single state enum from which all asset ownership (claimability) derives, and that can only transition atomically, 
which makes all assets in escrow change hands atomically. 

Use the file src/sneedex/main.mo for the main actor interface, src/sneedex/Types.mo for all type declarations, and create any additional files in the same directory as needed for the implementation. 
 