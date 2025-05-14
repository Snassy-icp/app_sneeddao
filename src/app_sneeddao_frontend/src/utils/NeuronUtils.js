import { createSnsGovernanceActor } from '../declarations/sns_governance';
import { snsGovernanceCanisterId } from '../constants';

export const fetchUserNeurons = async (identity) => {
    if (!identity) return [];
    
    try {
        const snsGovActor = createSnsGovernanceActor(snsGovernanceCanisterId, {
            agentOptions: { identity }
        });
        const result = await snsGovActor.list_neurons({
            of_principal: [identity.getPrincipal()],
            limit: 100,
            start_page_at: []
        });
        return result.neurons;
    } catch (error) {
        console.error('Error fetching neurons from SNS:', error);
        return [];
    }
}; 