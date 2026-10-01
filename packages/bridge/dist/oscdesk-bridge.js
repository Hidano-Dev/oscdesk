"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  BridgeMainError: () => BridgeMainError,
  DEFAULT_UI_PORT: () => DEFAULT_UI_PORT,
  DEFAULT_WS_PORT: () => DEFAULT_WS_PORT,
  composeBridgeConfig: () => composeBridgeConfig,
  exitCodeFor: () => exitCodeFor,
  main: () => main,
  parseCliArgs: () => parseCliArgs,
  startBridgeServer: () => startBridgeServer
});
module.exports = __toCommonJS(index_exports);

// src/config.ts
var import_node_fs = __toESM(require("node:fs"));
var import_node_path = __toESM(require("node:path"));

// ../shared/src/osc-types.ts
var OSC_IMMEDIATE_TIME_TAG = {
  seconds: 0,
  fractions: 1
};

// ../shared/src/address-pattern.ts
function isValidAddressShape(address) {
  return address.startsWith("/") && address.length > 1 && !address.endsWith("/") && !address.includes("//") && !address.split("/").slice(1).some((part) => part.length === 0) && ![...address].some((character) => "?[]{},".includes(character));
}

// ../shared/src/limits.ts
var MANIFEST_SIZE = {
  RECOMMENDED_BYTES: 1400,
  WARNING_BYTES: 56 * 1024,
  PRACTICAL_LIMIT_BYTES: 60 * 1024
};
var OSC_BATCH = {
  MAX_MESSAGES: 512,
  PRACTICAL_LIMIT_BYTES: 60 * 1024
};

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path: path7, errorMaps, issueData } = params;
  const fullPath = [...path7, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  constructor(parent, value, path7, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path7;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {
      } else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
var ZodEnum = class _ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: (arg) => ZodString.create({ ...arg, coerce: true }),
  number: (arg) => ZodNumber.create({ ...arg, coerce: true }),
  boolean: (arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  }),
  bigint: (arg) => ZodBigInt.create({ ...arg, coerce: true }),
  date: (arg) => ZodDate.create({ ...arg, coerce: true })
};
var NEVER = INVALID;

// ../shared/src/schemas.ts
var nonNegativeInt = external_exports.number().int().nonnegative();
var positiveInt = external_exports.number().int().positive();
var iso8601Timestamp = external_exports.string().datetime({ offset: true });
var oscAddress = external_exports.string().startsWith("/");
var bootIdSchema = external_exports.string().min(1).max(64);
var structureGenerationSchema = external_exports.number().int().min(0).max(2147483647);
var ManifestOriginSchema = external_exports.object({
  bootId: bootIdSchema,
  structureGeneration: structureGenerationSchema
});
var originFields = {
  bootId: bootIdSchema.optional(),
  structureGeneration: structureGenerationSchema.optional()
};
function requireOriginPair(value, context) {
  if (value.bootId === void 0 !== (value.structureGeneration === void 0)) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: [value.bootId === void 0 ? "bootId" : "structureGeneration"],
      message: "bootId and structureGeneration must be provided together"
    });
  }
}
var StatsPayloadSchema = external_exports.object({
  received: nonNegativeInt,
  parseErrors: nonNegativeInt,
  lastReceivedAt: iso8601Timestamp,
  ...originFields
}).superRefine(requireOriginPair);
var ManifestEntryBaseSchema = external_exports.object({
  address: oscAddress,
  label: external_exports.string(),
  type: external_exports.enum(["i", "f", "s", "b", "bool"]),
  widget: external_exports.enum(["fader", "button", "toggle", "xy", "text", "input", "select"]),
  range: external_exports.tuple([external_exports.number(), external_exports.number()]).optional(),
  default: external_exports.union([external_exports.number(), external_exports.string(), external_exports.boolean()]).optional(),
  group: external_exports.string().optional(),
  options: external_exports.array(external_exports.string()).optional(),
  optionsRef: external_exports.string().optional(),
  pattern: external_exports.string().optional(),
  staged: external_exports.literal(true).optional(),
  appliesTo: external_exports.array(external_exports.string()).min(1).optional()
});
var ManifestEntrySchema = ManifestEntryBaseSchema.superRefine((entry, context) => {
  if (entry.widget === "input" && !["s", "i", "f"].includes(entry.type)) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["type"],
      message: "input widget requires type s, i, or f"
    });
  }
  if (entry.widget === "select" && entry.type !== "s") {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["type"],
      message: "select widget requires type s"
    });
  }
  if (entry.widget === "select" && entry.options !== void 0 && entry.optionsRef !== void 0) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["optionsRef"],
      message: "select widget cannot define both options and optionsRef"
    });
  }
  if (entry.widget === "select" && entry.options === void 0 && entry.optionsRef === void 0) {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["options"],
      message: "select widget requires options or optionsRef"
    });
  }
  if (entry.pattern !== void 0) {
    if (entry.type !== "s") {
      context.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["pattern"],
        message: "pattern requires type s"
      });
    }
    try {
      new RegExp(entry.pattern);
    } catch {
      context.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["pattern"],
        message: "pattern must be a valid regular expression"
      });
    }
  }
  if (entry.appliesTo !== void 0 && entry.widget !== "button") {
    context.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["appliesTo"],
      message: "appliesTo requires a button widget"
    });
  }
  entry.appliesTo?.forEach((pattern, index) => {
    if (!isValidAddressShape(pattern)) {
      context.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["appliesTo", index],
        message: "appliesTo must be a valid OSC address pattern"
      });
    }
  });
});
var ManifestBaseSchema = external_exports.object({
  version: external_exports.literal(1),
  projectId: external_exports.string().min(1),
  entries: external_exports.array(ManifestEntrySchema),
  optionLists: external_exports.record(external_exports.string(), external_exports.array(external_exports.string())).optional(),
  ...originFields
});
var ManifestSchema = ManifestBaseSchema.superRefine((manifest, context) => {
  requireOriginPair(manifest, context);
  for (const [index, entry] of manifest.entries.entries()) {
    if (entry.optionsRef !== void 0 && manifest.optionLists?.[entry.optionsRef] === void 0) {
      context.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["entries", index, "optionsRef"],
        message: `optionsRef "${entry.optionsRef}" was not found in optionLists`
      });
    }
  }
});
var SurfaceStatusSchema = external_exports.object({
  lastRttMs: nonNegativeInt.nullable(),
  consecutiveLosses: nonNegativeInt,
  lastPongSeq: nonNegativeInt.nullable()
});
var RecordedArgSchema = external_exports.discriminatedUnion("kind", [
  external_exports.object({
    kind: external_exports.literal("value"),
    type: external_exports.string().min(1),
    value: external_exports.union([external_exports.number(), external_exports.string(), external_exports.boolean()]),
    truncated: external_exports.literal(true).optional()
  }),
  external_exports.object({
    kind: external_exports.literal("blob"),
    byteLength: nonNegativeInt
  })
]);
var MessageRecordSchema = external_exports.object({
  ts: iso8601Timestamp,
  dir: external_exports.enum(["in", "out"]),
  address: oscAddress,
  args: external_exports.array(RecordedArgSchema).readonly(),
  peer: external_exports.object({
    host: external_exports.string().min(1),
    port: external_exports.number().int().min(1).max(65535)
  }).optional()
});
var SubnetVerdictSchema = external_exports.discriminatedUnion("kind", [
  external_exports.object({
    kind: external_exports.literal("sameHost")
  }),
  external_exports.object({
    kind: external_exports.literal("sameSubnet"),
    matchedInterface: external_exports.string().min(1)
  }),
  external_exports.object({
    kind: external_exports.literal("differentSubnet"),
    checkedInterfaces: positiveInt
  }),
  external_exports.object({
    kind: external_exports.literal("indeterminate"),
    reason: external_exports.enum(["hostname", "ipv6Destination", "noIpv4Interface"])
  })
]);
var ReachabilitySchema = external_exports.enum(["unknown", "reachable", "lost"]);
var DiagnosticsSnapshotSchema = external_exports.object({
  reachability: ReachabilitySchema,
  lastRttMs: nonNegativeInt.nullable(),
  consecutiveLosses: nonNegativeInt,
  lossRate: external_exports.object({
    windowSize: positiveInt,
    observed: nonNegativeInt,
    lost: nonNegativeInt,
    rate: external_exports.number().min(0).max(1).nullable()
  }),
  subnet: SubnetVerdictSchema,
  logUsage: external_exports.object({
    totalBytes: nonNegativeInt,
    limitBytes: positiveInt,
    overLimit: external_exports.boolean()
  }),
  recentMessages: external_exports.array(MessageRecordSchema).readonly()
});
var SurfaceDiagnosticsConfigSchema = external_exports.object({
  ringBufferSize: external_exports.number().int().min(1).max(1e4).default(200),
  lossRateWindow: external_exports.number().int().min(1).max(1e3).default(30),
  ndjsonDir: external_exports.string().min(1).default("logs/diagnostics"),
  ndjsonMaxTotalBytes: positiveInt.default(52428800)
}).default({});
var OscUiPeerSchema = external_exports.object({
  host: external_exports.string().min(1),
  port: external_exports.number().int().min(1).max(65535)
});
var OscUiConfigSchema = external_exports.object({
  enabled: external_exports.boolean().default(false),
  // 名乗り(/oscdesk/hello)を待たずに固定で配信する宛先。
  staticPeers: external_exports.array(OscUiPeerSchema).default([]),
  // 名乗りで登録したピアの有効期限。0 は無期限。
  peerTtlMs: external_exports.number().int().nonnegative().default(0)
}).default({});
var PortSchema = external_exports.number().int().min(1).max(65535);
var BridgeConfigSchema = external_exports.object({
  unity: external_exports.object({
    host: external_exports.string().min(1),
    sendPort: PortSchema
  }).strict(),
  bridge: external_exports.object({
    oscListenHost: external_exports.string().min(1).default("0.0.0.0"),
    oscListenPort: PortSchema.default(7091),
    wsHost: external_exports.string().min(1).default("0.0.0.0"),
    wsPort: PortSchema.default(7080)
  }).strict().default({}),
  ui: external_exports.object({
    host: external_exports.string().min(1).default("0.0.0.0"),
    port: PortSchema.default(8080)
  }).strict().default({}),
  debug: external_exports.boolean(),
  boolFallbackToInt: external_exports.boolean(),
  expectedProjectId: external_exports.string().min(1).optional(),
  diagnostics: SurfaceDiagnosticsConfigSchema,
  oscUi: OscUiConfigSchema
}).strict();
var GuardEventRecordSchema = external_exports.object({
  ts: iso8601Timestamp,
  kind: external_exports.literal("guard-reject"),
  expectedProjectId: external_exports.string().min(1),
  receivedProjectId: external_exports.string().min(1),
  peer: external_exports.object({
    host: external_exports.string().min(1),
    port: external_exports.number().int().min(1).max(65535)
  }).optional()
});
var SelfHealEventRecordSchema = external_exports.object({
  ts: iso8601Timestamp,
  kind: external_exports.literal("self-heal"),
  healKind: external_exports.enum(["container-injected", "id-collision"]),
  detail: external_exports.string().min(1)
});

// ../shared/src/wire.ts
var WIRE_PROTOCOL_VERSION = 1;
var strictObject = (shape) => external_exports.object(shape).strict();
var Int32Schema = external_exports.number().int().min(-2147483648).max(2147483647);
var BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
var Base64Schema = external_exports.string().regex(BASE64_PATTERN);
var WireArgSchema = external_exports.discriminatedUnion("type", [
  strictObject({ type: external_exports.literal("i"), value: Int32Schema }),
  strictObject({ type: external_exports.literal("f"), value: external_exports.number() }),
  strictObject({ type: external_exports.literal("s"), value: external_exports.string() }),
  strictObject({ type: external_exports.literal("b"), value: Base64Schema })
]);
var VersionSchema = external_exports.literal(WIRE_PROTOCOL_VERSION);
var PeerSchema = strictObject({
  host: external_exports.string(),
  port: external_exports.number().int().min(1).max(65535)
});
var OscFrameFields = {
  v: VersionSchema,
  type: external_exports.literal("osc"),
  address: external_exports.string().startsWith("/"),
  args: external_exports.array(WireArgSchema)
};
var LinkUnityStatusSchema = strictObject({
  reachability: external_exports.enum(["unknown", "reachable", "lost"]),
  lastRttMs: external_exports.number().nonnegative().nullable(),
  consecutiveLosses: external_exports.number().int().nonnegative(),
  lastPongSeq: external_exports.number().int().nonnegative().nullable()
});
var LinkManifestStatusSchema = external_exports.discriminatedUnion("state", [
  strictObject({ state: external_exports.literal("none") }),
  strictObject({
    state: external_exports.literal("accepted"),
    projectId: external_exports.string(),
    entryCount: external_exports.number().int().nonnegative()
  })
]);
var LinkRejectionSchema = strictObject({
  ts: external_exports.string().datetime({ offset: true }),
  reason: external_exports.enum(["project-mismatch", "schema-error", "json-parse-error"]),
  detail: external_exports.string(),
  receivedProjectId: external_exports.string().nullable()
});
var HelloFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("hello"),
  clientId: external_exports.string(),
  protocolVersion: external_exports.number().int(),
  server: strictObject({ name: external_exports.string(), version: external_exports.string() }),
  unity: strictObject({ host: external_exports.string(), sendPort: external_exports.number().int().min(1).max(65535) }),
  bridge: strictObject({
    oscListenPort: external_exports.number().int().min(1).max(65535),
    wsPort: external_exports.number().int().min(1).max(65535)
  }),
  expectedProjectId: external_exports.string().nullable(),
  heartbeat: strictObject({ intervalMs: external_exports.number().positive(), timeoutMs: external_exports.number().positive() }),
  pingIntervalMs: external_exports.number().positive(),
  debug: external_exports.boolean()
});
var ManifestAdoptionSchema = strictObject({
  seq: external_exports.number().int().positive(),
  at: external_exports.string().datetime({ offset: true })
});
var ManifestFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("manifest"),
  manifest: ManifestSchema,
  adoption: ManifestAdoptionSchema
});
var DownstreamOscFrameSchema = strictObject({
  ...OscFrameFields,
  from: PeerSchema
});
var LinkFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("link"),
  unity: LinkUnityStatusSchema,
  manifest: LinkManifestStatusSchema,
  lastRejection: LinkRejectionSchema.nullable()
});
var HeartbeatFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("heartbeat"),
  t: external_exports.number()
});
var NoticeFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("notice"),
  level: external_exports.enum(["info", "warn", "error"]),
  code: external_exports.string(),
  detail: external_exports.string()
});
var DownstreamFrameSchema = external_exports.discriminatedUnion("type", [
  HelloFrameSchema,
  ManifestFrameSchema,
  DownstreamOscFrameSchema,
  LinkFrameSchema,
  HeartbeatFrameSchema,
  NoticeFrameSchema
]);
var UpstreamOscFrameSchema = strictObject(OscFrameFields);
var OscBatchMessageSchema = strictObject({
  address: external_exports.string().startsWith("/"),
  args: external_exports.array(WireArgSchema)
});
var UpstreamOscBatchFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("oscBatch"),
  messages: external_exports.array(OscBatchMessageSchema).min(1).max(OSC_BATCH.MAX_MESSAGES)
});
var ManifestRequestFrameSchema = strictObject({ v: VersionSchema, type: external_exports.literal("manifestRequest") });
var HeartbeatAckFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("heartbeatAck"),
  t: external_exports.number()
});
var UpstreamFrameSchema = external_exports.discriminatedUnion("type", [
  UpstreamOscFrameSchema,
  UpstreamOscBatchFrameSchema,
  ManifestRequestFrameSchema,
  HeartbeatAckFrameSchema
]);
function parseUpstreamFrame(raw) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, error: "invalid-json" };
  }
  const result = UpstreamFrameSchema.safeParse(value);
  return result.success ? { ok: true, value: result.data } : { ok: false, error: "schema-error" };
}

// ../shared/src/index.ts
var SYS = {
  PING: "/sys/ping",
  PONG: "/sys/pong",
  STATS_REQUEST: "/sys/stats/request",
  STATS: "/sys/stats",
  MANIFEST_REQUEST: "/sys/manifest/request",
  MANIFEST: "/sys/manifest"
};
var OSCDESK = {
  STATUS_REQUEST: "/oscdesk/status/request",
  STATUS: "/oscdesk/status",
  // OSC ネイティブ UI がエコーバック宛先として自分を登録する名乗り。
  HELLO: "/oscdesk/hello",
  // 自作 UI 向けのマニフェスト配信。
  MANIFEST: "/oscdesk/manifest",
  // 自作 UI からの再配信要求。
  MANIFEST_REQUEST: "/oscdesk/manifest/request"
};
var OSCDESK_DIAG = {
  REQUEST: "/oscdesk/diag/request",
  SNAPSHOT: "/oscdesk/diag"
};
var INTERNAL_PREFIXES = ["/sys/", "/oscdesk/"];
function isInternalAddress(address) {
  return INTERNAL_PREFIXES.some((prefix) => address.startsWith(prefix));
}
function isOscdeskAddress(address) {
  return address.startsWith("/oscdesk/");
}

// src/config.ts
var BRIDGE_CONFIG_ENV_VAR = "OSCDESK_CONFIG";
var DEFAULT_BRIDGE_CONFIG_PATH = import_node_path.default.resolve(
  __dirname,
  "../../../config/oscdesk.config.json"
);
function formatConfigLoadError(error) {
  switch (error.kind) {
    case "not-found":
      return `Config file not found at "${error.path}"`;
    case "read-failed":
      return `Failed to read config at "${error.path}": ${error.detail}`;
    case "invalid-json":
      return `Invalid JSON at "${error.path}": ${error.detail}`;
    case "schema-invalid":
      return `Invalid config at "${error.path}": ${error.issues.join("; ")}`;
  }
}
function resolveBridgeConfigPath(env = process.env) {
  const configuredPath = env[BRIDGE_CONFIG_ENV_VAR];
  if (typeof configuredPath === "string" && configuredPath.trim() !== "") {
    return configuredPath.trim();
  }
  return DEFAULT_BRIDGE_CONFIG_PATH;
}
function loadBridgeConfig(options) {
  const readFile = options.readFile ?? ((filePath) => import_node_fs.default.readFileSync(filePath, "utf8"));
  let text;
  try {
    text = readFile(options.path);
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return { ok: false, error: { kind: "not-found", path: options.path } };
    }
    return {
      ok: false,
      error: { kind: "read-failed", path: options.path, detail: formatUnknownError(error) }
    };
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      error: { kind: "invalid-json", path: options.path, detail: formatUnknownError(error) }
    };
  }
  const result = BridgeConfigSchema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      error: {
        kind: "schema-invalid",
        path: options.path,
        issues: formatConfigValidationIssues(result.error)
      }
    };
  }
  return { ok: true, value: result.data };
}
function formatConfigValidationIssues(error) {
  return error.issues.map((issue) => {
    const pathLabel = issue.path.length > 0 ? issue.path.join(".") : "<root>";
    return `${pathLabel}: ${issue.message}`;
  });
}
function formatUnknownError(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
function isNodeErrorCode(error, code) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

// src/cli.ts
var import_node_path2 = __toESM(require("node:path"));
var DEFAULT_WS_PORT = 7080;
var DEFAULT_UI_PORT = 8080;
function parseCliArgs(argv) {
  let configPath;
  let wsPort;
  let oscListenPort;
  let unityHost;
  let unityPort;
  let uiPort;
  let debug;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    switch (flag) {
      case "--config":
        configPath = import_node_path2.default.resolve(readValue(flag, argv, ++index));
        break;
      case "--ws-port":
        wsPort = parsePort(flag, readValue(flag, argv, ++index));
        break;
      case "--osc-listen-port":
        oscListenPort = parsePort(flag, readValue(flag, argv, ++index));
        break;
      case "--unity-host":
        unityHost = readValue(flag, argv, ++index);
        break;
      case "--unity-port":
        unityPort = parsePort(flag, readValue(flag, argv, ++index));
        break;
      case "--ui-port":
        uiPort = parsePort(flag, readValue(flag, argv, ++index));
        break;
      case "--debug":
        debug = true;
        break;
      default:
        throw new Error(`Unknown argument: ${flag}`);
    }
  }
  return { configPath, wsPort, oscListenPort, unityHost, unityPort, uiPort, debug };
}
function readValue(flag, argv, index) {
  const value = argv[index];
  if (value === void 0 || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
  return value;
}
function parsePort(flag, raw) {
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid port for ${flag}: ${raw}`);
  return port;
}

// src/bridge-server.ts
var import_promises = require("node:dns/promises");
var import_node_fs2 = __toESM(require("node:fs"));
var import_node_net = __toESM(require("node:net"));
var import_node_os = __toESM(require("node:os"));

// src/manifest-client.ts
var DEFAULT_REQUEST_INTERVAL_MS = 2e3;
var DEFAULT_STATS_INTERVAL_MS = 4e3;
var sameOrigin = (a, b) => a.bootId === b.bootId && a.structureGeneration === b.structureGeneration;
var originOf = (value) => value.bootId !== void 0 && value.structureGeneration !== void 0 ? { bootId: value.bootId, structureGeneration: value.structureGeneration } : null;
var ManifestClient = class {
  requestIntervalMs;
  expectedProjectId;
  state = "requesting";
  statsIntervalMs;
  lastRequestAtMs = null;
  lastStatsRequestAtMs = null;
  lastStatsInvalidKey = null;
  hasAccepted = false;
  acceptedOrigin = null;
  targetOrigin = null;
  adoptNextRegardless = false;
  lastRejectKey = null;
  latestManifest = null;
  constructor(options) {
    this.requestIntervalMs = options?.requestIntervalMs ?? DEFAULT_REQUEST_INTERVAL_MS;
    this.statsIntervalMs = options?.statsIntervalMs ?? DEFAULT_STATS_INTERVAL_MS;
    this.expectedProjectId = options?.expectedProjectId;
  }
  shouldRequest(nowMs) {
    if (this.state !== "requesting") {
      return false;
    }
    if (this.lastRequestAtMs === null) {
      return true;
    }
    return nowMs - this.lastRequestAtMs >= this.requestIntervalMs;
  }
  onRequestSent(nowMs) {
    this.lastRequestAtMs = nowMs;
  }
  shouldRequestStats(nowMs) {
    if (this.acceptedOrigin === null) {
      return false;
    }
    return this.lastStatsRequestAtMs === null || nowMs - this.lastStatsRequestAtMs >= this.statsIntervalMs;
  }
  onStatsRequestSent(nowMs) {
    this.lastStatsRequestAtMs = nowMs;
  }
  onStatsPayload(json) {
    let parsedJson;
    try {
      parsedJson = JSON.parse(json);
    } catch (error) {
      return this.invalidStats(formatJsonParseError(error));
    }
    const result = StatsPayloadSchema.safeParse(parsedJson);
    if (!result.success) {
      return this.invalidStats(formatSchemaError(result.error.issues));
    }
    this.lastStatsInvalidKey = null;
    const reported = originOf(result.data);
    if (!this.hasAccepted || this.acceptedOrigin === null || reported === null) {
      return { kind: "not-applicable" };
    }
    if (sameOrigin(reported, this.acceptedOrigin)) {
      this.targetOrigin = null;
      if (!this.adoptNextRegardless) {
        this.state = "settled";
      }
      return { kind: "match" };
    }
    this.targetOrigin = reported;
    this.state = "requesting";
    this.lastRequestAtMs = null;
    return { kind: "mismatch", reported };
  }
  onManifestPayload(json) {
    let parsedJson;
    try {
      parsedJson = JSON.parse(json);
    } catch (error) {
      return this.reject("json-parse-error", formatJsonParseError(error));
    }
    const result = ManifestSchema.safeParse(parsedJson);
    if (!result.success) {
      return this.reject("schema-error", formatSchemaError(result.error.issues));
    }
    if (this.expectedProjectId !== void 0 && result.data.projectId !== this.expectedProjectId) {
      return this.rejectProjectMismatch(this.expectedProjectId, result.data.projectId);
    }
    this.lastRejectKey = null;
    const origin = originOf(result.data);
    if (!this.adoptNextRegardless && this.hasAccepted && origin !== null && this.acceptedOrigin !== null && sameOrigin(origin, this.acceptedOrigin)) {
      if (this.targetOrigin === null) {
        this.state = "settled";
      }
      return { accepted: true, duplicate: true, origin };
    }
    const bootChanged = origin !== null && this.acceptedOrigin !== null && origin.bootId !== this.acceptedOrigin.bootId;
    this.adoptNextRegardless = false;
    this.hasAccepted = true;
    this.latestManifest = result.data;
    this.acceptedOrigin = origin;
    if (origin === null || this.targetOrigin === null || sameOrigin(origin, this.targetOrigin)) {
      this.targetOrigin = null;
      this.state = "settled";
    } else {
      this.state = "requesting";
    }
    return {
      accepted: true,
      duplicate: false,
      manifest: result.data,
      origin,
      bootChanged
    };
  }
  onReachabilityRecovered() {
    this.state = "requesting";
    this.lastRequestAtMs = null;
    this.lastRejectKey = null;
    this.adoptNextRegardless = true;
  }
  invalidStats(detail) {
    const isRepeat = detail === this.lastStatsInvalidKey;
    this.lastStatsInvalidKey = detail;
    return { kind: "invalid", detail, isRepeat };
  }
  current() {
    return this.latestManifest;
  }
  reject(reason, detail) {
    this.state = "requesting";
    const rejectKey = `${reason}:${detail}`;
    const isRepeat = rejectKey === this.lastRejectKey;
    this.lastRejectKey = rejectKey;
    return {
      accepted: false,
      reason,
      detail,
      isRepeat
    };
  }
  rejectProjectMismatch(expectedProjectId, receivedProjectId) {
    const detail = `expected projectId "${expectedProjectId}", received "${receivedProjectId}"`;
    const rejectKey = JSON.stringify(["project-mismatch", expectedProjectId, receivedProjectId]);
    const isRepeat = rejectKey === this.lastRejectKey;
    this.lastRejectKey = rejectKey;
    return {
      accepted: false,
      reason: "project-mismatch",
      expectedProjectId,
      receivedProjectId,
      detail,
      isRepeat
    };
  }
};
function formatJsonParseError(error) {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return "Failed to parse manifest JSON.";
}
function formatSchemaError(issues) {
  return issues.map((issue) => {
    const pathLabel = issue.path.length > 0 ? issue.path.join(".") : "<root>";
    return `${pathLabel}: ${issue.message}`;
  }).join("; ");
}

// src/ping-monitor.ts
var PingMonitor = class {
  nextSeq = 1;
  pending = null;
  lastRttMs = null;
  consecutiveLosses = 0;
  lastPongSeq = null;
  nextPing(nowMs) {
    if (this.pending !== null) {
      this.consecutiveLosses += 1;
    }
    const seq = this.nextSeq;
    this.nextSeq += 1;
    this.pending = {
      seq,
      sentAtMs: nowMs
    };
    return seq;
  }
  onPong(seq, nowMs) {
    if (this.pending === null || this.pending.seq !== seq) {
      return {
        accepted: false,
        recoveredFromLoss: false
      };
    }
    const recoveredFromLoss = this.consecutiveLosses >= 1;
    this.lastRttMs = Math.max(0, nowMs - this.pending.sentAtMs);
    this.consecutiveLosses = 0;
    this.lastPongSeq = seq;
    this.pending = null;
    return {
      accepted: true,
      recoveredFromLoss
    };
  }
  snapshot() {
    return {
      lastRttMs: this.lastRttMs,
      consecutiveLosses: this.consecutiveLosses,
      lastPongSeq: this.lastPongSeq
    };
  }
};

// src/osc-ui-router.ts
function peerKey(peer) {
  return `${peer.host}:${String(peer.port)}`;
}
var OscUiRouter = class {
  #unity;
  #unityHosts;
  #staticPeers;
  #peerTtlMs;
  #registered = /* @__PURE__ */ new Map();
  constructor(options) {
    this.#unity = options.unity;
    this.#unityHosts = /* @__PURE__ */ new Set([options.unity.host, ...options.unityAddresses ?? []]);
    this.#staticPeers = options.config.staticPeers;
    this.#peerTtlMs = options.config.peerTtlMs;
  }
  /** `${OSCDESK.HELLO}` を受けて UI ピアを登録する。既知なら lastSeen を更新するだけ。 */
  registerPeer(host, port, nowMs) {
    const peer = { host, port };
    const key = peerKey(peer);
    const added = !this.#registered.has(key);
    this.#registered.set(key, { peer, lastSeenMs: nowMs });
    return { added, peer };
  }
  /** 現在配信対象となる UI ピア。静的ピアは常に生存扱い。 */
  activePeers(nowMs) {
    this.#pruneExpired(nowMs);
    const seen = /* @__PURE__ */ new Set();
    const peers = [];
    for (const peer of [...this.#staticPeers, ...[...this.#registered.values()].map((record) => record.peer)]) {
      const key = peerKey(peer);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      peers.push(peer);
    }
    return peers;
  }
  route(source, nowMs) {
    if (this.#isUnitySocket(source)) {
      return this.#toUi(nowMs);
    }
    if (this.#isKnownUiHost(source.host, nowMs)) {
      this.#touchHost(source.host, nowMs);
      return { kind: "to-unity" };
    }
    if (this.#unityHosts.has(source.host)) {
      return this.#toUi(nowMs);
    }
    return { kind: "ignore", reason: "unknown-peer" };
  }
  #toUi(nowMs) {
    const targets = this.activePeers(nowMs);
    return targets.length > 0 ? { kind: "to-ui", targets } : { kind: "ignore", reason: "no-ui-peers" };
  }
  #isUnitySocket(source) {
    return this.#unityHosts.has(source.host) && source.port === this.#unity.port;
  }
  #isKnownUiHost(host, nowMs) {
    if (this.#staticPeers.some((peer) => peer.host === host)) {
      return true;
    }
    this.#pruneExpired(nowMs);
    return [...this.#registered.values()].some((record) => record.peer.host === host);
  }
  /**
   * 操作が続いている限りピアを生かし続ける。名乗りの定期送信を UI 側に強制しないため。
   */
  #touchHost(host, nowMs) {
    for (const record of this.#registered.values()) {
      if (record.peer.host === host) {
        record.lastSeenMs = nowMs;
      }
    }
  }
  #pruneExpired(nowMs) {
    if (this.#peerTtlMs <= 0) {
      return;
    }
    for (const [key, record] of this.#registered) {
      if (nowMs - record.lastSeenMs > this.#peerTtlMs) {
        this.#registered.delete(key);
      }
    }
  }
};

// src/surface-core.ts
var PING_INTERVAL_MS = 2e3;
function createSurfaceCore(deps) {
  const now = deps.now ?? Date.now;
  const setIntervalFn = deps.setIntervalFn ?? setInterval;
  const clearIntervalFn = deps.clearIntervalFn ?? clearInterval;
  const logInfo = deps.logInfo ?? console.info;
  const logWarn = deps.logWarn ?? console.warn;
  const logError = deps.logError ?? console.error;
  const monitor = new PingMonitor();
  const uiRouter = deps.config.oscUi.enabled ? new OscUiRouter({
    unity: { host: deps.config.unity.host, port: deps.config.unity.sendPort },
    unityAddresses: deps.unityAddresses,
    config: deps.config.oscUi
  }) : null;
  const manifests = new ManifestClient({ expectedProjectId: deps.config.expectedProjectId });
  let timer = null;
  let stopped = false;
  let refreshAfterRecovery = false;
  let acceptedManifest = null;
  let acceptedAdoption = null;
  let adoptionSeq = 0;
  let lastRejection = null;
  let lastLinkPublishedAt = -Infinity;
  const warnedInternalAddresses = /* @__PURE__ */ new Set();
  const warnedNonUnitySources = /* @__PURE__ */ new Set();
  const unityHosts = /* @__PURE__ */ new Set([deps.config.unity.host, ...deps.unityAddresses ?? []]);
  const isUnityHost = (host) => unityHosts.has(host);
  let diagnostics = null;
  let guardLog = null;
  const publishLink = (target, force = false) => {
    const timestamp = now();
    if (!force && timestamp - lastLinkPublishedAt < PING_INTERVAL_MS) return;
    lastLinkPublishedAt = timestamp;
    deps.publish({ v: 1, type: "link", ...linkSnapshot() }, target);
  };
  const sendMessage = (host, port, address, ...args) => {
    if (isBridgeInternalAddress(address)) {
      if (!warnedInternalAddresses.has(address)) {
        warnedInternalAddresses.add(address);
        logWarn("(WARN, BRIDGE)", `Blocked outbound internal message "${address}".`);
      }
      return;
    }
    diagnostics?.recordOutgoing?.(address, args, host, port);
    deps.sendFn(host, port, address, ...args);
  };
  const rejectBatch = (clientId, detail) => {
    deps.publish({ v: 1, type: "notice", level: "error", code: "batch-rejected", detail }, clientId);
  };
  const publishManifest = (target) => {
    if (acceptedManifest === null || acceptedAdoption === null) return;
    const frame = { v: 1, type: "manifest", manifest: acceptedManifest, adoption: acceptedAdoption };
    if (target === void 0) deps.publish(frame);
    else deps.publish(frame, target);
  };
  const requestManifest = () => {
    if (manifests.shouldRequest(now())) {
      sendMessage(deps.config.unity.host, deps.config.unity.sendPort, SYS.MANIFEST_REQUEST);
      manifests.onRequestSent(now());
    }
  };
  const requestStats = () => {
    if (manifests.shouldRequestStats(now())) {
      sendMessage(deps.config.unity.host, deps.config.unity.sendPort, SYS.STATS_REQUEST);
      manifests.onStatsRequestSent(now());
    }
  };
  const handleStats = (payload) => {
    const result = manifests.onStatsPayload(payload);
    if (result.kind === "mismatch") {
      logInfo("(INFO, BRIDGE)", `Unity manifest origin changed (bootId ${result.reported.bootId}, generation ${String(result.reported.structureGeneration)}); requesting manifest.`);
      requestManifest();
    } else if (result.kind === "invalid" && !result.isRepeat) {
      logWarn("(WARN, BRIDGE)", `Invalid /sys/stats payload: ${result.detail}`);
    }
  };
  const tick = () => {
    if (stopped) return;
    const before = monitor.snapshot().consecutiveLosses;
    const seq = monitor.nextPing(now());
    refreshAfterRecovery ||= monitor.snapshot().consecutiveLosses > before;
    diagnostics?.onPingCycle?.({ previousLost: monitor.snapshot().consecutiveLosses > before });
    sendMessage(deps.config.unity.host, deps.config.unity.sendPort, SYS.PING, { type: "i", value: seq });
    requestManifest();
    requestStats();
    publishLink();
  };
  const handleManifest = (message, payload) => {
    const result = manifests.onManifestPayload(payload);
    if (result.accepted !== true) {
      const rejected = result;
      if (!rejected.isRepeat) logError("(ERROR, BRIDGE)", `Manifest ${rejected.reason}: ${rejected.detail}`);
      lastRejection = {
        ts: new Date(now()).toISOString(),
        reason: rejected.reason,
        detail: rejected.detail,
        receivedProjectId: rejected.reason === "project-mismatch" ? rejected.receivedProjectId : null
      };
      if (rejected.reason === "project-mismatch") {
        guardLog?.recordRejection({
          expectedProjectId: rejected.expectedProjectId,
          receivedProjectId: rejected.receivedProjectId,
          isRepeat: rejected.isRepeat,
          peer: message.from
        });
      }
      publishLink(void 0, true);
      return;
    }
    if (result.duplicate) {
      if (lastRejection !== null) {
        lastRejection = null;
        publishLink(void 0, true);
      }
      return;
    }
    if (result.bootChanged) logInfo("(INFO, BRIDGE)", "Unity restart detected (bootId changed); adopting new manifest.");
    acceptedManifest = result.manifest;
    acceptedAdoption = { seq: ++adoptionSeq, at: new Date(now()).toISOString() };
    lastRejection = null;
    publishManifest();
    publishLink(void 0, true);
  };
  const linkSnapshot = () => ({
    unity: unityStatus(),
    manifest: acceptedManifest === null ? { state: "none" } : { state: "accepted", projectId: acceptedManifest.projectId, entryCount: acceptedManifest.entries?.length ?? 0 },
    lastRejection
  });
  function unityStatus() {
    const status = monitor.snapshot();
    return {
      reachability: status.consecutiveLosses > 0 ? "lost" : status.lastPongSeq === null ? "unknown" : "reachable",
      lastRttMs: status.lastRttMs,
      consecutiveLosses: status.consecutiveLosses,
      lastPongSeq: status.lastPongSeq
    };
  }
  return {
    start() {
      if (timer !== null) return;
      diagnostics = deps.config.debug ? deps.createDiagnosticsEngine?.({ config: deps.config, getStatus: () => unityStatus(), now }) ?? null : null;
      guardLog = deps.createGuardEventLog?.({ config: deps.config, now }) ?? null;
      stopped = false;
      requestManifest();
      timer = setIntervalFn(tick, PING_INTERVAL_MS);
    },
    stop() {
      if (timer === null) {
        stopped = true;
        return;
      }
      clearIntervalFn(timer);
      timer = null;
      diagnostics?.dispose();
      guardLog?.dispose();
      diagnostics = null;
      guardLog = null;
      stopped = true;
    },
    handleOscIn(message) {
      if (stopped) return;
      diagnostics?.recordIncoming?.(message.address, message.args, message.from.host, message.from.port);
      if (message.address === OSCDESK.HELLO) {
        if (uiRouter !== null) {
          const arg = message.args[0];
          const announcedPort = arg?.type === "i" && Number.isInteger(arg.value) && arg.value >= 1 && arg.value <= 65535 ? arg.value : message.from.port;
          uiRouter.registerPeer(message.from.host, announcedPort, now());
        }
        return;
      }
      if ((message.address === SYS.PONG || message.address === SYS.MANIFEST || message.address === SYS.STATS) && !isUnityHost(message.from.host)) {
        if (!warnedNonUnitySources.has(message.from.host)) {
          warnedNonUnitySources.add(message.from.host);
          logWarn("(WARN, BRIDGE)", `Ignored ${message.address} from non-Unity source ${message.from.host}:${String(message.from.port)}.`);
        }
        return;
      }
      if (message.address === SYS.PONG) {
        const arg = message.args[0];
        if (arg?.type === "i" && Number.isInteger(arg.value)) {
          const result = monitor.onPong(arg.value, now());
          if (result.accepted && (result.recoveredFromLoss || refreshAfterRecovery)) {
            refreshAfterRecovery = false;
            manifests.onReachabilityRecovered();
            requestManifest();
          }
          if (result.accepted) publishLink();
          if (result.accepted) diagnostics?.onPongAccepted?.();
        }
        return;
      }
      if (message.address === SYS.MANIFEST) {
        const arg = message.args[0];
        if (arg?.type !== "s") {
          logError("(ERROR, BRIDGE)", "Manifest payload must be a string.");
          return;
        }
        handleManifest(message, arg.value);
        return;
      }
      if (message.address === SYS.STATS) {
        const arg = message.args[0];
        if (arg?.type === "s") handleStats(arg.value);
        return;
      }
      if (message.address === OSCDESK_DIAG.REQUEST) {
        const snapshot = diagnostics?.snapshot?.();
        if (snapshot !== void 0) {
          deps.sendFn(message.from.host, message.from.port, OSCDESK_DIAG.SNAPSHOT, {
            type: "s",
            value: JSON.stringify(snapshot)
          });
        }
        return;
      }
      if (message.address === OSCDESK.MANIFEST_REQUEST) {
        if (acceptedManifest !== null) {
          deps.sendFn(message.from.host, message.from.port, OSCDESK.MANIFEST, {
            type: "s",
            value: JSON.stringify(acceptedManifest)
          });
        }
        return;
      }
      if (message.address === OSCDESK.STATUS_REQUEST) {
        deps.sendFn(message.from.host, message.from.port, OSCDESK.STATUS, {
          type: "s",
          value: JSON.stringify(linkSnapshot())
        });
        return;
      }
      if (isInternalAddress(message.address)) return;
      if (uiRouter !== null) {
        const decision = uiRouter.route(message.from, now());
        if (decision.kind === "to-unity") {
          sendMessage(deps.config.unity.host, deps.config.unity.sendPort, message.address, ...message.args);
        } else if (decision.kind === "to-ui") {
          for (const target of decision.targets) {
            deps.sendFn(target.host, target.port, message.address, ...message.args);
          }
        }
      }
      deps.publish({ v: 1, type: "osc", address: message.address, args: toWireArgs(message.args), from: message.from });
    },
    handleUiFrame(frame, clientId) {
      if (frame.type === "manifestRequest") {
        publishManifest(clientId);
        return;
      }
      if (frame.type === "heartbeatAck") return;
      if (frame.type === "oscBatch") {
        const internalAddress = frame.messages.find((message) => isInternalAddress(message.address))?.address;
        if (internalAddress !== void 0) {
          rejectBatch(clientId, `internal-address: ${internalAddress}`);
          return;
        }
        if (deps.sendBundleFn === void 0) {
          rejectBatch(clientId, "transport-unavailable");
          return;
        }
        const messages = frame.messages.map((message) => ({
          address: message.address,
          args: toOscArgs(message.args)
        }));
        const result = deps.sendBundleFn(deps.config.unity.host, deps.config.unity.sendPort, messages);
        if (!result.ok) {
          rejectBatch(clientId, result.reason === "too-large" ? `too-large: ${String(result.bytes)} bytes (limit ${String(result.limitBytes)})` : "transport-unavailable");
          return;
        }
        for (const message of messages) {
          diagnostics?.recordOutgoing?.(message.address, message.args, deps.config.unity.host, deps.config.unity.sendPort);
        }
        return;
      }
      if (frame.type !== "osc") return;
      if (isInternalAddress(frame.address)) {
        if (!warnedInternalAddresses.has(frame.address)) {
          warnedInternalAddresses.add(frame.address);
          logWarn("(WARN, BRIDGE)", `Blocked UI frame to internal address "${frame.address}".`);
        }
        return;
      }
      sendMessage(deps.config.unity.host, deps.config.unity.sendPort, frame.address, ...toOscArgs(frame.args));
    },
    onUiConnected(clientId) {
      deps.publish(buildHelloFrame(clientId), clientId);
      publishLink(clientId, true);
      publishManifest(clientId);
    },
    onUiDisconnected(_clientId) {
    },
    linkSnapshot,
    helloFrame: buildHelloFrame
  };
  function buildHelloFrame(clientId) {
    return {
      v: 1,
      type: "hello",
      clientId,
      protocolVersion: 1,
      server: { name: deps.config.server?.name ?? "oscdesk-bridge", version: deps.config.server?.version ?? "0.1.0" },
      unity: { host: deps.config.unity.host, sendPort: deps.config.unity.sendPort },
      bridge: {
        oscListenPort: deps.config.bridge.oscListenPort,
        wsPort: deps.config.bridge.wsPort
      },
      expectedProjectId: deps.config.expectedProjectId ?? null,
      heartbeat: { intervalMs: 15e3, timeoutMs: 3e4 },
      pingIntervalMs: PING_INTERVAL_MS,
      debug: deps.config.debug
    };
  }
}
function toWireArgs(args) {
  return args.map((arg) => arg.type === "b" ? { type: "b", value: Buffer.from(arg.value).toString("base64") } : arg);
}
function toOscArgs(args) {
  return args.map((arg) => {
    if (arg.type === "i" || arg.type === "f") return { type: arg.type, value: Number(arg.value) };
    if (arg.type === "s") return { type: "s", value: String(arg.value) };
    return { type: "b", value: Buffer.from(String(arg.value ?? ""), "base64") };
  });
}
function isBridgeInternalAddress(address) {
  return isOscdeskAddress(address);
}

// src/udp-transport.ts
var import_node_dgram = __toESM(require("node:dgram"));

// ../osc-codec/src/osc-codec.ts
var osc = require("osc");
var OSC_READ_OPTIONS = {
  metadata: true,
  unpackSingleArgs: false
};
var OSC_WRITE_OPTIONS = {
  metadata: true,
  unpackSingleArgs: false
};
var OscDecodeError = class extends Error {
  cause;
  constructor(message, cause) {
    super(message);
    this.name = "OscDecodeError";
    this.cause = cause;
  }
};
function encodeOscPacket(packet) {
  return osc.writePacket(toOscJsPacket(packet), OSC_WRITE_OPTIONS);
}
function decodeOscPacket(data) {
  try {
    const packet = osc.readPacket(data, OSC_READ_OPTIONS);
    return fromOscJsPacket(packet);
  } catch (error) {
    throw new OscDecodeError("Failed to decode OSC packet.", error);
  }
}
function toOscJsPacket(packet) {
  if (isBundlePacket(packet)) {
    return {
      timeTag: {
        raw: [packet.timeTag.seconds, packet.timeTag.fractions],
        native: packet.timeTag.native
      },
      packets: packet.packets.map(toOscJsPacket)
    };
  }
  return {
    address: packet.address,
    args: packet.args.map((arg) => ({
      type: arg.type,
      value: arg.value
    }))
  };
}
function fromOscJsPacket(packet) {
  if (isOscJsBundle(packet)) {
    return {
      timeTag: normalizeTimeTag(packet.timeTag),
      packets: packet.packets.map(fromOscJsPacket)
    };
  }
  const args = normalizeArgs(packet.args);
  return {
    address: packet.address,
    args
  };
}
function normalizeTimeTag(timeTag) {
  const [seconds, fractions] = timeTag.raw ?? [0, 1];
  return {
    seconds,
    fractions
  };
}
function normalizeArgs(args) {
  if (args === void 0) {
    return [];
  }
  const entries = Array.isArray(args) ? args : [args];
  return entries.map(normalizeArg);
}
function normalizeArg(arg) {
  switch (arg.type) {
    case "i":
      return { type: "i", value: requireNumber(arg, Number.isInteger, "int32") };
    case "f":
      return { type: "f", value: requireNumber(arg, Number.isFinite, "float32") };
    case "s":
      if (typeof arg.value !== "string") {
        throw new Error(`Expected OSC string for type tag "s", received ${typeof arg.value}.`);
      }
      return { type: "s", value: arg.value };
    case "b":
      return { type: "b", value: toUint8Array(arg.value) };
    default:
      throw new Error(`Unsupported OSC type tag "${arg.type}" in Phase 1 adapter.`);
  }
}
function requireNumber(arg, validator, label) {
  if (typeof arg.value !== "number" || !validator(arg.value)) {
    throw new Error(`Expected OSC ${label} for type tag "${arg.type}".`);
  }
  return arg.value;
}
function toUint8Array(value) {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new Error("Expected OSC blob payload to be binary data.");
}
function isBundlePacket(packet) {
  return "timeTag" in packet && "packets" in packet;
}
function isOscJsBundle(packet) {
  return "timeTag" in packet && "packets" in packet;
}

// src/udp-transport.ts
async function startUdpTransport(options) {
  const socket = import_node_dgram.default.createSocket("udp4");
  const host = options.host ?? "0.0.0.0";
  socket.on("message", (data, remote) => {
    handleIncomingPacket(data, remote, options);
  });
  await bindSocket(socket, options.port, host);
  socket.on("error", options.onSocketError);
  const address = socket.address();
  const port = typeof address === "string" ? options.port : address.port;
  return {
    port,
    send(targetHost, targetPort, address2, args) {
      const payload = encodeOscPacket({ address: address2, args: [...args] });
      void sendPacket(socket, payload, targetPort, targetHost).catch(options.onSocketError);
    },
    sendBundle(targetHost, targetPort, messages) {
      const payload = encodeOscPacket({
        timeTag: OSC_IMMEDIATE_TIME_TAG,
        packets: messages.map((message) => ({
          address: message.address,
          args: [...message.args]
        }))
      });
      if (payload.byteLength > OSC_BATCH.PRACTICAL_LIMIT_BYTES) {
        return {
          ok: false,
          reason: "too-large",
          bytes: payload.byteLength,
          limitBytes: OSC_BATCH.PRACTICAL_LIMIT_BYTES
        };
      }
      void sendPacket(socket, payload, targetPort, targetHost).catch(options.onSocketError);
      return { ok: true, bytes: payload.byteLength, messageCount: messages.length };
    },
    close() {
      return closeSocket(socket);
    }
  };
}
function handleIncomingPacket(data, remote, options) {
  let packet;
  try {
    packet = decodeOscPacket(data);
  } catch (error) {
    options.onDecodeError(error, { host: remote.address, port: remote.port });
    return;
  }
  for (const message of flattenMessages(packet)) {
    options.onMessage({
      address: message.address,
      args: message.args,
      from: { host: remote.address, port: remote.port }
    });
  }
}
function flattenMessages(packet) {
  if (isBundle(packet)) {
    return packet.packets.flatMap(flattenMessages);
  }
  return [packet];
}
function isBundle(packet) {
  return "packets" in packet;
}
function bindSocket(socket, port, host) {
  return new Promise((resolve, reject) => {
    const handleListening = () => {
      cleanup();
      resolve();
    };
    const handleError = (error) => {
      cleanup();
      socket.close(() => reject(error));
    };
    const cleanup = () => {
      socket.off("listening", handleListening);
      socket.off("error", handleError);
    };
    socket.once("listening", handleListening);
    socket.once("error", handleError);
    socket.bind(port, host);
  });
}
function closeSocket(socket) {
  return new Promise((resolve, reject) => {
    socket.close(() => {
      resolve();
    });
  });
}
function sendPacket(socket, payload, port, host) {
  return new Promise((resolve, reject) => {
    socket.send(payload, port, host, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

// src/ui-hub.ts
var import_node_crypto = require("node:crypto");
var import_ws = require("ws");
var DEFAULT_HEARTBEAT = { intervalMs: 15e3, timeoutMs: 3e4 };
function startUiHub(options) {
  const heartbeat = options.heartbeat ?? DEFAULT_HEARTBEAT;
  if (heartbeat.timeoutMs <= heartbeat.intervalMs) {
    return Promise.reject(new Error("heartbeat.timeoutMs must be greater than heartbeat.intervalMs"));
  }
  const now = options.now ?? Date.now;
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  const clients = /* @__PURE__ */ new Map();
  const server = new import_ws.WebSocketServer({ host: options.host ?? "0.0.0.0", port: options.port });
  let timer = null;
  let closing = false;
  const disconnect = (clientId, reason) => {
    const client = clients.get(clientId);
    if (!client || client.disconnected) return;
    client.disconnected = true;
    clients.delete(clientId);
    options.onDisconnect(clientId, reason);
  };
  server.on("connection", (socket, request) => {
    const clientId = (0, import_node_crypto.randomUUID)();
    const client = {
      socket,
      lastReceivedAt: now(),
      disconnected: false
    };
    clients.set(clientId, client);
    options.onConnect(clientId, {
      host: request.socket.remoteAddress ?? "",
      port: request.socket.remotePort ?? 0
    });
    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        options.onInvalidFrame(clientId, "binary-frame", "");
        sendFrame(socket, {
          v: 1,
          type: "notice",
          level: "warn",
          code: "invalid-frame",
          detail: "binary-frame"
        });
        return;
      }
      client.lastReceivedAt = now();
      const raw = rawText(data);
      const parsed = parseUpstreamFrame(raw);
      if (!parsed.ok) {
        const preview = raw.slice(0, 200);
        options.onInvalidFrame(clientId, parsed.error, preview);
        sendFrame(socket, {
          v: 1,
          type: "notice",
          level: "warn",
          code: "invalid-frame",
          detail: parsed.error
        });
        return;
      }
      options.onFrame(parsed.value, clientId);
    });
    socket.once("close", () => disconnect(clientId, closing ? "server-closed" : "client-closed"));
    socket.on("error", () => {
    });
  });
  const handleHeartbeat = () => {
    const timestamp = now();
    for (const [clientId, client] of clients) {
      if (timestamp - client.lastReceivedAt > heartbeat.timeoutMs) {
        disconnect(clientId, "heartbeat-timeout");
        client.socket.terminate();
        continue;
      }
      if (client.socket.readyState === import_ws.WebSocket.OPEN) {
        sendFrame(client.socket, { v: 1, type: "heartbeat", t: timestamp });
      }
    }
  };
  const clearTimer = () => {
    if (timer !== null) {
      clearIntervalFn(timer);
      timer = null;
    }
  };
  const ready = new Promise((resolve, reject) => {
    const onListening = () => {
      server.off("error", onStartupError);
      timer = setIntervalFn(handleHeartbeat, heartbeat.intervalMs);
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : options.port;
      resolve({
        get port() {
          return port;
        },
        get clientCount() {
          return clients.size;
        },
        broadcast(frame) {
          for (const client of clients.values()) sendFrame(client.socket, frame);
        },
        sendTo(clientId, frame) {
          const client = clients.get(clientId);
          if (client) sendFrame(client.socket, frame);
        },
        close() {
          closing = true;
          clearTimer();
          for (const [clientId, client] of clients) {
            disconnect(clientId, "server-closed");
            client.socket.close();
          }
          return new Promise((done, fail) => {
            server.close((error) => error ? fail(error) : done());
          });
        }
      });
    };
    const onStartupError = (error) => {
      server.off("listening", onListening);
      server.close(() => void 0);
      reject(error);
    };
    server.once("listening", onListening);
    server.once("error", onStartupError);
  });
  return ready;
}
function rawText(data) {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  const chunks = Array.isArray(data) ? data : [data];
  return Buffer.concat(chunks.map((chunk) => Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))).toString("utf8");
}
function sendFrame(socket, frame) {
  if (socket.readyState === import_ws.WebSocket.OPEN) socket.send(JSON.stringify(frame));
}

// src/diagnostics-engine.ts
var import_node_path5 = __toESM(require("node:path"));

// src/ndjson-writer.ts
var import_node_path3 = __toESM(require("node:path"));
function createNdjsonWriter(options) {
  const resolvedDir = import_node_path3.default.resolve(process.cwd(), options.dir);
  const fileName = `${options.filePrefix ?? "oscdesk-debug"}-${toSafeTimestamp(options.now())}.ndjson`;
  const filePath = import_node_path3.default.join(resolvedDir, fileName);
  let degraded = false;
  let stream = null;
  const degrade = (error) => {
    if (degraded) {
      return;
    }
    degraded = true;
    try {
      stream?.end();
    } catch {
    }
    stream = null;
    options.logError("(ERROR, CUSTOM MODULE)", `Failed to write NDJSON log at "${filePath}".`, error);
  };
  const open = () => {
    if (degraded || stream !== null) {
      return;
    }
    try {
      options.fs.mkdirSync(resolvedDir, { recursive: true });
      stream = options.fs.createWriteStream(filePath, { flags: "a", encoding: "utf8" });
      stream.on("error", degrade);
    } catch (error) {
      degrade(error);
    }
  };
  return {
    append(record) {
      if (degraded || stream === null) {
        open();
      }
      if (degraded || stream === null) {
        return;
      }
      try {
        stream.write(`${JSON.stringify(record)}
`);
      } catch (error) {
        degrade(error);
      }
    },
    getCurrentFileName() {
      return fileName;
    },
    dispose() {
      if (stream === null) {
        return;
      }
      const activeStream = stream;
      stream = null;
      try {
        activeStream.end();
      } catch {
      }
    }
  };
}
function toSafeTimestamp(value) {
  return value.toISOString().replace(/[:.]/g, "-");
}

// src/link-health.ts
var LossRateWindow = class {
  windowSize;
  outcomes;
  head = 0;
  count = 0;
  lost = 0;
  constructor(windowSize) {
    if (!Number.isInteger(windowSize) || windowSize < 1) {
      throw new Error("windowSize must be an integer greater than or equal to 1");
    }
    this.windowSize = windowSize;
    this.outcomes = new Array(windowSize);
  }
  record(outcome) {
    if (outcome !== "answered" && outcome !== "lost") {
      throw new Error('outcome must be either "answered" or "lost"');
    }
    if (this.count < this.windowSize) {
      this.outcomes[(this.head + this.count) % this.windowSize] = outcome;
      this.count += 1;
    } else {
      const evicted = this.outcomes[this.head];
      if (evicted === "lost") {
        this.lost -= 1;
      }
      this.outcomes[this.head] = outcome;
      this.head = (this.head + 1) % this.windowSize;
    }
    if (outcome === "lost") {
      this.lost += 1;
    }
  }
  stats() {
    return {
      windowSize: this.windowSize,
      observed: this.count,
      lost: this.lost,
      rate: this.count === 0 ? null : this.lost / this.count
    };
  }
};
function deriveReachability(status) {
  if (status.consecutiveLosses >= 1) {
    return "lost";
  }
  if (status.lastPongSeq !== null) {
    return "reachable";
  }
  return "unknown";
}

// src/ndjson-quota.ts
var import_node_path4 = __toESM(require("node:path"));
function listNdjsonFiles(fs3, dirPath) {
  let names;
  try {
    names = fs3.readdirSync(dirPath);
  } catch (error) {
    if (isMissingDirectory(error)) {
      return [];
    }
    throw error;
  }
  return names.filter((name) => name.endsWith(".ndjson")).map((name) => {
    const stat = fs3.statSync(import_node_path4.default.join(dirPath, name));
    if (!stat.isFile()) {
      return null;
    }
    return {
      name,
      sizeBytes: stat.size,
      mtimeMs: stat.mtimeMs
    };
  }).filter((file) => file !== null);
}
function isMissingDirectory(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
function calculateLogUsage(options) {
  const totalBytes = options.files.reduce((sum, file) => sum + file.sizeBytes, 0);
  return {
    totalBytes,
    limitBytes: options.limitBytes,
    overLimit: totalBytes > options.limitBytes
  };
}
function selectPurgeTargets(options) {
  const targetBytes = options.limitBytes * 0.9;
  const purgeTargets = [];
  let selectedBytes = 0;
  const candidates = [...options.files].filter((file) => !options.currentFileNames.includes(file.name)).sort((left, right) => {
    if (left.mtimeMs !== right.mtimeMs) {
      return left.mtimeMs - right.mtimeMs;
    }
    return left.name.localeCompare(right.name);
  });
  for (const candidate of candidates) {
    purgeTargets.push(candidate.name);
    selectedBytes += candidate.sizeBytes;
    if (selectedBytes >= targetBytes) {
      break;
    }
  }
  return purgeTargets;
}

// src/ring-buffer.ts
var RingBuffer = class {
  capacity;
  items;
  head = 0;
  count = 0;
  constructor(capacity) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error("capacity must be an integer greater than or equal to 1");
    }
    this.capacity = capacity;
    this.items = new Array(capacity);
  }
  get size() {
    return this.count;
  }
  push(item) {
    if (this.count < this.capacity) {
      this.items[(this.head + this.count) % this.capacity] = item;
      this.count += 1;
      return;
    }
    this.items[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
  }
  toArray() {
    const snapshot = new Array(this.count);
    for (let index = 0; index < this.count; index += 1) {
      snapshot[index] = this.items[(this.head + index) % this.capacity];
    }
    return snapshot;
  }
};

// src/subnet-check.ts
var IPV4_SEGMENT_COUNT = 4;
function parseIpv4(value) {
  const parts = value.split(".");
  if (parts.length !== IPV4_SEGMENT_COUNT) {
    return null;
  }
  const octets = parts.map((part) => {
    if (!/^\d+$/.test(part)) {
      return null;
    }
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
      return null;
    }
    return octet;
  });
  const [first, second, third, fourth] = octets;
  if (first === null || second === null || third === null || fourth === null) {
    return null;
  }
  return [first, second, third, fourth];
}
function ipv4ToInt(octets) {
  return (octets[0] << 24 >>> 0 | octets[1] << 16 | octets[2] << 8 | octets[3]) >>> 0;
}
function isLoopbackIpv4(octets) {
  return octets[0] === 127;
}
function evaluateSubnetVerdict(destinationHost, interfaces) {
  const destinationIpv4 = parseIpv4(destinationHost);
  if (destinationIpv4 === null) {
    return {
      kind: "indeterminate",
      reason: destinationHost.includes(":") ? "ipv6Destination" : "hostname"
    };
  }
  if (isLoopbackIpv4(destinationIpv4)) {
    return { kind: "sameHost" };
  }
  for (const networkInterface of interfaces) {
    if (networkInterface.family !== "IPv4") {
      continue;
    }
    const interfaceAddress = parseIpv4(networkInterface.address);
    if (interfaceAddress === null) {
      continue;
    }
    if (ipv4ToInt(interfaceAddress) === ipv4ToInt(destinationIpv4)) {
      return { kind: "sameHost" };
    }
  }
  const candidates = interfaces.filter((networkInterface) => networkInterface.family === "IPv4" && !networkInterface.internal).map((networkInterface) => ({
    info: networkInterface,
    address: parseIpv4(networkInterface.address),
    netmask: parseIpv4(networkInterface.netmask)
  })).filter(
    (candidate) => candidate.address !== null && candidate.netmask !== null
  );
  if (candidates.length === 0) {
    return {
      kind: "indeterminate",
      reason: "noIpv4Interface"
    };
  }
  const destinationInt = ipv4ToInt(destinationIpv4);
  for (const candidate of candidates) {
    const addressInt = ipv4ToInt(candidate.address);
    const netmaskInt = ipv4ToInt(candidate.netmask);
    if ((destinationInt & netmaskInt) === (addressInt & netmaskInt)) {
      return {
        kind: "sameSubnet",
        matchedInterface: candidate.info.address
      };
    }
  }
  return {
    kind: "differentSubnet",
    checkedInterfaces: candidates.length
  };
}

// src/diagnostics-engine.ts
var MAX_RECORDED_STRING_LENGTH = 256;
var LOG_USAGE_POLL_INTERVAL_MS = 6e4;
var EMPTY_STATUS = {
  lastRttMs: null,
  consecutiveLosses: 0,
  lastPongSeq: null
};
var FALLBACK_SUBNET = {
  kind: "indeterminate",
  reason: "noIpv4Interface"
};
function createDiagnosticsEngine(deps) {
  const logWarn = deps.logWarn ?? console.warn;
  const logError = deps.logError ?? console.error;
  const logDirPath = import_node_path5.default.resolve(process.cwd(), deps.config.diagnostics.ndjsonDir);
  const clearIntervalFn = deps.clearIntervalFn ?? clearInterval;
  const recentMessages = new RingBuffer(deps.config.diagnostics.ringBufferSize);
  const lossRateWindow = new LossRateWindow(deps.config.diagnostics.lossRateWindow);
  const subnet = evaluateInitialSubnetVerdict(deps.config.unity.host, deps.interfacesProvider, logError);
  const writer = createNdjsonWriter({
    dir: deps.config.diagnostics.ndjsonDir,
    now: () => new Date(deps.now()),
    fs: deps.fs,
    logError
  });
  let logUsage = {
    totalBytes: 0,
    limitBytes: deps.config.diagnostics.ndjsonMaxTotalBytes,
    overLimit: false
  };
  let overLimitNotified = false;
  const record = (dir, address, args, host, port) => {
    if (isOscdeskAddress(address)) {
      return;
    }
    const message = {
      ts: new Date(deps.now()).toISOString(),
      dir,
      address,
      args: args.map(toRecordedArg),
      peer: {
        host,
        port
      }
    };
    recentMessages.push(message);
    writer.append(message);
  };
  const buildSnapshot = () => {
    const status = readStatus(deps.getStatus, logError);
    return DiagnosticsSnapshotSchema.parse({
      reachability: deriveReachability(status),
      lastRttMs: status.lastRttMs,
      consecutiveLosses: status.consecutiveLosses,
      lossRate: lossRateWindow.stats(),
      subnet,
      logUsage,
      recentMessages: recentMessages.toArray()
    });
  };
  const readLogFiles = () => listNdjsonFiles(deps.fs, logDirPath);
  const purgeLogsInternal = () => {
    const purgeTargets = selectPurgeTargets({
      files: readLogFiles(),
      limitBytes: deps.config.diagnostics.ndjsonMaxTotalBytes,
      currentFileNames: [writer.getCurrentFileName(), ...deps.protectedFileNames ?? [], ...deps.extraProtectedFiles?.() ?? []]
    });
    for (const target of purgeTargets) {
      try {
        deps.fs.unlinkSync(import_node_path5.default.join(logDirPath, target));
      } catch (error) {
        logError("(ERROR, CUSTOM MODULE)", `Failed to delete diagnostics log "${target}".`, error);
      }
    }
  };
  const refreshLogUsage = () => {
    const files = readLogFiles();
    logUsage = calculateLogUsage({
      files,
      limitBytes: deps.config.diagnostics.ndjsonMaxTotalBytes
    });
    if (logUsage.overLimit && !overLimitNotified) {
      overLimitNotified = true;
      logWarn("(WARN, CUSTOM MODULE)", "Diagnostics log usage exceeded the configured limit; purging old logs automatically.");
      purgeLogsInternal();
      logUsage = calculateLogUsage({
        files: readLogFiles(),
        limitBytes: deps.config.diagnostics.ndjsonMaxTotalBytes
      });
      if (!logUsage.overLimit) {
        overLimitNotified = false;
      }
    } else if (!logUsage.overLimit) {
      overLimitNotified = false;
    }
  };
  const logUsageTimer = (deps.setIntervalFn ?? setInterval)(() => {
    swallow(logError, refreshLogUsage);
  }, LOG_USAGE_POLL_INTERVAL_MS);
  swallow(logError, refreshLogUsage);
  return {
    recordIncoming(address, args, host, port) {
      swallow(logError, () => {
        record("in", address, args, host, port);
      });
    },
    recordOutgoing(address, args, host, port) {
      swallow(logError, () => {
        record("out", address, args, host, port);
      });
    },
    onPingCycle(event) {
      swallow(logError, () => {
        if (!event.previousLost) {
          return;
        }
        lossRateWindow.record("lost");
      });
    },
    onPongAccepted() {
      swallow(logError, () => {
        lossRateWindow.record("answered");
      });
    },
    snapshot() {
      try {
        return buildSnapshot();
      } catch (error) {
        logError("(ERROR, CUSTOM MODULE)", "Failed to build diagnostics snapshot.", error);
        return DiagnosticsSnapshotSchema.parse({
          reachability: "unknown",
          lastRttMs: null,
          consecutiveLosses: 0,
          lossRate: lossRateWindow.stats(),
          subnet,
          logUsage,
          recentMessages: recentMessages.toArray()
        });
      }
    },
    purgeLogs() {
      swallow(logError, () => {
        purgeLogsInternal();
        refreshLogUsage();
      });
    },
    getCurrentFileName() {
      return writer.getCurrentFileName();
    },
    dispose() {
      swallow(logError, () => {
        clearIntervalFn(logUsageTimer);
        writer.dispose();
      });
    }
  };
}
function evaluateInitialSubnetVerdict(destinationHost, interfacesProvider, logError) {
  try {
    return evaluateSubnetVerdict(destinationHost, interfacesProvider());
  } catch (error) {
    logError("(ERROR, CUSTOM MODULE)", "Failed to evaluate subnet verdict.", error);
    return FALLBACK_SUBNET;
  }
}
function readStatus(getStatus, logError) {
  try {
    return getStatus();
  } catch (error) {
    logError("(ERROR, CUSTOM MODULE)", "Failed to read ping monitor status.", error);
    return EMPTY_STATUS;
  }
}
function toRecordedArg(arg) {
  if (arg.type === "b") {
    return {
      kind: "blob",
      byteLength: readBlobLength(arg.value)
    };
  }
  if (typeof arg.value === "string") {
    return truncateRecordedString(arg.type, arg.value);
  }
  if (typeof arg.value === "number" || typeof arg.value === "boolean") {
    return {
      kind: "value",
      type: arg.type,
      value: arg.value
    };
  }
  return {
    kind: "value",
    type: arg.type,
    value: JSON.stringify(arg.value)
  };
}
function truncateRecordedString(type, value) {
  if (value.length <= MAX_RECORDED_STRING_LENGTH) {
    return {
      kind: "value",
      type,
      value
    };
  }
  return {
    kind: "value",
    type,
    value: value.slice(0, MAX_RECORDED_STRING_LENGTH),
    truncated: true
  };
}
function readBlobLength(value) {
  if (value instanceof Uint8Array) {
    return value.byteLength;
  }
  if (typeof value === "object" && value !== null && "byteLength" in value) {
    const byteLength = value.byteLength;
    if (typeof byteLength === "number" && Number.isInteger(byteLength) && byteLength >= 0) {
      return byteLength;
    }
  }
  return 0;
}
function swallow(logError, action) {
  try {
    action();
  } catch (error) {
    logError("(ERROR, CUSTOM MODULE)", error);
  }
}

// src/guard-event-log.ts
var import_node_path6 = __toESM(require("node:path"));
function createGuardEventLog(deps) {
  const logDirPath = import_node_path6.default.resolve(process.cwd(), deps.ndjsonDir);
  const writer = createNdjsonWriter({
    dir: deps.ndjsonDir,
    filePrefix: "oscdesk-guard",
    now: () => new Date(deps.now()),
    fs: deps.fs,
    logError: deps.logError
  });
  const enforceQuota = () => {
    try {
      const files = listNdjsonFiles(deps.fs, logDirPath);
      if (!calculateLogUsage({ files, limitBytes: deps.quota.limitBytes }).overLimit) {
        return;
      }
      const purgeTargets = selectPurgeTargets({
        files,
        limitBytes: deps.quota.limitBytes,
        currentFileNames: [writer.getCurrentFileName(), ...deps.extraProtectedFiles?.() ?? []]
      });
      for (const target of purgeTargets) {
        try {
          deps.fs.unlinkSync(import_node_path6.default.join(logDirPath, target));
        } catch (error) {
          deps.logError("(ERROR, CUSTOM MODULE)", `Failed to delete guard log "${target}".`, error);
        }
      }
    } catch (error) {
      deps.logError("(ERROR, CUSTOM MODULE)", "Failed to enforce guard log quota.", error);
    }
  };
  let count = 0;
  let latest = null;
  let disposed = false;
  return {
    recordRejection(event) {
      if (disposed) {
        return;
      }
      count += 1;
      const ts = new Date(deps.now()).toISOString();
      latest = {
        ts,
        expectedProjectId: event.expectedProjectId,
        receivedProjectId: event.receivedProjectId,
        peer: event.peer
      };
      if (!event.isRepeat) {
        const record = GuardEventRecordSchema.parse({
          ts,
          kind: "guard-reject",
          expectedProjectId: event.expectedProjectId,
          receivedProjectId: event.receivedProjectId,
          peer: event.peer
        });
        writer.append(record);
        enforceQuota();
        deps.logError(
          "(ERROR, CUSTOM MODULE)",
          `Manifest project mismatch: expected "${event.expectedProjectId}", received "${event.receivedProjectId}".`
        );
      }
    },
    snapshot() {
      return { rejectCount: count, latest };
    },
    getCurrentFileName() {
      return writer.getCurrentFileName();
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      writer.dispose();
    }
  };
}

// src/bridge-server.ts
var TEST_NETWORK_INTERFACES_ENV_VAR = "OSCDESK_TEST_NETWORK_INTERFACES";
async function startBridgeServer(options) {
  let udp;
  let hub;
  let core;
  let diagnosticsRef = null;
  let guardLogRef = null;
  const logWarn = options.logWarn ?? console.warn;
  const logError = options.logError ?? console.error;
  const oscListenPort = options.config.bridge.oscListenPort;
  const wsPort = options.config.bridge.wsPort;
  try {
    const unityAddresses = await resolveUnityAddresses(options.config.unity.host, logWarn);
    udp = await startUdpTransport({
      host: options.config.bridge.oscListenHost,
      port: oscListenPort,
      onMessage: (message) => core?.handleOscIn(message),
      onDecodeError: (error, from) => logWarn("(WARN, BRIDGE)", "OSC decode failed", from, error),
      onSocketError: (error) => logError("(ERROR, BRIDGE)", "UDP socket error", error)
    });
    hub = await startUiHub({
      host: options.config.bridge.wsHost,
      port: wsPort,
      onConnect: (clientId) => core?.onUiConnected(clientId),
      onDisconnect: (clientId) => core?.onUiDisconnected(clientId),
      onFrame: (frame, clientId) => core?.handleUiFrame(frame, clientId),
      onInvalidFrame: (clientId, reason, raw) => logWarn("(WARN, BRIDGE)", "Invalid UI frame", { clientId, reason, raw })
    });
    core = createSurfaceCore({
      config: options.config,
      unityAddresses,
      sendFn: (host, port, address, ...args) => udp?.send(host, port, address, args),
      sendBundleFn: (host, port, messages) => udp?.sendBundle(host, port, messages.map((message) => ({
        address: message.address,
        args: [...message.args]
      }))) ?? { ok: false, reason: "transport-unavailable" },
      publish: (frame, target) => target === void 0 ? hub?.broadcast(frame) : hub?.sendTo(target, frame),
      logInfo: options.logInfo,
      logWarn: options.logWarn,
      logError: options.logError,
      // 診断とガードは同じ NDJSON ディレクトリを共有するため、パージ時に互いの
      // カレントファイルを保護対象として問い合わせ合う(消し合い防止)。
      createDiagnosticsEngine: (deps) => {
        const engine = createDiagnosticsEngine({
          ...deps,
          interfacesProvider: createNetworkInterfacesProvider(),
          fs: nodeFs,
          logError,
          extraProtectedFiles: () => guardLogRef === null ? [] : [guardLogRef.getCurrentFileName()]
        });
        diagnosticsRef = engine;
        return engine;
      },
      createGuardEventLog: (deps) => {
        const guardLog = createGuardEventLog({
          ndjsonDir: options.config.diagnostics.ndjsonDir,
          fs: nodeFs,
          now: deps.now,
          logError,
          quota: { limitBytes: options.config.diagnostics.ndjsonMaxTotalBytes },
          extraProtectedFiles: () => diagnosticsRef === null ? [] : [diagnosticsRef.getCurrentFileName()]
        });
        guardLogRef = guardLog;
        return guardLog;
      }
    });
    core.start();
    return {
      wsPort: hub.port,
      oscListenPort: udp.port,
      async close() {
        core?.stop();
        await Promise.all([hub?.close(), udp?.close()]);
      }
    };
  } catch (error) {
    core?.stop();
    await Promise.allSettled([hub?.close(), udp?.close()]);
    throw error;
  }
}
var nodeFs = import_node_fs2.default;
async function resolveUnityAddresses(host, logWarn) {
  if (import_node_net.default.isIP(host) !== 0) return [];
  try {
    const results = await (0, import_promises.lookup)(host, { all: true });
    return results.map((result) => result.address);
  } catch (error) {
    logWarn("(WARN, BRIDGE)", `Failed to resolve unity.host "${host}".`, error);
    return [];
  }
}
function createNetworkInterfacesProvider() {
  const override = readNetworkInterfacesOverride(process.env);
  if (override !== null) return () => override;
  return () => Object.values(import_node_os.default.networkInterfaces()).flatMap(
    (entries) => (entries ?? []).map((entry) => ({
      address: entry.address,
      netmask: entry.netmask,
      family: entry.family === "IPv4" ? "IPv4" : "IPv6",
      internal: entry.internal
    }))
  );
}
function readNetworkInterfacesOverride(env) {
  const raw = env[TEST_NETWORK_INTERFACES_ENV_VAR];
  if (raw === void 0 || raw.trim() === "") return null;
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`${TEST_NETWORK_INTERFACES_ENV_VAR} must be a JSON array.`);
  }
  return parsed.map((entry, index) => normalizeNetworkInterfaceInfo(entry, index));
}
function normalizeNetworkInterfaceInfo(entry, index) {
  if (entry === null || typeof entry !== "object") {
    throw new Error(`${TEST_NETWORK_INTERFACES_ENV_VAR}[${index}] must be an object.`);
  }
  const candidate = entry;
  if (typeof candidate.address !== "string" || candidate.address.length === 0) {
    throw new Error(`${TEST_NETWORK_INTERFACES_ENV_VAR}[${index}].address must be a non-empty string.`);
  }
  if (typeof candidate.netmask !== "string" || candidate.netmask.length === 0) {
    throw new Error(`${TEST_NETWORK_INTERFACES_ENV_VAR}[${index}].netmask must be a non-empty string.`);
  }
  if (candidate.family !== "IPv4" && candidate.family !== "IPv6") {
    throw new Error(`${TEST_NETWORK_INTERFACES_ENV_VAR}[${index}].family must be "IPv4" or "IPv6".`);
  }
  if (typeof candidate.internal !== "boolean") {
    throw new Error(`${TEST_NETWORK_INTERFACES_ENV_VAR}[${index}].internal must be a boolean.`);
  }
  return {
    address: candidate.address,
    netmask: candidate.netmask,
    family: candidate.family,
    internal: candidate.internal
  };
}

// src/main.ts
function composeBridgeConfig(config, cli) {
  return {
    ...config,
    unity: {
      ...config.unity,
      ...cli.unityHost === void 0 ? {} : { host: cli.unityHost },
      ...cli.unityPort === void 0 ? {} : { sendPort: cli.unityPort }
    },
    debug: cli.debug ?? config.debug,
    bridge: {
      ...config.bridge,
      ...cli.oscListenPort === void 0 ? {} : { oscListenPort: cli.oscListenPort },
      ...cli.wsPort === void 0 ? {} : { wsPort: cli.wsPort }
    },
    ui: {
      ...config.ui,
      ...cli.uiPort === void 0 ? {} : { port: cli.uiPort }
    }
  };
}
async function main(argv = process.argv.slice(2)) {
  let cli;
  try {
    cli = parseCliArgs(argv);
  } catch (error) {
    throw new BridgeMainError(error instanceof Error ? error.message : String(error), 2);
  }
  const configPath = cli.configPath ?? resolveBridgeConfigPath();
  const loaded = loadBridgeConfig({ path: configPath });
  if (!loaded.ok) throw new BridgeMainError(formatConfigLoadError(loaded.error), 2);
  const config = composeBridgeConfig(loaded.value, cli);
  const server = await startBridgeServer({ config });
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await server.close();
  };
  const onSignal = () => void shutdown().then(() => process.exit(0), () => process.exit(1));
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  const ready = {
    wsHost: config.bridge.wsHost,
    wsPort: server.wsPort,
    oscListenPort: server.oscListenPort,
    unity: { host: config.unity.host, sendPort: config.unity.sendPort },
    uiHost: config.ui.host,
    uiPort: config.ui.port,
    protocolVersion: 1,
    debug: config.debug,
    configPath
  };
  process.stdout.write(`OSCDESK_BRIDGE_READY ${JSON.stringify(ready)}
`);
}
var BridgeMainError = class extends Error {
  constructor(message, exitCode) {
    super(message);
    this.exitCode = exitCode;
  }
};
function exitCodeFor(error) {
  if (error instanceof BridgeMainError) return error.exitCode;
  if (isPortBindError(error)) return 3;
  return 1;
}
function isPortBindError(error) {
  return typeof error === "object" && error !== null && ["EADDRINUSE", "EACCES", "EADDRNOTAVAIL"].includes(String(error.code));
}

// src/index.ts
if (require.main === module) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`OSCDESK_BRIDGE_ERROR ${JSON.stringify({ message })}
`);
    process.exit(exitCodeFor(error));
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BridgeMainError,
  DEFAULT_UI_PORT,
  DEFAULT_WS_PORT,
  composeBridgeConfig,
  exitCodeFor,
  main,
  parseCliArgs,
  startBridgeServer
});
