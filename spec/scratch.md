    // Create a new neuron
    const createNeuron = async (amount: bigint) => {
        try {
            if (!userLoggedIn.value) {
                throw new Error('User must be logged in');
            }

            // console.log('Finding free subaccount for new neuron...');
            const { subaccount, index } = await findFreeSubaccount();
            const nonce = BigInt(index);
            
            const tacoTokenPrincipal = 'kknbx-zyaaa-aaaaq-aae4a-cai'; // TACO token canister
            const snsGovernancePrincipal = 'lhdfz-wqaaa-aaaaq-aae3q-cai'; // TACO SNS Governance

            // Step 1: Transfer TACO tokens to SNS Governance with the new subaccount and memo
            // console.log(`Transferring TACO tokens to new neuron subaccount (nonce: ${nonce})...`);
            // console.log(`Subaccount (hex): ${Array.from(subaccount).map(b => b.toString(16).padStart(2, '0')).join('')}`);
            // console.log(`Controller principal: ${userPrincipal.value}`);
            
            const transferResult = await transferToNeuronSubaccount(tacoTokenPrincipal, snsGovernancePrincipal, subaccount, amount, nonce);
            // console.log(`Transfer completed with block index: ${transferResult}`);

            // Step 2: Wait a moment for the transfer to be processed
            // console.log('Waiting for transfer to be processed...');
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds

            // Step 3: Claim/refresh the neuron to create it
            // console.log('Claiming new neuron...');
            await claimOrRefreshNeuron(subaccount, nonce);

            // console.log('Neuron created successfully!');
            return { subaccount, success: true };
        } catch (error: any) {
            console.error('Error creating neuron:', error);
            throw error;
        }
    }


    // Find next available subaccount for neuron creation
    const findFreeSubaccount = async (): Promise<{ subaccount: Uint8Array, index: number }> => {
        if (!userLoggedIn.value) {
            throw new Error('User must be logged in');
        }

        const authClient = await getAuthClient();
        const identity = authClient.getIdentity();
        
        const agent = await createAgent({
            identity,
            host: process.env.DFX_NETWORK === "local" ? `http://localhost:4943` : "https://ic0.app",
            fetchRootKey: process.env.DFX_NETWORK === "local",
        });

        // Use the existing SNS governance IDL
        const { idlFactory } = await import('../../../declarations/sns_governance');
        
        const governanceActor = Actor.createActor(idlFactory, {
            agent,
            canisterId: 'lhdfz-wqaaa-aaaaq-aae3q-cai'
        });

        // Try nonces starting from 0
        for (let nonce = 0n; nonce < 1000n; nonce++) {  // Reasonable upper limit
            const controllerPrincipal = Principal.fromText(userPrincipal.value);
            const subaccount = await generateNeuronSubaccount(controllerPrincipal, nonce);
            
            try {
                // Try to get neuron with this subaccount
                const getNeuronRequest = {
                    neuron_id: [{
                        id: Array.from(subaccount)
                    }]
                };
                
                const result = await governanceActor.get_neuron(getNeuronRequest) as any;
                
                // If result.result is empty/null, this subaccount is free
                if (!result.result || result.result.length === 0) {
                    return { subaccount, index: Number(nonce) };
                }
                
                // If we get an error or the neuron doesn't exist, this subaccount is free
                if (result.result[0] && 'Error' in result.result[0]) {
                    return { subaccount, index: Number(nonce) };
                }
                
            } catch (error) {
                // If there's an error calling get_neuron, assume this subaccount is free
                // console.log(`Nonce ${nonce} appears to be free (error calling get_neuron):`, error);
                return { subaccount, index: Number(nonce) };
            }
        }
        
        throw new Error('Could not find a free subaccount for neuron creation');
    }

    // Transfer tokens to neuron subaccount
    const transferToNeuronSubaccount = async (
        tokenPrincipal: string,
        governancePrincipal: string,
        neuronId: Uint8Array,
        amount: bigint,
        memo?: bigint  // Optional memo for neuron creation traceability
    ) => {
        const authClient = await getAuthClient();
        const identity = authClient.getIdentity();
        
        const agent = await createAgent({
            identity,
            host: process.env.DFX_NETWORK === "local" ? `http://localhost:4943` : "https://ic0.app",
            fetchRootKey: process.env.DFX_NETWORK === "local",
        });

        // Create ICRC1 actor for TACO token
        const icrc1IDL = ({ IDL }: any) => {
            return IDL.Service({
                'icrc1_transfer': IDL.Func(
                    [IDL.Record({
                        'to': IDL.Record({ 'owner': IDL.Principal, 'subaccount': IDL.Opt(IDL.Vec(IDL.Nat8)) }),
                        'fee': IDL.Opt(IDL.Nat),
                        'memo': IDL.Opt(IDL.Vec(IDL.Nat8)),
                        'from_subaccount': IDL.Opt(IDL.Vec(IDL.Nat8)),
                        'created_at_time': IDL.Opt(IDL.Nat64),
                        'amount': IDL.Nat
                    })],
                    [IDL.Variant({
                        'Ok': IDL.Nat,
                        'Err': IDL.Record({
                            'InsufficientFunds': IDL.Record({ 'balance': IDL.Nat }),
                            'BadFee': IDL.Record({ 'expected_fee': IDL.Nat }),
                            'TemporarilyUnavailable': IDL.Null,
                            'GenericError': IDL.Record({ 'message': IDL.Text, 'error_code': IDL.Nat }),
                            'TooOld': IDL.Null,
                            'CreatedInFuture': IDL.Record({ 'ledger_time': IDL.Nat64 }),
                            'Duplicate': IDL.Record({ 'duplicate_of': IDL.Nat }),
                            'BadBurn': IDL.Record({ 'min_burn_amount': IDL.Nat })
                        })
                    })]
                )
            });
        };

        const tokenActor = Actor.createActor(icrc1IDL, {
            agent,
            canisterId: tokenPrincipal
        });

        // Convert neuronId to proper subaccount (32 bytes)
        const subaccount = new Uint8Array(32);
        subaccount.set(neuronId, 0);

        // Convert memo to bytes if provided
        const memoBytes = memo ? (() => {
            const buffer = new ArrayBuffer(8);
            new DataView(buffer).setBigUint64(0, memo);
            return Array.from(new Uint8Array(buffer));
        })() : [];

        const transferArgs = {
            to: {
                owner: Principal.fromText(governancePrincipal),
                subaccount: [Array.from(subaccount)]
            },
            fee: [],
            memo: memo ? [memoBytes] : [],
            from_subaccount: [],
            created_at_time: [],
            amount: amount
        };

        const result = await tokenActor.icrc1_transfer(transferArgs) as any;

        if ('Ok' in result) {
            return result.Ok;
        } else {
            throw new Error(`Transfer failed: ${JSON.stringify(result.Err)}`);
        }
    }

    // Claim or refresh neuron after staking
    const claimOrRefreshNeuron = async (neuronId: Uint8Array, memo?: bigint) => {
        const authClient = await getAuthClient();
        const identity = authClient.getIdentity();
        
        const agent = await createAgent({
            identity,
            host: process.env.DFX_NETWORK === "local" ? `http://localhost:4943` : "https://ic0.app",
            fetchRootKey: process.env.DFX_NETWORK === "local",
        });

        // Use the existing SNS governance IDL
        const { idlFactory } = await import('../../../declarations/sns_governance');
        
        const governanceActor = Actor.createActor(idlFactory, {
            agent,
            canisterId: 'lhdfz-wqaaa-aaaaq-aae3q-cai'
        });

        // Convert neuronId to proper subaccount (32 bytes)
        const subaccount = new Uint8Array(32);
        subaccount.set(neuronId, 0);

        // Debug logging
        // console.log(`ClaimOrRefresh request details:`);
        // console.log(`- Subaccount: ${Array.from(subaccount).map(b => b.toString(16).padStart(2, '0')).join('')}`);
        // console.log(`- Memo: ${memo}`);
        // console.log(`- Controller: ${userPrincipal.value}`);

        // For neuron creation, we need to use MemoAndController variant
        const manageNeuronRequest = memo !== undefined ? {
            subaccount: Array.from(subaccount),
            command: [{
                ClaimOrRefresh: {
                    by: [{
                        MemoAndController: {
                            controller: [Principal.fromText(userPrincipal.value)],
                            memo: Number(memo)  // Convert BigInt to Number for IDL
                        }
                    }]
                }
            }]
        } : {
            // For existing neurons, use NeuronId variant
            subaccount: Array.from(subaccount),
            command: [{
                ClaimOrRefresh: {
                    by: [{
                        NeuronId: {}
                    }]
                }
            }]
        };

        // Convert BigInt to string for logging
        const requestForLogging = JSON.parse(JSON.stringify(manageNeuronRequest, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value
        ));
        // console.log('ManageNeuron request:', JSON.stringify(requestForLogging, null, 2));

        const result = await governanceActor.manage_neuron(manageNeuronRequest) as any;
        
        if (result.command && result.command.length > 0 && 'ClaimOrRefresh' in result.command[0]) {
            return result.command[0].ClaimOrRefresh;
        } else {
            throw new Error(`ClaimOrRefresh failed: ${JSON.stringify(result)}`);
        }
    }

    // Generate neuron subaccount using the correct SNS formula
    // SHA256(0x0c, "neuron-stake", principal-bytes, nonce-u64-be)
    const generateNeuronSubaccount = async (controller: Principal, nonce: bigint): Promise<Uint8Array> => {
        // u64 → big-endian 8 bytes using DataView (more reliable)
        const u64be = (value: bigint): Uint8Array => {
            const buffer = new ArrayBuffer(8);
            new DataView(buffer).setBigUint64(0, value);
            return new Uint8Array(buffer);
        };

        // Build the data to hash
        const chunks = [
            Uint8Array.from([0x0c]),                                    // len("neuron-stake")
            new TextEncoder().encode("neuron-stake"),                   // "neuron-stake"
            controller.toUint8Array(),                                  // controller principal bytes
            u64be(nonce),                                               // nonce as u64 big-endian
        ];
        
        // Concatenate all chunks
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const data = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            data.set(chunk, offset);
            offset += chunk.length;
        }
        
        // Hash with SHA-256
        const digest = await crypto.subtle.digest("SHA-256", data);
        return new Uint8Array(digest);
    }

    // Stake TACO tokens to a neuron
    const stakeToNeuron = async (neuronId: Uint8Array, amount: bigint) => {
        try {
            if (!userLoggedIn.value) {
                throw new Error('User must be logged in');
            }

            const tacoTokenPrincipal = 'kknbx-zyaaa-aaaaq-aae4a-cai'; // TACO token canister
            const snsGovernancePrincipal = 'lhdfz-wqaaa-aaaaq-aae3q-cai'; // TACO SNS Governance

            // Step 1: Transfer TACO tokens to SNS Governance with neuron ID as subaccount
            // console.log('Transferring TACO tokens to neuron subaccount...');
            await transferToNeuronSubaccount(tacoTokenPrincipal, snsGovernancePrincipal, neuronId, amount);

            // Step 2: Claim/refresh the neuron to recognize the new stake
            // console.log('Claiming/refreshing neuron...');
            await claimOrRefreshNeuron(neuronId);

            // console.log('Staking completed successfully!');
            return true;
        } catch (error: any) {
            console.error('Error staking to neuron:', error);
            throw error;
        }
    }

