export const idlFactory = ({ IDL }) => {
  const Version = IDL.Record({
    'major' : IDL.Nat,
    'minor' : IDL.Nat,
    'patch' : IDL.Nat,
  });
  const NeuronId = IDL.Record({ 'id' : IDL.Nat64 });
  const ManagerInfo = IDL.Record({
    'canisterId' : IDL.Principal,
    'owner' : IDL.Principal,
    'createdAt' : IDL.Int,
    'version' : Version,
    'neuronId' : IDL.Opt(NeuronId),
  });
  const AccountIdentifier = IDL.Vec(IDL.Nat8);
  const CreateManagerError = IDL.Variant({
    'InsufficientCycles' : IDL.Null,
    'CanisterCreationFailed' : IDL.Text,
    'AlreadyExists' : IDL.Null,
    'NotAuthorized' : IDL.Null,
  });
  const CreateManagerResult = IDL.Variant({
    'Ok' : IDL.Record({
      'canisterId' : IDL.Principal,
      'accountId' : AccountIdentifier,
    }),
    'Err' : CreateManagerError,
  });
  return IDL.Service({
    'addAdmin' : IDL.Func([IDL.Principal], [], []),
    'createNeuronManager' : IDL.Func([], [CreateManagerResult], []),
    'getAdmins' : IDL.Func([], [IDL.Vec(IDL.Principal)], ['query']),
    'getAllManagers' : IDL.Func([], [IDL.Vec(ManagerInfo)], ['query']),
    'getCanisterId' : IDL.Func([], [IDL.Principal], ['query']),
    'getCurrentVersion' : IDL.Func([], [Version], ['query']),
    'getCyclesBalance' : IDL.Func([], [IDL.Nat], ['query']),
    'getManagerByCanisterId' : IDL.Func([IDL.Principal], [IDL.Opt(ManagerInfo)], ['query']),
    'getManagerCount' : IDL.Func([], [IDL.Nat], ['query']),
    'getManagersByOwner' : IDL.Func([IDL.Principal], [IDL.Vec(ManagerInfo)], ['query']),
    'getMyManagers' : IDL.Func([], [IDL.Vec(ManagerInfo)], ['query']),
    'removeAdmin' : IDL.Func([IDL.Principal], [], []),
    'setCurrentVersion' : IDL.Func([Version], [], []),
    'updateManagerNeuronId' : IDL.Func([IDL.Principal, IDL.Opt(NeuronId)], [], []),
  });
};
export const init = ({ IDL }) => { return []; };

