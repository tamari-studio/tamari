// The env names the hosted RPC route sets for the verified member behind a call (rpc.ts).
// Space code reads them through @miso/caller (packages/caller, mapped by
// app/build/plugins.ts like @miso/store). The names are a contract between the two repos:
// caller.test.ts checks them against the spaces checkout whenever it has the package.
export const CALLER_EMAIL_ENV = 'MISO_CALLER_EMAIL'
export const CALLER_ID_ENV = 'MISO_CALLER_ID'
