export const idlFactory = ({ IDL }) => {
  const Version = IDL.Record({
    'major' : IDL.Nat,
    'minor' : IDL.Nat,
    'patch' : IDL.Nat,
  });
  const NeuronId = IDL.Record({ 'id' : IDL.Nat64 });
  const AccountIdentifier = IDL.Vec(IDL.Nat8);
  
  const GovernanceError = IDL.Record({
    'error_message' : IDL.Text,
    'error_type' : IDL.Int32,
  });
  
  const StakeNeuronError = IDL.Variant({
    'GovernanceError' : GovernanceError,
    'InsufficientFunds' : IDL.Record({ 'balance' : IDL.Nat64, 'required' : IDL.Nat64 }),
    'TransferFailed' : IDL.Text,
    'NeuronAlreadyExists' : IDL.Null,
    'InvalidAmount' : IDL.Text,
  });
  
  const StakeNeuronResult = IDL.Variant({
    'Ok' : NeuronId,
    'Err' : StakeNeuronError,
  });
  
  const OperationError = IDL.Variant({
    'GovernanceError' : GovernanceError,
    'InvalidOperation' : IDL.Text,
    'NotAuthorized' : IDL.Null,
    'NeuronNotFound' : IDL.Null,
    'TransferFailed' : IDL.Text,
  });
  
  const OperationResult = IDL.Variant({
    'Ok' : IDL.Null,
    'Err' : OperationError,
  });
  
  const DisburseResult = IDL.Variant({
    'Ok' : IDL.Record({ 'transfer_block_height' : IDL.Nat64 }),
    'Err' : OperationError,
  });
  
  const SpawnResult = IDL.Variant({
    'Ok' : NeuronId,
    'Err' : OperationError,
  });
  
  const SplitResult = IDL.Variant({
    'Ok' : NeuronId,
    'Err' : OperationError,
  });
  
  const Vote = IDL.Variant({
    'Yes' : IDL.Null,
    'No' : IDL.Null,
  });
  
  const Topic = IDL.Int32;
  
  const Follow = IDL.Record({
    'topic' : Topic,
    'followees' : IDL.Vec(NeuronId),
  });
  
  const DissolveState = IDL.Variant({
    'DissolveDelaySeconds' : IDL.Nat64,
    'WhenDissolvedTimestampSeconds' : IDL.Nat64,
  });
  
  const NeuronInfo = IDL.Record({
    'dissolve_delay_seconds' : IDL.Nat64,
    'recent_ballots' : IDL.Vec(IDL.Record({
      'vote' : IDL.Int32,
      'proposal_id' : IDL.Opt(IDL.Record({ 'id' : IDL.Nat64 })),
    })),
    'created_timestamp_seconds' : IDL.Nat64,
    'state' : IDL.Int32,
    'stake_e8s' : IDL.Nat64,
    'joined_community_fund_timestamp_seconds' : IDL.Opt(IDL.Nat64),
    'retrieved_at_timestamp_seconds' : IDL.Nat64,
    'known_neuron_data' : IDL.Opt(IDL.Record({
      'name' : IDL.Text,
      'description' : IDL.Opt(IDL.Text),
    })),
    'voting_power' : IDL.Nat64,
    'age_seconds' : IDL.Nat64,
  });
  
  const NeuronInfoResult = IDL.Variant({
    'Ok' : NeuronInfo,
    'Err' : OperationError,
  });
  
  const FullNeuron = IDL.Record({
    'id' : IDL.Opt(NeuronId),
    'controller' : IDL.Opt(IDL.Principal),
    'recent_ballots' : IDL.Vec(IDL.Record({
      'vote' : IDL.Int32,
      'proposal_id' : IDL.Opt(IDL.Record({ 'id' : IDL.Nat64 })),
    })),
    'kyc_verified' : IDL.Bool,
    'not_for_profit' : IDL.Bool,
    'maturity_e8s_equivalent' : IDL.Nat64,
    'cached_neuron_stake_e8s' : IDL.Nat64,
    'created_timestamp_seconds' : IDL.Nat64,
    'aging_since_timestamp_seconds' : IDL.Nat64,
    'hot_keys' : IDL.Vec(IDL.Principal),
    'account' : IDL.Vec(IDL.Nat8),
    'joined_community_fund_timestamp_seconds' : IDL.Opt(IDL.Nat64),
    'dissolve_state' : IDL.Opt(DissolveState),
    'followees' : IDL.Vec(IDL.Tuple(IDL.Int32, IDL.Record({ 'followees' : IDL.Vec(NeuronId) }))),
    'neuron_fees_e8s' : IDL.Nat64,
    'transfer' : IDL.Opt(IDL.Record({
      'from_subaccount' : IDL.Vec(IDL.Nat8),
      'to_subaccount' : IDL.Vec(IDL.Nat8),
      'memo' : IDL.Nat64,
      'block_height' : IDL.Nat64,
      'neuron_stake_e8s' : IDL.Nat64,
    })),
    'staked_maturity_e8s_equivalent' : IDL.Opt(IDL.Nat64),
    'spawn_at_timestamp_seconds' : IDL.Opt(IDL.Nat64),
  });
  
  const FullNeuronResult = IDL.Variant({
    'Ok' : FullNeuron,
    'Err' : OperationError,
  });

  return IDL.Service({
    // Info queries
    'getOwner' : IDL.Func([], [IDL.Principal], ['query']),
    'getVersion' : IDL.Func([], [Version], ['query']),
    'getNeuronId' : IDL.Func([], [IDL.Opt(NeuronId)], ['query']),
    'getAccountId' : IDL.Func([], [AccountIdentifier], ['query']),
    'getNeuronAccountId' : IDL.Func([], [IDL.Opt(AccountIdentifier)], ['query']),
    'getIcpBalance' : IDL.Func([], [IDL.Nat64], []),
    
    // Neuron info
    'getNeuronInfo' : IDL.Func([], [NeuronInfoResult], []),
    'getFullNeuron' : IDL.Func([], [FullNeuronResult], []),
    
    // Neuron creation
    'stakeNeuron' : IDL.Func([IDL.Nat64], [StakeNeuronResult], []),
    
    // Stake management
    'increaseStake' : IDL.Func([IDL.Nat64], [OperationResult], []),
    
    // Dissolve management
    'setDissolveDelay' : IDL.Func([IDL.Nat64], [OperationResult], []),
    'startDissolving' : IDL.Func([], [OperationResult], []),
    'stopDissolving' : IDL.Func([], [OperationResult], []),
    'disburse' : IDL.Func([IDL.Opt(IDL.Nat64), IDL.Opt(AccountIdentifier)], [DisburseResult], []),
    
    // Maturity management
    'spawnMaturity' : IDL.Func([IDL.Opt(IDL.Nat32)], [SpawnResult], []),
    'mergeMaturity' : IDL.Func([IDL.Nat32], [OperationResult], []),
    'stakeMaturity' : IDL.Func([IDL.Opt(IDL.Nat32)], [OperationResult], []),
    
    // Voting
    'vote' : IDL.Func([IDL.Nat64, Vote], [OperationResult], []),
    'setFollowees' : IDL.Func([Topic, IDL.Vec(NeuronId)], [OperationResult], []),
    
    // Neuron management
    'splitNeuron' : IDL.Func([IDL.Nat64], [SplitResult], []),
    'mergeNeurons' : IDL.Func([NeuronId], [OperationResult], []),
    
    // Hotkey management
    'addHotKey' : IDL.Func([IDL.Principal], [OperationResult], []),
    'removeHotKey' : IDL.Func([IDL.Principal], [OperationResult], []),
  });
};
export const init = ({ IDL }) => { return [IDL.Principal]; };

