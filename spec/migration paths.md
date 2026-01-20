https://docs.internetcomputer.org/motoko/language-manual/#migration-expressions

Declaration fields
A declaration field <vis>? <stab>? <dec> defines zero or more fields of an actor or object, according to the set of variables defined by <dec>.

Any identifier bound by a public declaration appears in the type of enclosing object, module or actor and is accessible via the dot notation.

An identifier bound by a private or system declaration is excluded from the type of the enclosing object, module or actor and thus inaccessible.

In a persistent actor or actor class, all declarations are implicitly stable unless explicitly declared otherwise. In a non-persistent actor or actor class, all declarations are implicitly transient (equivalently flexible) unless explicitly declared otherwise.

The declaration field has type T provided:

<dec> has type T.

If <stab>? is stable then T must be a stable type (see stability).

If <stab>? is absent and the actor or actor class is persistent, then T must be a stable type (see stability).

Actor fields declared transient (or legacy flexible) can have any type, but will not be preserved across upgrades.

In the absence of any <parenthetical>? migration expression, sequences of declaration fields are evaluated in order by evaluating their constituent declarations, with the following exception:

During an upgrade only, the value of a stable declaration is obtained as follows:

If the stable declaration was previously declared stable in the retired actor, its initial value is inherited from the retired actor.

If the stable declaration was not declared stable in the retired actor, and is thus new, its value is obtained by evaluating <dec>.

For an upgrade to be safe:

Every stable identifier declared with type T in the retired actor must be declared stable and of type U in the replacement actor and must satisfy T < U (stable subtyping).
This condition ensures that every stable variable is either fresh, requiring initialization, or its value can be safely inherited from the retired actor, without any loss of data.

Note that stable variables cannot be implicitly removed across upgrades and cannot be promoted to type Any. These effects can only be achieved using an explicit migration expression.

Migration expressions
Actors and actor class declaration may specify a migration expression, using an optional, leading <parenthetical> expression with a required field named migration. The value of this field, a function, is applied to the stable variables of an upgraded actor, before initializing any stable fields of the declared actor.

The parenthetical expression must satisfy the following conditions:

It must be static, that is, have no immediate side effects.
Its migration field must be present and have a non-shared function type whose domain and codomain are both record types.
The domain and the codomain must both be stable.
Any field in the codomain must be declared as a stable field in the actor body.
The content type of the codomain field must be a subtype of the content type of the actor's stable field.
The migration expression only affects upgrades of the actor and is otherwise ignored during fresh installation of the actor.

On upgrade, the domain of the migration function is used to construct a record of values containing the current contents of the corresponding stable fields of the retired actor. If one of the fields is absent, the upgrade traps and is aborted.

Otherwise, we obtain an input record of stable values of the appropriate type.

The migration function is applied to the input record. If the application traps, the upgrade is aborted.

Otherwise, the application produces an output record of stable values whose type is the codomain.

The actor's declarations are evaluated in order by evaluating each declaration as usual except that the value of a stable declaration is obtained as follows:

If the stable declaration is present in the codomain, its initial value is obtained from the output record.

Otherwise, if the stable declaration is not present in the domain and is declared stable in the retired actor, then its initial value is obtained from the retired actor.

Otherwise, its value is obtained by evaluating the declaration's initalizer.

Thus a stable variable's initializer is run if the variable is not produced by the migration function and either consumed by the migration function (by appearing in its domain) or absent in the retired actor.

For the upgrade to be safe:

Every stable identifier declared with type U in the domain of the migration function must be declared stable for some type T in the retired actor, with T < U (stable subtyping).

Every stable identifier declared with type T in the retired actor, not present in the domain or codomain, and declared stable and of type U in the replacement actor, must satisfy T < U (stable subtyping).

Thses conditions ensure that every stable variable is either discarded or fresh, requiring initialization, or that its value can be safely consumed from the output of migration or the retired actor without loss of date.

The compiler will issue a warning if a migration function appears to be discarding data by consuming a field and not producing it. The warnings should be carefully considered to verify any data loss is intentional and not accidental.


Example:


// Migration expression to add approved_bidders field to existing offers
(with migration = func (old : { var offers : [{
    id : T.OfferId;
    creator : Principal;
    min_bid_price : ?Nat;
    buyout_price : ?Nat;
    expiration : ?Time.Time;
    price_token_ledger : Principal;
    assets : [T.AssetEntry];
    state : T.OfferState;
    created_at : Time.Time;
    activated_at : ?Time.Time;
}] }) : { var offers : [T.Offer] } {
    {
        var offers = Array.map(
            old.offers,
            func (o : {
                id : T.OfferId;
                creator : Principal;
                min_bid_price : ?Nat;
                buyout_price : ?Nat;
                expiration : ?Time.Time;
                price_token_ledger : Principal;
                assets : [T.AssetEntry];
                state : T.OfferState;
                created_at : Time.Time;
                activated_at : ?Time.Time;
            }) : T.Offer {
                {
                    id = o.id;
                    creator = o.creator;
                    min_bid_price = o.min_bid_price;
                    buyout_price = o.buyout_price;
                    expiration = o.expiration;
                    price_token_ledger = o.price_token_ledger;
                    assets = o.assets;
                    state = o.state;
                    approved_bidders = null;
                    created_at = o.created_at;
                    activated_at = o.activated_at;
                }
            }
        );
    }
})

shared (deployer) persistent actor class Sneedex(initConfig : ?T.Config) = this {
    // ============================================