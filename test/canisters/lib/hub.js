// Helpers for the Sneed Hub backend (app_sneeddao_backend) tests: Candid of
// its test-only mocks and the shapes its API wants.
import { Principal } from '@icp-sdk/core/principal';

/// ICPSwap's token list canister, hard-coded in the backend; PocketIC makes a
/// subnet for the id when a canister is installed there.
export const ICPSWAP_LIST_ID = Principal.fromText('k37c6-riaaa-aaaag-qcyza-cai');

// test/canisters/canisters/MockHubSns.mo: SNS root + governance in one
export const hubSnsIdl = ({ IDL }) => {
  const NeuronId = IDL.Record({ id: IDL.Vec(IDL.Nat8) });
  const Permission = IDL.Record({ principal: IDL.Opt(IDL.Principal), permission_type: IDL.Vec(IDL.Int32) });
  const Result = IDL.Variant({ ok: IDL.Text, err: IDL.Text });
  return IDL.Service({
    set_neurons: IDL.Func([IDL.Vec(IDL.Record({ id: IDL.Vec(IDL.Nat8), permissions: IDL.Vec(Permission) }))], [], []),
    set_governance: IDL.Func([IDL.Opt(IDL.Principal)], [], []),
    call_verify_neuron_name: IDL.Func([IDL.Principal, IDL.Principal, NeuronId], [Result], []),
    call_unverify_neuron_name: IDL.Func([IDL.Principal, IDL.Principal, NeuronId], [Result], []),
  });
};

// test/canisters/canisters/MockIcpSwapList.mo
export const icpSwapListIdl = ({ IDL }) => IDL.Service({
  set_tokens: IDL.Func([IDL.Vec(IDL.Record({ canisterId: IDL.Text, decimals: IDL.Nat, fee: IDL.Nat, name: IDL.Text, symbol: IDL.Text, standard: IDL.Text }))], [], []),
  set_error: IDL.Func([IDL.Opt(IDL.Text)], [], []),
});

/// A UserSettingsUpdate with every field null except the ones given.
export const settingsUpdate = (over = {}) => ({
  principal_color_coding: [], neuron_color_coding: [], show_vp_bar: [], show_header_notifications: [], collectibles_threshold: [],
  expand_quick_links_on_desktop: [], particle_effects_enabled: [], neuron_manager_cycle_threshold_red: [], neuron_manager_cycle_threshold_orange: [],
  canister_manager_cycle_threshold_red: [], canister_manager_cycle_threshold_orange: [], frontend_auto_update_enabled: [], frontend_clear_cache_on_update: [],
  frontend_update_check_interval_sec: [], frontend_update_countdown_sec: [], swap_slippage_tolerance: [], always_show_remove_token: [], denomination_token: [],
  notify_replies: [], notify_tips: [], notify_messages: [], notify_collectibles: [], notify_votable_proposals: [], notify_outdated_bots: [], notify_low_cycles: [],
  notify_bot_chores: [], notify_bot_log_errors: [], notify_bot_log_warnings: [], notify_updates: [],
  ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, [v]])),
});

/// Order-independent snapshot of a reply (hash map order may change over an upgrade).
export const ser = (x) => JSON.stringify(x, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
export const sorted = (list) => list.map(ser).sort();

/// Upgrade the backend with its own wasm. It is built with
/// --enhanced-orthogonal-persistence (dfx.json), so the upgrade must keep wasm memory.
export const upgradeHub = (pic, canisterId, sender, wasmBytes) =>
  pic.upgradeCanister({ sender, canisterId, wasm: wasmBytes, upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
