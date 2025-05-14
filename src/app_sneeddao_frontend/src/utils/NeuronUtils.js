import { createActor as createSnsGovernanceActor, canisterId as snsGovernanceCanisterId } from 'external/sns_governance';
import { Principal } from '@dfinity/principal';

// Keep track of principals we've already fetched neurons for
const fetchedPrincipals = new Set();

// Helper function to find owner principals from neuron permissions
const getOwnerPrincipals = (neuron) => {
    const owners = new Set();
    // Look for principals with the most permissions
    let maxPermissions = 0;
    
    neuron.permissions.forEach(permission => {
        if (permission.principal) {
            const permCount = permission.permission_type.length;
            if (permCount > maxPermissions) {
                maxPermissions = permCount;
                owners.clear();
                owners.add(permission.principal.toString());
            } else if (permCount === maxPermissions) {
                owners.add(permission.principal.toString());
            }
        }
    });
    
    return Array.from(owners);
};

// Helper function to get neuron ID as string
const getNeuronId = (neuron) => {
    if (!neuron.id || !neuron.id.id) return null;
    // Convert the Blob to hex string for consistent comparison
    return Array.from(neuron.id.id)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
};

export const fetchUserNeurons = async (identity) => {
    if (!identity) return [];
    
    try {
        const snsGovActor = createSnsGovernanceActor(snsGovernanceCanisterId, {
            agentOptions: { identity }
        });

        // Clear the set of fetched principals for this new request
        fetchedPrincipals.clear();
        
        // Start with the user's principal
        const userPrincipal = identity.getPrincipal().toString();
        fetchedPrincipals.add(userPrincipal);
        
        // Initialize result map to store unique neurons by ID
        const neuronsMap = new Map();
        
        // Queue of principals to fetch neurons for
        let principalsToFetch = [userPrincipal];
        
        // Process each principal in the queue
        while (principalsToFetch.length > 0) {
            const currentPrincipal = principalsToFetch.shift();
            
            // Fetch neurons for the current principal
            const result = await snsGovActor.list_neurons({
                of_principal: [Principal.fromText(currentPrincipal)],
                limit: 100,
                start_page_at: []
            });
            
            // Add these neurons to our map, deduplicating by ID
            for (const neuron of result.neurons) {
                const neuronId = getNeuronId(neuron);
                if (neuronId) {
                    neuronsMap.set(neuronId, neuron);
                }
                
                // Find owner principals and add to queue
                const ownerPrincipals = getOwnerPrincipals(neuron);
                for (const ownerPrincipal of ownerPrincipals) {
                    if (!fetchedPrincipals.has(ownerPrincipal)) {
                        fetchedPrincipals.add(ownerPrincipal);
                        principalsToFetch.push(ownerPrincipal);
                    }
                }
            }
        }
        
        // Convert map values back to array
        return Array.from(neuronsMap.values());
    } catch (error) {
        console.error('Error fetching neurons from SNS:', error);
        return [];
    }
}; 