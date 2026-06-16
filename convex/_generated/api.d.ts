/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as aukoraActionRegistry from "../aukoraActionRegistry.js";
import type * as aukoraAumlokDerive from "../aukoraAumlokDerive.js";
import type * as aukoraAumlokDictionary from "../aukoraAumlokDictionary.js";
import type * as aukoraChannel from "../aukoraChannel.js";
import type * as aukoraCore from "../aukoraCore.js";
import type * as aukoraMerkleLog from "../aukoraMerkleLog.js";
import type * as aukoraNodeFactory from "../aukoraNodeFactory.js";
import type * as aukoraPqcSigner from "../aukoraPqcSigner.js";
import type * as aukoraRateLimit from "../aukoraRateLimit.js";
import type * as aukoraReceipts from "../aukoraReceipts.js";
import type * as aukoraRuntime from "../aukoraRuntime.js";
import type * as aukoraSignedHead from "../aukoraSignedHead.js";
import type * as aukoraToken from "../aukoraToken.js";
import type * as aukoraWireFormat from "../aukoraWireFormat.js";
import type * as aukoraWireRegistry from "../aukoraWireRegistry.js";
import type * as aukoraWitness from "../aukoraWitness.js";
import type * as aukoraWitnessExport from "../aukoraWitnessExport.js";
import type * as aumlokCeremony from "../aumlokCeremony.js";
import type * as aumlokManifests from "../aumlokManifests.js";
import type * as aumlokMemory from "../aumlokMemory.js";
import type * as aumlokRootRegistry from "../aumlokRootRegistry.js";
import type * as ceremony from "../ceremony.js";
import type * as codeAttestation from "../codeAttestation.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as memory from "../memory.js";
import type * as nodeA from "../nodeA.js";
import type * as nodeB from "../nodeB.js";
import type * as nodeImport from "../nodeImport.js";
import type * as popResolver from "../popResolver.js";
import type * as seed from "../seed.js";
import type * as sessionResolver from "../sessionResolver.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  aukoraActionRegistry: typeof aukoraActionRegistry;
  aukoraAumlokDerive: typeof aukoraAumlokDerive;
  aukoraAumlokDictionary: typeof aukoraAumlokDictionary;
  aukoraChannel: typeof aukoraChannel;
  aukoraCore: typeof aukoraCore;
  aukoraMerkleLog: typeof aukoraMerkleLog;
  aukoraNodeFactory: typeof aukoraNodeFactory;
  aukoraPqcSigner: typeof aukoraPqcSigner;
  aukoraRateLimit: typeof aukoraRateLimit;
  aukoraReceipts: typeof aukoraReceipts;
  aukoraRuntime: typeof aukoraRuntime;
  aukoraSignedHead: typeof aukoraSignedHead;
  aukoraToken: typeof aukoraToken;
  aukoraWireFormat: typeof aukoraWireFormat;
  aukoraWireRegistry: typeof aukoraWireRegistry;
  aukoraWitness: typeof aukoraWitness;
  aukoraWitnessExport: typeof aukoraWitnessExport;
  aumlokCeremony: typeof aumlokCeremony;
  aumlokManifests: typeof aumlokManifests;
  aumlokMemory: typeof aumlokMemory;
  aumlokRootRegistry: typeof aumlokRootRegistry;
  ceremony: typeof ceremony;
  codeAttestation: typeof codeAttestation;
  crons: typeof crons;
  http: typeof http;
  memory: typeof memory;
  nodeA: typeof nodeA;
  nodeB: typeof nodeB;
  nodeImport: typeof nodeImport;
  popResolver: typeof popResolver;
  seed: typeof seed;
  sessionResolver: typeof sessionResolver;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
