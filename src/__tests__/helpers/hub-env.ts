// hub-grpc throws at import time without HUB_GRPC_ENDPOINT, and several
// test subjects (cast-lookup, cast-sync, haatz-gateway, refresh) import it
// transitively. Static imports evaluate IN ORDER, so importing this file in
// the first position guards the whole import graph — env lines placed after
// the imports run too late (ESM hoisting evaluates the imports first, which
// is exactly how order-dependent failures looked "between tests").
// HUB_GRPC_DISABLED=1 selects the no-client path so no test dials a hub.
process.env.HUB_GRPC_ENDPOINT ??= "grpc://localhost:2283";
process.env.HUB_GRPC_DISABLED = "1";
export {};
