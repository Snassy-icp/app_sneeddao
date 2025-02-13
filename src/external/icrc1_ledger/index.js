import { Actor, HttpAgent } from "@dfinity/agent";

// Imports and re-exports candid interface
import { idlFactory } from "./icrc1_ledger.did.js";
export { idlFactory } from "./icrc1_ledger.did.js";

export const createActor = (canisterId, options = {}) => {
  const agent = options.agent || new HttpAgent({ ...options.agentOptions });

  if (options.agent && options.agentOptions) {
    console.warn(
      "Detected both agent and agentOptions passed to createActor. Ignoring agentOptions and proceeding with the provided agent."
    );
  }

  // Fetch root key for certificate validation during development
  if (process.env.DFX_NETWORK !== "ic") {
    agent.fetchRootKey().catch((err) => {
      console.warn(
        "Unable to fetch root key. Check to ensure that your local replica is running"
      );
      console.error(err);
    });
  }

  // Creates an actor with using the candid interface and the HttpAgent
  return Actor.createActor(idlFactory, {
    agent,
    canisterId,
    ...options.actorOptions,
  });
};

// export const icrc1_ledgers = {
//   CHAT:          '2ouva-viaaa-aaaaq-aaamq-cai',
//   NAUT:          'u2mpw-6yaaa-aaaam-aclrq-cai',
//   DKP:           'zfcdd-tqaaa-aaaaq-aaaga-cai',
//   COW:           'sr5fw-zqaaa-aaaak-qig5q-cai',
//   WUMBO:         'wkv3f-iiaaa-aaaap-ag73a-cai',
//   KINIC:         '73mez-iiaaa-aaaaq-aaasq-cai',
//   GHOST:         '4c4fd-caaaa-aaaaq-aaa3a-cai',
//   HOT:           '6rdgd-kyaaa-aaaaq-aaavq-cai',
//   RICH:          '77xez-aaaaa-aaaar-qaezq-cai',
//   ALIEN:         '7tvr6-fqaaa-aaaan-qmira-cai',
//   ICX:           'rffwt-piaaa-aaaaq-aabqq-cai',
//   MOTOKO:        'k45jy-aiaaa-aaaaq-aadcq-cai',
//   MOD:           'xsi2v-cyaaa-aaaaq-aabfq-cai',
//   CHUGGA:        'epev2-gaaaa-aaaam-aci7a-cai',
//   DOBO:          'pksv5-aaaaa-aaaap-aha3q-cai',
//   ROS:           'a6a37-7yaaa-aaaai-qpeuq-cai',
//   WEN:           'hwr24-lyaaa-aaaap-ahbpa-cai',
//   BOOM:          'vtrom-gqaaa-aaaaq-aabia-cai',
//   CTZ:           'uf2wh-taaaa-aaaaq-aabna-cai',
//   SNEED:         'hvgxa-wqaaa-aaaaq-aacia-cai',
//   NUA:           'rxdbk-dyaaa-aaaaq-aabtq-cai',
//   INSANE:        'nwd3n-qaaaa-aaaak-afmda-cai',
//   PEPE:          'o2ul2-3aaaa-aaaak-afmja-cai',
//   TempleOS:      'nattc-jqaaa-aaaak-afl5q-cai',
//   MCS:           '67mu5-maaaa-aaaar-qadca-cai',
//   MacOS:         'dikjh-xaaaa-aaaak-afnba-cai',
//   UNIX:          'czaxy-piaaa-aaaak-afneq-cai',
//   RENEGADE:      'kttqw-5aaaa-aaaak-afloq-cai',
//   SDOGE:         'ghvlc-vqaaa-aaaan-qlsca-cai',
//   iVishnu:       'kz5t3-pyaaa-aaaap-ab2qq-cai',
//   CGST:          'mwgzv-jqaaa-aaaam-acfha-cai',
//   MIF:           'iczfn-iiaaa-aaaan-qltcq-cai',
//   DAMONIC:       'zzsnb-aaaaa-aaaap-ag66q-cai',
// };