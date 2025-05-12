export const idlFactory = ({ IDL }) => {
    const ArchivedTransactionResponse = IDL.Rec();
    const Value = IDL.Rec();
    const Info = IDL.Record({
      'pending' : IDL.Nat,
      'last_indexed_tx' : IDL.Nat,
      'errors' : IDL.Nat,
      'lastTxTime' : IDL.Nat64,
      'accounts' : IDL.Nat,
      'actor_principal' : IDL.Opt(IDL.Principal),
      'reader_instructions_cost' : IDL.Nat64,
      'sender_instructions_cost' : IDL.Nat64,
    });
    const Info__1 = IDL.Record({
      'pending' : IDL.Nat,
      'last_indexed_tx' : IDL.Nat,
      'errors' : IDL.Nat,
      'lastTxTime' : IDL.Nat64,
      'accounts' : IDL.Nat,
      'actor_principal' : IDL.Principal,
      'reader_instructions_cost' : IDL.Nat64,
      'sender_instructions_cost' : IDL.Nat64,
    });
    const LedgerInfo__1 = IDL.Record({
      'id' : IDL.Principal,
      'info' : IDL.Variant({ 'icp' : Info, 'icrc' : Info__1 }),
    });
    const GetArchivesArgs = IDL.Record({ 'from' : IDL.Opt(IDL.Principal) });
    const GetArchivesResultItem = IDL.Record({
      'end' : IDL.Nat,
      'canister_id' : IDL.Principal,
      'start' : IDL.Nat,
    });
    const GetArchivesResult = IDL.Vec(GetArchivesResultItem);
    const TransactionRange = IDL.Record({
      'start' : IDL.Nat,
      'length' : IDL.Nat,
    });
    const GetBlocksArgs = IDL.Vec(TransactionRange);
    const ValueMap = IDL.Tuple(IDL.Text, Value);
    Value.fill(
      IDL.Variant({
        'Int' : IDL.Int,
        'Map' : IDL.Vec(ValueMap),
        'Nat' : IDL.Nat,
        'Blob' : IDL.Vec(IDL.Nat8),
        'Text' : IDL.Text,
        'Array' : IDL.Vec(Value),
      })
    );
    const GetTransactionsResult = IDL.Record({
      'log_length' : IDL.Nat,
      'blocks' : IDL.Vec(
        IDL.Record({ 'id' : IDL.Nat, 'block' : IDL.Opt(Value) })
      ),
      'archived_blocks' : IDL.Vec(ArchivedTransactionResponse),
    });
    const GetTransactionsFn = IDL.Func(
        [IDL.Vec(TransactionRange)],
        [GetTransactionsResult],
        ['query'],
      );
    ArchivedTransactionResponse.fill(
      IDL.Record({
        'args' : IDL.Vec(TransactionRange),
        'callback' : GetTransactionsFn,
      })
    );
    const GetBlocksResult = IDL.Record({
      'log_length' : IDL.Nat,
      'blocks' : IDL.Vec(
        IDL.Record({ 'id' : IDL.Nat, 'block' : IDL.Opt(Value) })
      ),
      'archived_blocks' : IDL.Vec(ArchivedTransactionResponse),
    });
    const DataCertificate = IDL.Record({
      'certificate' : IDL.Vec(IDL.Nat8),
      'hash_tree' : IDL.Vec(IDL.Nat8),
    });
    const BlockType = IDL.Record({ 'url' : IDL.Text, 'block_type' : IDL.Text });
    const Account = IDL.Record({
      'owner' : IDL.Principal,
      'subaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    });
    const AccountsRequest = IDL.Record({
      'owner' : IDL.Principal,
      'subaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    });
    const EndpointIC = IDL.Record({
      'ledger' : IDL.Principal,
      'account' : Account,
    });
    const EndpointOther = IDL.Record({
      'platform' : IDL.Nat64,
      'ledger' : IDL.Vec(IDL.Nat8),
      'account' : IDL.Vec(IDL.Nat8),
    });
    const Endpoint = IDL.Variant({ 'ic' : EndpointIC, 'other' : EndpointOther });
    const AccountEndpoint = IDL.Record({
      'balance' : IDL.Nat,
      'endpoint' : Endpoint,
    });
    const AccountsResponse = IDL.Vec(AccountEndpoint);
    const Controller = IDL.Record({
      'owner' : IDL.Principal,
      'subaccount' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    });
    const LocalNodeId = IDL.Nat32;
    const EndpointIdx = IDL.Nat8;
    const InputAddress = IDL.Variant({
      'ic' : Account,
      'other' : IDL.Vec(IDL.Nat8),
      'temp' : IDL.Record({ 'id' : IDL.Nat32, 'source_idx' : EndpointIdx }),
    });
    const CommonModifyRequest = IDL.Record({
      'active' : IDL.Opt(IDL.Bool),
      'controllers' : IDL.Opt(IDL.Vec(Controller)),
      'extractors' : IDL.Opt(IDL.Vec(LocalNodeId)),
      'destinations' : IDL.Opt(IDL.Vec(IDL.Opt(InputAddress))),
      'sources' : IDL.Opt(IDL.Vec(IDL.Opt(InputAddress))),
      'refund' : IDL.Opt(Account),
    });
    const DissolveDelay = IDL.Variant({
      'Default' : IDL.Null,
      'DelayDays' : IDL.Nat64,
    });
    const DissolveStatus = IDL.Variant({
      'Locked' : IDL.Null,
      'Dissolving' : IDL.Null,
    });
    const Followee = IDL.Variant({
      'Default' : IDL.Null,
      'FolloweeId' : IDL.Nat64,
    });
    const ModifyRequest__1 = IDL.Record({
      'dissolve_delay' : IDL.Opt(DissolveDelay),
      'dissolve_status' : IDL.Opt(DissolveStatus),
      'followee' : IDL.Opt(Followee),
    });
    const SnsDissolveDelay = IDL.Variant({
      'Default' : IDL.Null,
      'DelayDays' : IDL.Nat64,
    });
    const SnsDissolveStatus = IDL.Variant({
      'Locked' : IDL.Null,
      'Dissolving' : IDL.Null,
    });
    const SnsFollowee = IDL.Variant({
      'FolloweeId' : IDL.Vec(IDL.Nat8),
      'Unspecified' : IDL.Null,
    });
    const ModifyRequest__2 = IDL.Record({
      'dissolve_delay' : IDL.Opt(SnsDissolveDelay),
      'dissolve_status' : IDL.Opt(SnsDissolveStatus),
      'followee' : IDL.Opt(SnsFollowee),
    });
    const ModifyRequest__3 = IDL.Record({ 'split' : IDL.Vec(IDL.Nat) });
    const ModifyRequest = IDL.Variant({
      'devefi_jes1_icpneuron' : ModifyRequest__1,
      'devefi_jes1_snsneuron' : ModifyRequest__2,
      'devefi_split' : ModifyRequest__3,
    });
    const ModifyNodeRequest = IDL.Tuple(
      LocalNodeId,
      IDL.Opt(CommonModifyRequest),
      IDL.Opt(ModifyRequest),
    );
    const SupportedLedger = IDL.Variant({
      'ic' : IDL.Principal,
      'other' : IDL.Record({
        'platform' : IDL.Nat64,
        'ledger' : IDL.Vec(IDL.Nat8),
      }),
    });
    const CommonCreateRequest = IDL.Record({
      'controllers' : IDL.Vec(Controller),
      'initial_billing_amount' : IDL.Opt(IDL.Nat),
      'extractors' : IDL.Vec(LocalNodeId),
      'temp_id' : IDL.Nat32,
      'billing_option' : IDL.Nat,
      'destinations' : IDL.Vec(IDL.Opt(InputAddress)),
      'sources' : IDL.Vec(IDL.Opt(InputAddress)),
      'affiliate' : IDL.Opt(Account),
      'ledgers' : IDL.Vec(SupportedLedger),
      'temporary' : IDL.Bool,
      'refund' : Account,
    });
    const CreateRequest__1 = IDL.Record({
      'variables' : IDL.Record({
        'dissolve_delay' : DissolveDelay,
        'dissolve_status' : DissolveStatus,
        'followee' : Followee,
      }),
    });
    const CreateRequest__2 = IDL.Record({
      'variables' : IDL.Record({
        'dissolve_delay' : SnsDissolveDelay,
        'dissolve_status' : SnsDissolveStatus,
        'followee' : SnsFollowee,
      }),
    });
    const CreateRequest__3 = IDL.Record({
      'variables' : IDL.Record({ 'split' : IDL.Vec(IDL.Nat) }),
    });
    const CreateRequest = IDL.Variant({
      'devefi_jes1_icpneuron' : CreateRequest__1,
      'devefi_jes1_snsneuron' : CreateRequest__2,
      'devefi_split' : CreateRequest__3,
    });
    const CreateNodeRequest = IDL.Tuple(CommonCreateRequest, CreateRequest);
    const TransferRequest = IDL.Record({
      'to' : IDL.Variant({
        'node_billing' : LocalNodeId,
        'node' : IDL.Record({
          'node_id' : LocalNodeId,
          'endpoint_idx' : EndpointIdx,
        }),
        'temp' : IDL.Record({ 'id' : IDL.Nat32, 'source_idx' : EndpointIdx }),
        'external_account' : IDL.Variant({
          'ic' : Account,
          'other' : IDL.Vec(IDL.Nat8),
        }),
        'account' : Account,
      }),
      'from' : IDL.Variant({
        'node' : IDL.Record({
          'node_id' : LocalNodeId,
          'endpoint_idx' : EndpointIdx,
        }),
        'account' : Account,
      }),
      'ledger' : SupportedLedger,
      'amount' : IDL.Nat,
    });
    const Command = IDL.Variant({
      'modify_node' : ModifyNodeRequest,
      'create_node' : CreateNodeRequest,
      'transfer' : TransferRequest,
      'delete_node' : LocalNodeId,
    });
    const BatchCommandRequest = IDL.Record({
      'request_id' : IDL.Opt(IDL.Nat32),
      'controller' : Controller,
      'signature' : IDL.Opt(IDL.Vec(IDL.Nat8)),
      'expire_at' : IDL.Opt(IDL.Nat64),
      'commands' : IDL.Vec(Command),
    });
    const Activity = IDL.Variant({
      'Ok' : IDL.Record({ 'operation' : IDL.Text, 'timestamp' : IDL.Nat64 }),
      'Err' : IDL.Record({
        'msg' : IDL.Text,
        'operation' : IDL.Text,
        'timestamp' : IDL.Nat64,
      }),
    });
    const UpdatingStatus = IDL.Variant({
      'Calling' : IDL.Nat64,
      'Done' : IDL.Nat64,
      'Init' : IDL.Null,
    });
    const SharedNeuronCache = IDL.Record({
      'dissolve_delay_seconds' : IDL.Opt(IDL.Nat64),
      'voting_power_refreshed_timestamp_seconds' : IDL.Opt(IDL.Nat64),
      'potential_voting_power' : IDL.Opt(IDL.Nat64),
      'maturity_e8s_equivalent' : IDL.Opt(IDL.Nat64),
      'deciding_voting_power' : IDL.Opt(IDL.Nat64),
      'cached_neuron_stake_e8s' : IDL.Opt(IDL.Nat64),
      'created_timestamp_seconds' : IDL.Opt(IDL.Nat64),
      'state' : IDL.Opt(IDL.Int32),
      'nonce' : IDL.Opt(IDL.Nat64),
      'followees' : IDL.Vec(
        IDL.Tuple(
          IDL.Int32,
          IDL.Record({ 'followees' : IDL.Vec(IDL.Record({ 'id' : IDL.Nat64 })) }),
        )
      ),
      'voting_power' : IDL.Opt(IDL.Nat64),
      'neuron_id' : IDL.Opt(IDL.Nat64),
      'age_seconds' : IDL.Opt(IDL.Nat64),
    });
    const Shared__1 = IDL.Record({
      'log' : IDL.Vec(Activity),
      'internals' : IDL.Record({
        'local_idx' : IDL.Nat32,
        'refresh_idx' : IDL.Opt(IDL.Nat64),
        'updating' : UpdatingStatus,
        'spawning_neurons' : IDL.Vec(SharedNeuronCache),
      }),
      'cache' : SharedNeuronCache,
      'variables' : IDL.Record({
        'dissolve_delay' : DissolveDelay,
        'dissolve_status' : DissolveStatus,
        'followee' : Followee,
      }),
    });
    const SnsNeuronActivity = IDL.Variant({
      'Ok' : IDL.Record({ 'operation' : IDL.Text, 'timestamp' : IDL.Nat64 }),
      'Err' : IDL.Record({
        'msg' : IDL.Text,
        'operation' : IDL.Text,
        'timestamp' : IDL.Nat64,
      }),
    });
    const SnsNeuronUpdatingStatus = IDL.Variant({
      'Calling' : IDL.Nat64,
      'Done' : IDL.Nat64,
      'Init' : IDL.Null,
    });
    const SnsParametersCache = IDL.Record({
      'default_followees' : IDL.Opt(
        IDL.Record({
          'followees' : IDL.Vec(
            IDL.Tuple(
              IDL.Nat64,
              IDL.Record({
                'followees' : IDL.Vec(IDL.Record({ 'id' : IDL.Vec(IDL.Nat8) })),
              }),
            )
          ),
        })
      ),
      'max_dissolve_delay_seconds' : IDL.Opt(IDL.Nat64),
      'max_dissolve_delay_bonus_percentage' : IDL.Opt(IDL.Nat64),
      'max_followees_per_function' : IDL.Opt(IDL.Nat64),
      'neuron_claimer_permissions' : IDL.Opt(
        IDL.Record({ 'permissions' : IDL.Vec(IDL.Int32) })
      ),
      'neuron_minimum_stake_e8s' : IDL.Opt(IDL.Nat64),
      'max_neuron_age_for_age_bonus' : IDL.Opt(IDL.Nat64),
      'initial_voting_period_seconds' : IDL.Opt(IDL.Nat64),
      'neuron_minimum_dissolve_delay_to_vote_seconds' : IDL.Opt(IDL.Nat64),
      'reject_cost_e8s' : IDL.Opt(IDL.Nat64),
      'max_proposals_to_keep_per_action' : IDL.Opt(IDL.Nat32),
      'wait_for_quiet_deadline_increase_seconds' : IDL.Opt(IDL.Nat64),
      'max_number_of_neurons' : IDL.Opt(IDL.Nat64),
      'transaction_fee_e8s' : IDL.Opt(IDL.Nat64),
      'max_number_of_proposals_with_ballots' : IDL.Opt(IDL.Nat64),
      'max_age_bonus_percentage' : IDL.Opt(IDL.Nat64),
      'neuron_grantable_permissions' : IDL.Opt(
        IDL.Record({ 'permissions' : IDL.Vec(IDL.Int32) })
      ),
      'voting_rewards_parameters' : IDL.Opt(
        IDL.Record({
          'final_reward_rate_basis_points' : IDL.Opt(IDL.Nat64),
          'initial_reward_rate_basis_points' : IDL.Opt(IDL.Nat64),
          'reward_rate_transition_duration_seconds' : IDL.Opt(IDL.Nat64),
          'round_duration_seconds' : IDL.Opt(IDL.Nat64),
        })
      ),
      'maturity_modulation_disabled' : IDL.Opt(IDL.Bool),
      'max_number_of_principals_per_neuron' : IDL.Opt(IDL.Nat64),
    });
    const SnsNeuronCache = IDL.Record({
      'id' : IDL.Opt(IDL.Record({ 'id' : IDL.Vec(IDL.Nat8) })),
      'permissions' : IDL.Vec(
        IDL.Record({
          'principal' : IDL.Opt(IDL.Principal),
          'permission_type' : IDL.Vec(IDL.Int32),
        })
      ),
      'maturity_e8s_equivalent' : IDL.Nat64,
      'cached_neuron_stake_e8s' : IDL.Nat64,
      'created_timestamp_seconds' : IDL.Nat64,
      'source_nns_neuron_id' : IDL.Opt(IDL.Nat64),
      'auto_stake_maturity' : IDL.Opt(IDL.Bool),
      'aging_since_timestamp_seconds' : IDL.Nat64,
      'dissolve_state' : IDL.Opt(
        IDL.Variant({
          'DissolveDelaySeconds' : IDL.Nat64,
          'WhenDissolvedTimestampSeconds' : IDL.Nat64,
        })
      ),
      'voting_power_percentage_multiplier' : IDL.Nat64,
      'vesting_period_seconds' : IDL.Opt(IDL.Nat64),
      'disburse_maturity_in_progress' : IDL.Vec(
        IDL.Record({
          'timestamp_of_disbursement_seconds' : IDL.Nat64,
          'amount_e8s' : IDL.Nat64,
          'account_to_disburse_to' : IDL.Opt(
            IDL.Record({
              'owner' : IDL.Opt(IDL.Principal),
              'subaccount' : IDL.Opt(
                IDL.Record({ 'subaccount' : IDL.Vec(IDL.Nat8) })
              ),
            })
          ),
          'finalize_disbursement_timestamp_seconds' : IDL.Opt(IDL.Nat64),
        })
      ),
      'followees' : IDL.Vec(
        IDL.Tuple(
          IDL.Nat64,
          IDL.Record({
            'followees' : IDL.Vec(IDL.Record({ 'id' : IDL.Vec(IDL.Nat8) })),
          }),
        )
      ),
      'neuron_fees_e8s' : IDL.Nat64,
    });
    const Shared__2 = IDL.Record({
      'log' : IDL.Vec(SnsNeuronActivity),
      'internals' : IDL.Record({
        'neuron_state' : IDL.Opt(IDL.Int32),
        'governance_canister' : IDL.Opt(IDL.Principal),
        'neuron_claimed' : IDL.Bool,
        'refresh_idx' : IDL.Opt(IDL.Nat64),
        'updating' : SnsNeuronUpdatingStatus,
      }),
      'parameters_cache' : IDL.Opt(SnsParametersCache),
      'variables' : IDL.Record({
        'dissolve_delay' : SnsDissolveDelay,
        'dissolve_status' : SnsDissolveStatus,
        'followee' : SnsFollowee,
      }),
      'neuron_cache' : IDL.Opt(SnsNeuronCache),
    });
    const Shared__3 = IDL.Record({
      'variables' : IDL.Record({ 'split' : IDL.Vec(IDL.Nat) }),
    });
    const Shared = IDL.Variant({
      'devefi_jes1_icpneuron' : Shared__1,
      'devefi_jes1_snsneuron' : Shared__2,
      'devefi_split' : Shared__3,
    });
    const BillingTransactionFee = IDL.Variant({
      'none' : IDL.Null,
      'transaction_percentage_fee_e8s' : IDL.Nat,
      'flat_fee_multiplier' : IDL.Nat,
    });
    const EndpointOptIC = IDL.Record({
      'ledger' : IDL.Principal,
      'account' : IDL.Opt(Account),
    });
    const EndpointOptOther = IDL.Record({
      'platform' : IDL.Nat64,
      'ledger' : IDL.Vec(IDL.Nat8),
      'account' : IDL.Opt(IDL.Vec(IDL.Nat8)),
    });
    const EndpointOpt = IDL.Variant({
      'ic' : EndpointOptIC,
      'other' : EndpointOptOther,
    });
    const DestinationEndpointResp = IDL.Record({
      'endpoint' : EndpointOpt,
      'name' : IDL.Text,
    });
    const SourceEndpointResp = IDL.Record({
      'balance' : IDL.Nat,
      'endpoint' : Endpoint,
      'name' : IDL.Text,
    });
    const GetNodeResponse = IDL.Record({
      'id' : LocalNodeId,
      'created' : IDL.Nat64,
      'active' : IDL.Bool,
      'modified' : IDL.Nat64,
      'controllers' : IDL.Vec(Controller),
      'custom' : IDL.Opt(Shared),
      'extractors' : IDL.Vec(LocalNodeId),
      'billing' : IDL.Record({
        'transaction_fee' : BillingTransactionFee,
        'expires' : IDL.Opt(IDL.Nat64),
        'current_balance' : IDL.Nat,
        'billing_option' : IDL.Nat,
        'account' : Account,
        'frozen' : IDL.Bool,
        'cost_per_day' : IDL.Nat,
      }),
      'destinations' : IDL.Vec(DestinationEndpointResp),
      'sources' : IDL.Vec(SourceEndpointResp),
      'refund' : Account,
    });
    const ModifyNodeResponse = IDL.Variant({
      'ok' : GetNodeResponse,
      'err' : IDL.Text,
    });
    const CreateNodeResponse = IDL.Variant({
      'ok' : GetNodeResponse,
      'err' : IDL.Text,
    });
    const TransferResponse = IDL.Variant({ 'ok' : IDL.Nat64, 'err' : IDL.Text });
    const DeleteNodeResp = IDL.Variant({ 'ok' : IDL.Null, 'err' : IDL.Text });
    const CommandResponse = IDL.Variant({
      'modify_node' : ModifyNodeResponse,
      'create_node' : CreateNodeResponse,
      'transfer' : TransferResponse,
      'delete_node' : DeleteNodeResp,
    });
    const BatchCommandResponse = IDL.Variant({
      'ok' : IDL.Record({
        'id' : IDL.Opt(IDL.Nat),
        'commands' : IDL.Vec(CommandResponse),
      }),
      'err' : IDL.Variant({
        'caller_not_controller' : IDL.Null,
        'expired' : IDL.Null,
        'other' : IDL.Text,
        'duplicate' : IDL.Nat,
        'invalid_signature' : IDL.Null,
      }),
    });
    const ValidationResult = IDL.Variant({ 'Ok' : IDL.Text, 'Err' : IDL.Text });
    const GetControllerNodesRequest = IDL.Record({
      'id' : Controller,
      'start' : LocalNodeId,
      'length' : IDL.Nat32,
    });
    const NodeShared = IDL.Record({
      'id' : LocalNodeId,
      'created' : IDL.Nat64,
      'active' : IDL.Bool,
      'modified' : IDL.Nat64,
      'controllers' : IDL.Vec(Controller),
      'custom' : IDL.Opt(Shared),
      'extractors' : IDL.Vec(LocalNodeId),
      'billing' : IDL.Record({
        'transaction_fee' : BillingTransactionFee,
        'expires' : IDL.Opt(IDL.Nat64),
        'current_balance' : IDL.Nat,
        'billing_option' : IDL.Nat,
        'account' : Account,
        'frozen' : IDL.Bool,
        'cost_per_day' : IDL.Nat,
      }),
      'destinations' : IDL.Vec(DestinationEndpointResp),
      'sources' : IDL.Vec(SourceEndpointResp),
      'refund' : Account,
    });
    const GetNode = IDL.Variant({ 'id' : LocalNodeId, 'endpoint' : Endpoint });
    const BillingFeeSplit = IDL.Record({
      'platform' : IDL.Nat,
      'author' : IDL.Nat,
      'affiliate' : IDL.Nat,
      'pylon' : IDL.Nat,
    });
    const BillingPylon = IDL.Record({
      'operation_cost' : IDL.Nat,
      'freezing_threshold_days' : IDL.Nat,
      'min_create_balance' : IDL.Nat,
      'split' : BillingFeeSplit,
      'ledger' : IDL.Principal,
      'platform_account' : Account,
      'pylon_account' : Account,
    });
    const LedgerInfo = IDL.Record({
      'fee' : IDL.Nat,
      'decimals' : IDL.Nat8,
      'name' : IDL.Text,
      'ledger' : SupportedLedger,
      'symbol' : IDL.Text,
    });
    const Billing = IDL.Record({
      'transaction_fee' : BillingTransactionFee,
      'cost_per_day' : IDL.Nat,
    });
    const Version = IDL.Variant({
      'alpha' : IDL.Vec(IDL.Nat16),
      'beta' : IDL.Vec(IDL.Nat16),
      'release' : IDL.Vec(IDL.Nat16),
    });
    const LedgerIdx = IDL.Nat;
    const LedgerLabel = IDL.Text;
    const EndpointsDescription = IDL.Vec(IDL.Tuple(LedgerIdx, LedgerLabel));
    const ModuleMeta = IDL.Record({
      'id' : IDL.Text,
      'create_allowed' : IDL.Bool,
      'ledger_slots' : IDL.Vec(IDL.Text),
      'name' : IDL.Text,
      'billing' : IDL.Vec(Billing),
      'description' : IDL.Text,
      'supported_ledgers' : IDL.Vec(SupportedLedger),
      'author' : IDL.Text,
      'version' : Version,
      'destinations' : EndpointsDescription,
      'sources' : EndpointsDescription,
      'temporary_allowed' : IDL.Bool,
      'author_account' : Account,
    });
    const PylonMetaResp = IDL.Record({
      'name' : IDL.Text,
      'billing' : BillingPylon,
      'supported_ledgers' : IDL.Vec(LedgerInfo),
      'request_max_expire_sec' : IDL.Nat64,
      'governed_by' : IDL.Text,
      'temporary_nodes' : IDL.Record({
        'allowed' : IDL.Bool,
        'expire_sec' : IDL.Nat64,
      }),
      'modules' : IDL.Vec(ModuleMeta),
    });
    return IDL.Service({
      'add_supported_ledger' : IDL.Func(
          [IDL.Principal, IDL.Variant({ 'icp' : IDL.Null, 'icrc' : IDL.Null })],
          [],
          ['oneway'],
        ),
      'get_ledger_errors' : IDL.Func([], [IDL.Vec(IDL.Vec(IDL.Text))], ['query']),
      'get_ledgers_info' : IDL.Func([], [IDL.Vec(LedgerInfo__1)], ['query']),
      'icrc3_get_archives' : IDL.Func(
          [GetArchivesArgs],
          [GetArchivesResult],
          ['query'],
        ),
      'icrc3_get_blocks' : IDL.Func(
          [GetBlocksArgs],
          [GetBlocksResult],
          ['query'],
        ),
      'icrc3_get_tip_certificate' : IDL.Func(
          [],
          [IDL.Opt(DataCertificate)],
          ['query'],
        ),
      'icrc3_supported_block_types' : IDL.Func(
          [],
          [IDL.Vec(BlockType)],
          ['query'],
        ),
      'icrc55_account_register' : IDL.Func([Account], [], []),
      'icrc55_accounts' : IDL.Func(
          [AccountsRequest],
          [AccountsResponse],
          ['query'],
        ),
      'icrc55_command' : IDL.Func(
          [BatchCommandRequest],
          [BatchCommandResponse],
          [],
        ),
      'icrc55_command_validate' : IDL.Func(
          [BatchCommandRequest],
          [ValidationResult],
          ['query'],
        ),
      'icrc55_get_controller_nodes' : IDL.Func(
          [GetControllerNodesRequest],
          [IDL.Vec(NodeShared)],
          ['query'],
        ),
      'icrc55_get_defaults' : IDL.Func([IDL.Text], [CreateRequest], ['query']),
      'icrc55_get_nodes' : IDL.Func(
          [IDL.Vec(GetNode)],
          [IDL.Vec(IDL.Opt(NodeShared))],
          ['query'],
        ),
      'icrc55_get_pylon_meta' : IDL.Func([], [PylonMetaResp], ['query']),
    });
  };
  export const init = ({ IDL }) => { return []; };