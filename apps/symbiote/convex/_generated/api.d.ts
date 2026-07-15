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
import type * as aukoraConstants from "../aukoraConstants.js";
import type * as aukoraCore from "../aukoraCore.js";
import type * as aukoraMerkleLog from "../aukoraMerkleLog.js";
import type * as aukoraPqcSigner from "../aukoraPqcSigner.js";
import type * as aukoraRateLimit from "../aukoraRateLimit.js";
import type * as aukoraReceipts from "../aukoraReceipts.js";
import type * as aukoraRuntime from "../aukoraRuntime.js";
import type * as aukoraSignedHead from "../aukoraSignedHead.js";
import type * as aukoraToken from "../aukoraToken.js";
import type * as aumlokManifests from "../aumlokManifests.js";
import type * as aumlokMemory from "../aumlokMemory.js";
import type * as aumlokRootRegistry from "../aumlokRootRegistry.js";
import type * as popResolver from "../popResolver.js";
import type * as sessionResolver from "../sessionResolver.js";
import type * as tests_legacyV2Fixture from "../tests/legacyV2Fixture.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  aukoraActionRegistry: typeof aukoraActionRegistry;
  aukoraConstants: typeof aukoraConstants;
  aukoraCore: typeof aukoraCore;
  aukoraMerkleLog: typeof aukoraMerkleLog;
  aukoraPqcSigner: typeof aukoraPqcSigner;
  aukoraRateLimit: typeof aukoraRateLimit;
  aukoraReceipts: typeof aukoraReceipts;
  aukoraRuntime: typeof aukoraRuntime;
  aukoraSignedHead: typeof aukoraSignedHead;
  aukoraToken: typeof aukoraToken;
  aumlokManifests: typeof aumlokManifests;
  aumlokMemory: typeof aumlokMemory;
  aumlokRootRegistry: typeof aumlokRootRegistry;
  popResolver: typeof popResolver;
  sessionResolver: typeof sessionResolver;
  "tests/legacyV2Fixture": typeof tests_legacyV2Fixture;
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
