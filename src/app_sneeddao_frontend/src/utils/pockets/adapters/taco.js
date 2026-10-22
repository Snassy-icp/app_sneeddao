// TACO exchange balances: a read-only stub behind a flag until TACO's balance and withdraw API is
// checked (spec/pipeline.md, TACO as a swap venue). Listing nothing keeps the wallet unchanged.
export const TACO_URL = 'https://tacodao.com';

export const tacoAdapter = {
    id: 'taco',
    name: 'TACO',
    kind: 'hosted',
    receivesDirectly: false,
    manageUrl: TACO_URL,
    enabled: (ctx) => Boolean(ctx.flags?.taco),
    async listMyAccounts() { return []; },
    async balance() { return { total: 0n, available: 0n, note: `manage at ${TACO_URL}` }; },
};
