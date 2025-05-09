export const idlFactory = ({ IDL }) => {
  const NeuronId = IDL.Record({ 'id' : IDL.Vec(IDL.Nat8) });
  const ListNeurons = IDL.Record({
    'of_principal' : IDL.Opt(IDL.Principal),
    'limit' : IDL.Nat32,
    'start_page_at' : IDL.Opt(NeuronId),
  });
  const DissolveState = IDL.Variant({
    'DissolveDelaySeconds' : IDL.Nat64,
    'WhenDissolvedTimestampSeconds' : IDL.Nat64,
  });
  const NeuronPermission = IDL.Record({
    'principal' : IDL.Opt(IDL.Principal),
    'permission_type' : IDL.Vec(IDL.Int32),
  });
  const Neuron = IDL.Record({
    'id' : IDL.Opt(NeuronId),
    'staked_maturity_e8s_equivalent' : IDL.Opt(IDL.Nat64),
    'permissions' : IDL.Vec(NeuronPermission),
    'maturity_e8s_equivalent' : IDL.Nat64,
    'cached_neuron_stake_e8s' : IDL.Nat64,
    'created_timestamp_seconds' : IDL.Nat64,
    'aging_since_timestamp_seconds' : IDL.Nat64,
    'dissolve_state' : IDL.Opt(DissolveState),
    'voting_power_percentage_multiplier' : IDL.Nat64,
  });
  const ListNeuronsResponse = IDL.Record({
    'neurons' : IDL.Vec(Neuron),
  });
  
  return IDL.Service({
    'list_neurons' : IDL.Func([ListNeurons], [ListNeuronsResponse], ['query']),
  });
}; 