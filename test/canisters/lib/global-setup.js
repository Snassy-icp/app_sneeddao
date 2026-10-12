// Starts one PocketIC server for the whole run and hands its URL to the test
// files through vitest's provide/inject.
import { PocketIcServer } from '@dfinity/pic';

export default async function ({ provide }) {
  const server = await PocketIcServer.start({ showRuntimeLogs: false, showCanisterLogs: false });
  provide('PIC_URL', server.getUrl());
  return async () => {
    await server.stop();
  };
}
