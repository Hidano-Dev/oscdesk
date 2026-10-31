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
  const { data, path: path13, errorMaps, issueData } = params;
  const fullPath = [...path13, ...issueData.path || []];
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
  constructor(parent, value, path13, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path13;
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

// ../shared/src/catalog.ts
var CATALOG_ADDRESSES = {
  BEGIN: "/sys/catalog/begin",
  ADD: "/sys/catalog/add",
  REMOVE: "/sys/catalog/remove",
  END: "/sys/catalog/end",
  DIGEST: "/sys/catalog/digest",
  REQUEST: "/sys/catalog/request"
};
var CATALOG = {
  MAX_PCS: 64,
  MAX_ITEMS_PER_PC: 4096,
  MAX_PROPS_PER_ITEM: 32,
  MAX_STRING_CHARS: 1024,
  MAX_NAME_CHARS: 64,
  // 1 項目を JSON にした大きさの上限。1 項目 1 メッセージで送るため、1 データグラム(60 KiB)に余裕を持って収める
  MAX_ITEM_BYTES: 8 * 1024,
  // 全 PC の項目を JSON にした大きさの目安の上限。catalog フレームは 1 フレームで全量を送るため、UI の受信上限(16 MiB)に余裕を持って収める
  MAX_TOTAL_BYTES: 8 * 1024 * 1024
};
var PROP_KEY_PATTERN = /^[A-Za-z0-9_.-]{1,32}$/;
var CatalogPropValueSchema = external_exports.discriminatedUnion("type", [
  external_exports.object({ type: external_exports.literal("i"), value: external_exports.number().int().min(-2147483648).max(2147483647) }).strict(),
  // 無限大・NaN は JSON で null になり、フレーム全体(全 PC)が UI で読めなくなるため受けない
  external_exports.object({ type: external_exports.literal("f"), value: external_exports.number().finite() }).strict(),
  external_exports.object({ type: external_exports.literal("s"), value: external_exports.string().max(CATALOG.MAX_STRING_CHARS) }).strict()
]);
var CatalogPropSchema = external_exports.object({
  key: external_exports.string().regex(PROP_KEY_PATTERN),
  arg: CatalogPropValueSchema
}).strict();
function catalogItemBytes(item) {
  const normalized = {
    ...item,
    props: item.props.map((prop) => prop.arg.type === "f" && typeof prop.arg.value === "number" ? { ...prop, arg: { ...prop.arg, value: Math.fround(prop.arg.value) } } : prop)
  };
  return Buffer.byteLength(JSON.stringify(normalized), "utf8");
}
var CatalogItemSchema = external_exports.object({
  address: external_exports.string().startsWith("/").max(CATALOG.MAX_STRING_CHARS),
  kind: external_exports.string().min(1).max(32),
  type: external_exports.string().min(1).max(32),
  // 同じキーを繰り返してよい(options は 1 回に 1 つ)。並びは送られた順
  props: external_exports.array(CatalogPropSchema).max(CATALOG.MAX_PROPS_PER_ITEM)
}).strict().refine((item) => catalogItemBytes(item) <= CATALOG.MAX_ITEM_BYTES, {
  message: `item is larger than ${String(CATALOG.MAX_ITEM_BYTES)} bytes`
});
var CRC_TABLE = (() => {
  const table = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) === 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
    table.push(c >>> 0);
  }
  return table;
})();
function crc32(bytes) {
  let crc = 4294967295;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ crc >>> 8;
  return crc ^ 4294967295 | 0;
}
function escapeField(text) {
  return text.replace(/%/g, "%25").replace(/\t/g, "%09").replace(/\n/g, "%0A").replace(/\r/g, "%0D");
}
function floatBitsHex(value) {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value, false);
  return view.getUint32(0, false).toString(16).padStart(8, "0");
}
function propText(prop) {
  const { arg } = prop;
  const text = arg.type === "i" ? String(arg.value) : arg.type === "f" ? floatBitsHex(arg.value) : escapeField(arg.value);
  return `${prop.key}=${arg.type}:${text}`;
}
function compareBytes(a, b) {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return Buffer.compare(left, right);
}
function canonicalCatalogText(items) {
  const sorted = [...items].sort((a, b) => compareBytes(a.address, b.address));
  return sorted.map((item) => {
    const props2 = item.props.map((prop, index) => ({ prop, index })).sort((a, b) => compareBytes(a.prop.key, b.prop.key) || a.index - b.index).map((entry) => propText(entry.prop));
    return [escapeField(item.address), escapeField(item.kind), escapeField(item.type), ...props2].join("	") + "\n";
  }).join("");
}
function catalogDigest(items) {
  return { count: items.length, crc: crc32(Buffer.from(canonicalCatalogText(items), "utf8")) };
}
function parseCatalogAdd(args) {
  const [address, kind, type, ...rest] = args;
  if (address?.type !== "s" || kind?.type !== "s" || type?.type !== "s") return { ok: false, reason: "address, kind and type must be strings" };
  if (rest.length % 2 !== 0) return { ok: false, reason: "properties must be key/value pairs" };
  const props2 = [];
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (key.type !== "s") return { ok: false, reason: "property key must be a string" };
    if (value.type === "b") return { ok: false, reason: "property value must be i, f or s" };
    props2.push({ key: key.value, arg: { type: value.type, value: value.value } });
  }
  const parsed = CatalogItemSchema.safeParse({ address: address.value, kind: kind.value, type: type.value, props: props2 });
  return parsed.success ? { ok: true, item: parsed.data } : { ok: false, reason: parsed.error.issues[0]?.message ?? "invalid item" };
}
var CatalogPcSchema = external_exports.object({
  host: external_exports.string().min(1),
  name: external_exports.string().min(1).max(CATALOG.MAX_NAME_CHARS),
  receivedAt: external_exports.string().datetime({ offset: true }),
  // 要約値の照合結果。true = 一致、false = 食い違い(Sync で取り直す)、null = まだ照合していない
  verified: external_exports.boolean().nullable(),
  items: external_exports.array(CatalogItemSchema)
}).strict();

// ../shared/src/address-pattern.ts
function isValidAddressShape(address) {
  return address.startsWith("/") && address.length > 1 && !address.endsWith("/") && !address.includes("//") && !address.split("/").slice(1).some((part) => part.length === 0) && ![...address].some((character) => "?[]{},".includes(character));
}
function matchesPattern(pattern, address) {
  if (!isValidAddressShape(pattern) || !isValidAddressShape(address)) {
    return false;
  }
  const patternParts = pattern.split("/");
  const addressParts = address.split("/");
  if (patternParts.length !== addressParts.length) {
    return false;
  }
  return patternParts.every((part, index) => partPatternMatches(part, addressParts[index] ?? ""));
}
function partPatternMatches(pattern, value) {
  const expression = [...pattern].map((character) => character === "*" ? ".*" : escapeRegExp(character)).join("");
  return new RegExp(`^${expression}$`, "u").test(value);
}
function escapeRegExp(character) {
  return /[\\^$.*+?()[\]{}|]/.test(character) ? `\\${character}` : character;
}

// ../shared/src/limits.ts
var OSC_BATCH = {
  MAX_MESSAGES: 512,
  PRACTICAL_LIMIT_BYTES: 60 * 1024
};
var SENT_LOG = {
  CAPACITY: 1e3,
  MAX_RECORDS_PER_FRAME: 100,
  FLUSH_INTERVAL_MS: 250,
  COALESCE_WINDOW_MS: 1e3,
  MAX_ARGS: 16,
  MAX_STRING_CHARS: 120,
  MAX_BLOB_BYTES: 32
};
var DESTINATIONS = {
  MAX_SELECTED_HOSTS: 256,
  MAX_SCAN_INTERFACES: 4,
  MIN_SCAN_PREFIX: 24,
  // 端末の別名(D-092)。1 件の文字数と、ブリッジが覚える件数の上限。UI は認証なしで誰でも送れるので、
  // 件数を縛らないと別名のファイルと destinations フレームをいくらでも膨らませられる
  MAX_ALIAS_CHARS: 64,
  // 上りの destinationsAlias で受ける長さ。別名の上限より広く取り、前後の空白込みで少し長い入力もフレームとしては受けて、
  // ブリッジが理由つきで断る(フレームの検査で落とすと UI に何も返らない)。それでも際限なくは受けない
  MAX_ALIAS_INPUT_CHARS: 256,
  MAX_DEVICE_ALIASES: 512
};

// ../shared/src/schemas.ts
var nonNegativeInt = external_exports.number().int().nonnegative();
var positiveInt = external_exports.number().int().positive();
var iso8601Timestamp = external_exports.string().datetime({ offset: true });
var oscAddress = external_exports.string().startsWith("/");
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
var SurfacesConfigSchema = external_exports.object({
  dir: external_exports.string().min(1).default("surfaces"),
  defaultName: external_exports.string().min(1).optional(),
  valuesDir: external_exports.string().min(1).optional(),
  padsDir: external_exports.string().min(1).optional()
}).strict().default({});
var DestinationsConfigSchema = external_exports.object({
  file: external_exports.string().min(1).optional(),
  aliasesFile: external_exports.string().min(1).optional(),
  scanTimeoutMs: external_exports.number().int().min(1e3).max(6e4).default(8e3)
}).strict().default({});
var UnityTargetNameSchema = external_exports.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/);
var UnityConfigSchema = external_exports.object({
  name: UnityTargetNameSchema.default("unity"),
  host: external_exports.string().min(1),
  sendPort: PortSchema,
  secondary: external_exports.array(external_exports.object({
    name: UnityTargetNameSchema,
    host: external_exports.string().min(1),
    sendPort: PortSchema
  }).strict()).default([])
}).strict().superRefine((unity, ctx) => {
  const seen = /* @__PURE__ */ new Set([unity.name]);
  unity.secondary.forEach((target, index) => {
    if (seen.has(target.name)) {
      ctx.addIssue({ code: "custom", path: ["secondary", index, "name"], message: `duplicate unity target name "${target.name}"` });
    }
    seen.add(target.name);
  });
});
var BridgeConfigSchema = external_exports.object({
  unity: UnityConfigSchema,
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
  diagnostics: SurfaceDiagnosticsConfigSchema,
  oscUi: OscUiConfigSchema,
  surfaces: SurfacesConfigSchema,
  destinations: DestinationsConfigSchema
}).strict();
function resolveUnityTargets(unity) {
  return [
    { name: unity.name, host: unity.host, sendPort: unity.sendPort, primary: true },
    ...unity.secondary.map((target) => ({ ...target, primary: false }))
  ];
}

// ../shared/src/surface-definition.ts
var SURFACE_DEFINITION_FORMAT = "oscdesk-surface";
var SURFACE_DEFINITION_VERSION = 1;
var INT32_MIN = -2147483648;
var INT32_MAX = 2147483647;
var PARAMETER_ADDRESS_PATTERN = "^(?!/(?:sys|oscdesk)(?:/|(?![\\s\\S])))(?:/[^\\s/?\\[\\]{},*]+)+(?![\\s\\S])";
var ADDRESS_MATCH_PATTERN = "^(?:/[^\\s/?\\[\\]{},]+)+(?![\\s\\S])";
var IDENTIFIER_PATTERN = "^[A-Za-z][A-Za-z0-9_-]{0,63}(?![\\s\\S])";
var identifierSchema = external_exports.string().regex(new RegExp(IDENTIFIER_PATTERN));
var labelSchema = external_exports.string().min(1);
var concreteAddressSchema = external_exports.string().regex(new RegExp(PARAMETER_ADDRESS_PATTERN));
var listSourceSchema = external_exports.object({ address: concreteAddressSchema, request: concreteAddressSchema.optional() }).strict();
var RECORD_KEYS_MAX = 1e3;
var keysFromSchema = external_exports.object({
  address: concreteAddressSchema,
  request: concreteAddressSchema.optional(),
  source: external_exports.enum(["unity", "ui"]).optional(),
  max: external_exports.number().int().min(1).max(RECORD_KEYS_MAX).optional()
}).strict();
var SURFACE_WIDGET_HINTS = ["slider", "switch", "button", "input", "select"];
var parameterBaseFields = {
  id: identifierSchema,
  address: concreteAddressSchema,
  label: labelSchema,
  // state: Unity の現在値を表し、再接続時に再送する。trigger: 押した瞬間だけの「きっかけ」で再送しない。
  kind: external_exports.enum(["state", "trigger"]),
  // false なら単独では送れず、複数メッセージ列の一部としてのみ送る(HID-166)。省略時は true。
  standalone: external_exports.boolean().optional(),
  // 表示ヒント(HID-377)。画面層の widget が無いときの既定。無ければ型と制約から決める(D-103)。
  widget: external_exports.enum(SURFACE_WIDGET_HINTS).optional()
};
var rangeSchema = external_exports.tuple([external_exports.number(), external_exports.number()]);
var numericParameter = (type) => external_exports.object({
  ...parameterBaseFields,
  type: external_exports.literal(type),
  range: rangeSchema.optional(),
  step: external_exports.number().positive().optional(),
  default: external_exports.number().optional(),
  // trigger が押下で送る引数。state では使わない(意味層で検査)。
  value: external_exports.number().optional()
}).strict();
var SurfaceParameterSchema = external_exports.discriminatedUnion("type", [
  numericParameter("i"),
  numericParameter("f"),
  external_exports.object({
    ...parameterBaseFields,
    type: external_exports.literal("s"),
    // 静的な候補。optionsFrom と併記したときは、Unity の一覧の前に固定で付く候補になる(D-053)
    options: external_exports.array(external_exports.string()).min(1).optional(),
    // Unity が実行時に持つ文字列の一覧を受けるアドレス(D-053)。一覧は値であり、定義は書き換えない。
    // request を書くとブリッジがそこへ引数なしの要求を送る。省略時は Unity の自発送信だけを待つ
    optionsFrom: listSourceSchema.optional(),
    default: external_exports.string().optional(),
    value: external_exports.string().optional()
  }).strict(),
  external_exports.object({
    ...parameterBaseFields,
    type: external_exports.literal("bool"),
    default: external_exports.boolean().optional(),
    value: external_exports.boolean().optional()
  }).strict()
]);
var numericRecordField = (type) => external_exports.object({
  id: identifierSchema,
  label: labelSchema,
  type: external_exports.literal(type),
  range: rangeSchema.optional(),
  step: external_exports.number().positive().optional(),
  default: external_exports.number().optional(),
  value: external_exports.number().optional()
}).strict();
var SurfaceRecordFieldSchema = external_exports.discriminatedUnion("type", [
  numericRecordField("i"),
  numericRecordField("f"),
  external_exports.object({
    id: identifierSchema,
    label: labelSchema,
    type: external_exports.literal("s"),
    options: external_exports.array(external_exports.string()).min(1).optional(),
    optionsFrom: listSourceSchema.optional(),
    default: external_exports.string().optional(),
    value: external_exports.string().optional()
  }).strict(),
  external_exports.object({
    id: identifierSchema,
    label: labelSchema,
    type: external_exports.literal("bool"),
    default: external_exports.boolean().optional(),
    value: external_exports.boolean().optional()
  }).strict()
]);
var SurfaceRecordSchema = external_exports.object({
  id: identifierSchema,
  address: concreteAddressSchema,
  label: labelSchema,
  kind: external_exports.enum(["state", "trigger"]),
  // キーの型は s だけなので型の欄は置かない
  key: external_exports.object({ label: labelSchema.optional() }).strict().optional(),
  keysFrom: keysFromSchema,
  fields: external_exports.array(SurfaceRecordFieldSchema)
}).strict();
var fixedValueSchema = external_exports.union([external_exports.number(), external_exports.string(), external_exports.boolean()]);
var actionStepSchema = external_exports.union([
  // param: そのパラメータ 1 件。value があれば固定値、無ければ state は現在値・trigger は定義の value
  external_exports.object({ param: identifierSchema, value: fixedValueSchema.optional() }).strict(),
  // match: アドレスパターン(`*` は 1 パート内の 0 文字以上)に合う全パラメータを定義順に。現在値(trigger は定義の value)を送る
  external_exports.object({ match: external_exports.string().regex(new RegExp(ADDRESS_MATCH_PATTERN)) }).strict(),
  // record: 行 1 つ分のレコードのメッセージ(D-061)。scope を持つアクションだけが使える。
  // state はその行の現在値、value に書いたフィールドだけ固定値で上書き。trigger はフィールドの定義の value
  // value のキーはフィールド id なので identifier に縛る。z.string() のままだと zod の record が `__proto__` を
  // 黙って落とし、Python(未知のフィールドとして拒否)と判定が食い違う
  external_exports.object({ record: identifierSchema, value: external_exports.record(identifierSchema, fixedValueSchema).optional() }).strict()
]);
var SurfaceActionSchema = external_exports.object({
  id: identifierSchema,
  label: labelSchema,
  // row: 押した行のキーについて展開する。all: 表示中の全行について行ごとに展開する(D-061)。省略は従来のアクション
  scope: external_exports.enum(["row", "all"]).optional(),
  steps: external_exports.array(actionStepSchema).min(1)
}).strict();
var widthSchema = external_exports.union([external_exports.literal("auto"), external_exports.number().int().min(1).max(12)]);
var SurfaceLayoutNodeSchema = external_exports.lazy(
  () => external_exports.discriminatedUnion("kind", [
    external_exports.object({
      kind: external_exports.literal("control"),
      param: identifierSchema,
      widget: external_exports.enum(SURFACE_WIDGET_HINTS).optional(),
      label: labelSchema.optional(),
      width: widthSchema.optional()
    }).strict(),
    external_exports.object({
      kind: external_exports.literal("action"),
      action: identifierSchema,
      label: labelSchema.optional(),
      width: widthSchema.optional()
    }).strict(),
    external_exports.object({
      kind: external_exports.literal("record"),
      record: identifierSchema,
      label: labelSchema.optional(),
      width: widthSchema.optional(),
      columns: external_exports.array(
        external_exports.object({
          field: identifierSchema,
          widget: external_exports.enum(SURFACE_WIDGET_HINTS).optional(),
          label: labelSchema.optional(),
          actions: external_exports.array(identifierSchema).optional(),
          toggle: external_exports.object({ label: labelSchema, on: identifierSchema, off: identifierSchema }).strict().optional()
        }).strict()
      ).optional(),
      rowActions: external_exports.array(identifierSchema).optional(),
      tableActions: external_exports.array(identifierSchema).optional(),
      editRows: external_exports.boolean().optional()
    }).strict(),
    external_exports.object({ kind: external_exports.literal("row"), children: external_exports.array(SurfaceLayoutNodeSchema), width: widthSchema.optional() }).strict(),
    external_exports.object({ kind: external_exports.literal("column"), children: external_exports.array(SurfaceLayoutNodeSchema), width: widthSchema.optional() }).strict(),
    external_exports.object({
      kind: external_exports.literal("group"),
      label: labelSchema,
      collapsed: external_exports.boolean().optional(),
      children: external_exports.array(SurfaceLayoutNodeSchema),
      width: widthSchema.optional()
    }).strict(),
    external_exports.object({
      kind: external_exports.literal("tabs"),
      tabs: external_exports.array(external_exports.object({ label: labelSchema, children: external_exports.array(SurfaceLayoutNodeSchema) }).strict()).min(1),
      width: widthSchema.optional()
    }).strict()
  ])
);
var SurfaceScreenSchema = external_exports.object({
  id: identifierSchema,
  label: labelSchema,
  children: external_exports.array(SurfaceLayoutNodeSchema)
}).strict();
var SurfaceDefinitionStructureSchema = external_exports.object({
  format: external_exports.literal(SURFACE_DEFINITION_FORMAT),
  version: external_exports.literal(SURFACE_DEFINITION_VERSION),
  name: labelSchema,
  parameters: external_exports.array(SurfaceParameterSchema),
  // 省略可。parameters に混ぜないのは、既存のパラメータ処理(match・resolveActionSteps・保持値)を変えずに済ませるため(D-061)
  records: external_exports.array(SurfaceRecordSchema).optional(),
  // 省略可。無い定義(HID-166 以前)もそのまま有効
  actions: external_exports.array(SurfaceActionSchema).optional(),
  screens: external_exports.array(SurfaceScreenSchema)
}).strict();
function widgetFits(widget, target) {
  switch (widget) {
    case "slider":
      return target.kind === "state" && (target.type === "i" || target.type === "f") && target.range !== void 0;
    case "switch":
      return target.kind === "state" && target.type === "bool";
    case "button":
      return target.kind === "trigger";
    case "select":
      return target.kind === "state" && target.type === "s" && (target.options !== void 0 || target.optionsFrom !== void 0);
    case "input":
      return target.kind === "state" && (target.type === "s" || target.type === "i" || target.type === "f");
    default:
      return false;
  }
}
function checkNumber(spec, field, path13, issues) {
  if (spec.type !== "i" && spec.type !== "f") return;
  const current = spec[field];
  if (current === void 0) return;
  if (spec.type === "i" && (!Number.isInteger(current) || current < INT32_MIN || current > INT32_MAX)) {
    issues.push({ path: [...path13, field], message: "type i requires an int32 value" });
  }
  if (spec.range !== void 0 && (current < spec.range[0] || current > spec.range[1])) {
    issues.push({ path: [...path13, field], message: `${field} must be within range` });
  }
}
function collectValueSpecIssues(spec, kind, owner, path13, issues) {
  const at = (field) => [...path13, field];
  if (kind === "state") {
    if (spec.value !== void 0) {
      issues.push({ path: at("value"), message: `state ${owner} cannot define value` });
    }
    if (owner === "record field" && spec.default === void 0) {
      issues.push({ path: at("default"), message: "state record field requires default" });
    }
  } else {
    if (spec.value === void 0) {
      issues.push({ path: at("value"), message: `trigger ${owner} requires value` });
    }
    for (const field of ["default", "range", "options", "step", "optionsFrom"]) {
      if (field in spec) {
        issues.push({ path: at(field), message: `trigger ${owner} cannot define ${field}` });
      }
    }
  }
  if ((spec.type === "i" || spec.type === "f") && spec.range !== void 0) {
    if (spec.range[0] >= spec.range[1]) {
      issues.push({ path: at("range"), message: "range minimum must be less than maximum" });
    }
    if (spec.step !== void 0 && spec.step > spec.range[1] - spec.range[0]) {
      issues.push({ path: at("step"), message: "step must not exceed the range width" });
    }
    if (spec.type === "i" && !spec.range.every((bound) => Number.isInteger(bound) && bound >= INT32_MIN && bound <= INT32_MAX)) {
      issues.push({ path: at("range"), message: "type i requires int32 range bounds" });
    }
  }
  if (spec.type === "i" && spec.step !== void 0 && !Number.isInteger(spec.step)) {
    issues.push({ path: at("step"), message: "type i requires an integer step" });
  }
  checkNumber(spec, "default", path13, issues);
  checkNumber(spec, "value", path13, issues);
  if (spec.type === "s" && spec.options !== void 0) {
    if (new Set(spec.options).size !== spec.options.length) {
      issues.push({ path: at("options"), message: "options must be unique" });
    }
    for (const field of spec.optionsFrom === void 0 ? ["default", "value"] : ["value"]) {
      const current = spec[field];
      if (current !== void 0 && !spec.options.includes(current)) {
        issues.push({ path: at(field), message: `${field} must be one of options` });
      }
    }
  }
}
function indexById(items) {
  const index = /* @__PURE__ */ new Map();
  for (const item of items) if (!index.has(item.id)) index.set(item.id, item);
  return index;
}
function createFieldIndex() {
  const cache = /* @__PURE__ */ new Map();
  return (record) => {
    let index = cache.get(record);
    if (index === void 0) {
      index = indexById(record.fields);
      cache.set(record, index);
    }
    return index;
  };
}
function fixedValueProblem(spec, value) {
  switch (spec.type) {
    case "bool":
      return typeof value === "boolean" ? void 0 : "type bool requires a boolean value";
    case "s":
      if (typeof value !== "string") return "type s requires a string value";
      return spec.options !== void 0 && spec.optionsFrom === void 0 && !spec.options.includes(value) ? "value must be one of options" : void 0;
    case "i":
    case "f":
      if (typeof value !== "number") return `type ${spec.type} requires a number value`;
      if (spec.type === "i" && (!Number.isInteger(value) || value < INT32_MIN || value > INT32_MAX)) {
        return "type i requires an int32 value";
      }
      if (spec.range !== void 0 && (value < spec.range[0] || value > spec.range[1])) {
        return "value must be within range";
      }
      return void 0;
  }
}
function collectScopedActionIssues(action, actionIndex, recordsById, fieldIndexOf, issues) {
  let keysAddress;
  action.steps.forEach((step, stepIndex) => {
    const stepPath = ["actions", actionIndex, "steps", stepIndex];
    if (!("record" in step)) {
      issues.push({ path: stepPath, message: "scoped action can only have record steps" });
      return;
    }
    const record = recordsById.get(step.record);
    if (record === void 0) {
      issues.push({ path: [...stepPath, "record"], message: `unknown record: ${step.record}` });
      return;
    }
    if (keysAddress === void 0) {
      keysAddress = record.keysFrom.address;
    } else if (record.keysFrom.address !== keysAddress) {
      issues.push({ path: [...stepPath, "record"], message: "records in a scoped action must share the same keysFrom address" });
    }
    if (step.value === void 0) return;
    if (record.kind === "trigger") {
      issues.push({ path: [...stepPath, "value"], message: "trigger record keeps its own values; step cannot override them" });
      return;
    }
    for (const [fieldId, value] of Object.entries(step.value)) {
      const field = fieldIndexOf(record).get(fieldId);
      if (field === void 0) {
        issues.push({ path: [...stepPath, "value", fieldId], message: `unknown field: ${fieldId}` });
        continue;
      }
      const problem = fixedValueProblem(field, value);
      if (problem !== void 0) issues.push({ path: [...stepPath, "value", fieldId], message: problem });
    }
  });
}
function collectActionIssues(definition, fieldIndexOf, issues) {
  const actionIds = /* @__PURE__ */ new Set();
  const parametersById = indexById(definition.parameters);
  const recordsById = indexById(definition.records ?? []);
  (definition.actions ?? []).forEach((action, actionIndex) => {
    if (actionIds.has(action.id)) {
      issues.push({ path: ["actions", actionIndex, "id"], message: "duplicate action id" });
    }
    actionIds.add(action.id);
    if (action.steps.length > OSC_BATCH.MAX_MESSAGES) {
      issues.push({ path: ["actions", actionIndex, "steps"], message: `action has more than ${OSC_BATCH.MAX_MESSAGES} steps` });
      return;
    }
    if (action.scope !== void 0) {
      collectScopedActionIssues(action, actionIndex, recordsById, fieldIndexOf, issues);
      return;
    }
    let total = 0;
    action.steps.forEach((step, stepIndex) => {
      const at = (field) => ["actions", actionIndex, "steps", stepIndex, field];
      if ("record" in step) {
        issues.push({ path: at("record"), message: "record step requires action scope (row or all)" });
      } else if ("param" in step) {
        const parameter = parametersById.get(step.param);
        if (parameter === void 0) {
          issues.push({ path: at("param"), message: `unknown parameter: ${step.param}` });
          return;
        }
        total += 1;
        if (step.value !== void 0) {
          if (parameter.kind === "trigger") {
            issues.push({ path: at("value"), message: "trigger parameter keeps its own value; step cannot override it" });
          } else {
            const problem = fixedValueProblem(parameter, step.value);
            if (problem !== void 0) issues.push({ path: at("value"), message: problem });
          }
        }
      } else {
        const hits = total > OSC_BATCH.MAX_MESSAGES ? Number(definition.parameters.some((parameter) => matchesPattern(step.match, parameter.address))) : definition.parameters.filter((parameter) => matchesPattern(step.match, parameter.address)).length;
        if (hits === 0) issues.push({ path: at("match"), message: `match hits no parameter: ${step.match}` });
        total += hits;
      }
    });
    if (total > OSC_BATCH.MAX_MESSAGES) {
      issues.push({ path: ["actions", actionIndex, "steps"], message: `action expands to more than ${OSC_BATCH.MAX_MESSAGES} messages` });
    }
  });
}
function listSources(definition) {
  const sources = [];
  definition.parameters.forEach((parameter, index) => {
    if (parameter.type === "s" && parameter.optionsFrom !== void 0) {
      sources.push({ path: ["parameters", index, "optionsFrom"], label: "optionsFrom", ...parameter.optionsFrom });
    }
  });
  (definition.records ?? []).forEach((record, index) => {
    sources.push({ path: ["records", index, "keysFrom"], label: "keysFrom", ...record.keysFrom });
    record.fields.forEach((field, fieldIndex) => {
      if (field.type === "s" && field.optionsFrom !== void 0) {
        sources.push({ path: ["records", index, "fields", fieldIndex, "optionsFrom"], label: "optionsFrom", ...field.optionsFrom });
      }
    });
  });
  return sources;
}
function collectListSourceIssues(definition, valueAddresses, issues) {
  const sources = listSources(definition);
  const listAddresses = new Set(sources.map((source) => source.address));
  for (const { path: path13, label, address, request } of sources) {
    if (valueAddresses.has(address)) {
      issues.push({ path: [...path13, "address"], message: `${label} address must not be a parameter or record address` });
    }
    if (request === void 0) continue;
    if (valueAddresses.has(request)) {
      issues.push({ path: [...path13, "request"], message: `${label} request must not be a parameter or record address` });
    }
    if (listAddresses.has(request)) {
      issues.push({ path: [...path13, "request"], message: `${label} request must not be a list address (optionsFrom or keysFrom)` });
    }
  }
  collectKeySourceIssues(definition, sources, issues);
}
function collectKeySourceIssues(definition, sources, issues) {
  const byAddress = /* @__PURE__ */ new Map();
  (definition.records ?? []).forEach((record, index) => {
    const path13 = ["records", index, "keysFrom"];
    const source = record.keysFrom.source ?? "unity";
    if (source === "ui" && record.keysFrom.request !== void 0) {
      issues.push({ path: [...path13, "request"], message: "keysFrom with source ui must not have a request" });
    }
    if (source !== "ui" && record.keysFrom.max !== void 0) {
      issues.push({ path: [...path13, "max"], message: "keysFrom max needs source ui" });
    }
    const seen = byAddress.get(record.keysFrom.address);
    if (seen === void 0) {
      byAddress.set(record.keysFrom.address, { source, max: record.keysFrom.max });
    } else if (seen.source !== source || seen.max !== record.keysFrom.max) {
      issues.push({ path: path13, message: "records sharing a keysFrom address must agree on source and max" });
    }
  });
  for (const { path: path13, label, address } of sources) {
    if (label === "optionsFrom" && byAddress.get(address)?.source === "ui") {
      issues.push({ path: [...path13, "address"], message: "optionsFrom address must not be a keysFrom address with source ui" });
    }
  }
}
function collectRecordIssues(definition, parameterIds, valueAddresses, issues) {
  const recordIds = /* @__PURE__ */ new Set();
  (definition.records ?? []).forEach((record, index) => {
    if (recordIds.has(record.id)) {
      issues.push({ path: ["records", index, "id"], message: "duplicate record id" });
    }
    if (parameterIds.has(record.id)) {
      issues.push({ path: ["records", index, "id"], message: "record id must not be a parameter id" });
    }
    recordIds.add(record.id);
    if (valueAddresses.has(record.address)) {
      issues.push({ path: ["records", index, "address"], message: "record address must not be a parameter or record address" });
    }
    valueAddresses.add(record.address);
    if (record.kind === "state" && record.fields.length === 0) {
      issues.push({ path: ["records", index, "fields"], message: "state record requires at least one field" });
    }
    const fieldIds = /* @__PURE__ */ new Set();
    record.fields.forEach((field, fieldIndex) => {
      if (fieldIds.has(field.id)) {
        issues.push({ path: ["records", index, "fields", fieldIndex, "id"], message: "duplicate field id" });
      }
      fieldIds.add(field.id);
      collectValueSpecIssues(field, record.kind, "record field", ["records", index, "fields", fieldIndex], issues);
    });
  });
}
function collectRecordNodeIssues(node, here, recordsById, actionsById, keysAddressesOf, fieldIndexOf, issues) {
  const record = recordsById.get(node.record);
  if (record === void 0) {
    issues.push({ path: [...here, "record"], message: `unknown record: ${node.record}` });
  } else if (node.columns !== void 0) {
    const seen = /* @__PURE__ */ new Set();
    node.columns.forEach((column, columnIndex) => {
      const columnPath = [...here, "columns", columnIndex];
      if (seen.has(column.field)) {
        issues.push({ path: [...columnPath, "field"], message: `duplicate column field: ${column.field}` });
      }
      seen.add(column.field);
      const field = fieldIndexOf(record).get(column.field);
      if (field === void 0) {
        issues.push({ path: [...columnPath, "field"], message: `unknown field: ${column.field}` });
      } else if (column.widget !== void 0 && !widgetFits(column.widget, { ...field, kind: record.kind })) {
        issues.push({ path: [...columnPath, "widget"], message: `widget ${column.widget} does not fit field ${column.field}` });
      }
      ;
      (column.actions ?? []).forEach((actionId, actionIndex) => {
        checkTableAction(actionId, "all", [...columnPath, "actions", actionIndex], record);
      });
      if (column.toggle !== void 0) {
        if (field !== void 0 && field.type !== "bool") {
          issues.push({ path: [...columnPath, "toggle"], message: `column toggle needs a bool field: ${column.field}` });
        }
        checkTableAction(column.toggle.on, "all", [...columnPath, "toggle", "on"], record, "column toggle");
        checkTableAction(column.toggle.off, "all", [...columnPath, "toggle", "off"], record, "column toggle");
      }
    });
  }
  ;
  (node.rowActions ?? []).forEach((actionId, actionIndex) => {
    checkTableAction(actionId, "row", [...here, "rowActions", actionIndex], record);
  });
  (node.tableActions ?? []).forEach((actionId, actionIndex) => {
    checkTableAction(actionId, "all", [...here, "tableActions", actionIndex], record, "table action");
  });
  if (node.editRows === true && record !== void 0 && record.kind !== "state") {
    issues.push({ path: [...here, "editRows"], message: `editRows needs a state record: ${record.id}` });
  }
  function checkTableAction(actionId, scope, actionPath, target, owner = scope === "row" ? "row action" : "column action") {
    const action = actionsById.get(actionId);
    if (action === void 0) {
      issues.push({ path: actionPath, message: `unknown action: ${actionId}` });
      return;
    }
    if (action.scope !== scope) {
      issues.push({ path: actionPath, message: `${owner} must have scope ${scope}: ${actionId}` });
      return;
    }
    if (target === void 0) return;
    const addresses = keysAddressesOf(action);
    if (addresses.size > 1 || addresses.size === 1 && !addresses.has(target.keysFrom.address)) {
      issues.push({ path: actionPath, message: `${owner} records must share the keysFrom address of record ${target.id}` });
    }
  }
}
function collectSurfaceDefinitionIssues(definition) {
  const issues = [];
  const ids = /* @__PURE__ */ new Map();
  const valueAddresses = /* @__PURE__ */ new Set();
  definition.parameters.forEach((parameter, index) => {
    if (ids.has(parameter.id)) {
      issues.push({ path: ["parameters", index, "id"], message: "duplicate parameter id" });
    }
    ids.set(parameter.id, parameter);
    if (valueAddresses.has(parameter.address)) {
      issues.push({ path: ["parameters", index, "address"], message: "duplicate parameter address" });
    }
    valueAddresses.add(parameter.address);
    collectValueSpecIssues(parameter, parameter.kind, "parameter", ["parameters", index], issues);
    if (parameter.widget !== void 0 && !widgetFits(parameter.widget, parameter)) {
      issues.push({ path: ["parameters", index, "widget"], message: `widget ${parameter.widget} does not fit parameter ${parameter.id}` });
    }
  });
  collectRecordIssues(definition, new Set(ids.keys()), valueAddresses, issues);
  collectListSourceIssues(definition, valueAddresses, issues);
  const fieldIndexOf = createFieldIndex();
  collectActionIssues(definition, fieldIndexOf, issues);
  const actionsById = indexById(definition.actions ?? []);
  const recordsById = indexById(definition.records ?? []);
  const keysAddressCache = /* @__PURE__ */ new Map();
  const keysAddressesOf = (action) => {
    let addresses = keysAddressCache.get(action);
    if (addresses === void 0) {
      addresses = /* @__PURE__ */ new Set();
      for (const step of action.steps) {
        const target = "record" in step ? recordsById.get(step.record) : void 0;
        if (target !== void 0) addresses.add(target.keysFrom.address);
      }
      keysAddressCache.set(action, addresses);
    }
    return addresses;
  };
  const screenIds = /* @__PURE__ */ new Set();
  definition.screens.forEach((screen, screenIndex) => {
    if (screenIds.has(screen.id)) {
      issues.push({ path: ["screens", screenIndex, "id"], message: "duplicate screen id" });
    }
    screenIds.add(screen.id);
    const visit = (nodes, nodePath) => {
      nodes.forEach((node, nodeIndex) => {
        const here = [...nodePath, nodeIndex];
        if (node.kind === "control") {
          const parameter = ids.get(node.param);
          if (parameter === void 0) {
            issues.push({ path: [...here, "param"], message: `unknown parameter: ${node.param}` });
          } else if (node.widget !== void 0 && !widgetFits(node.widget, parameter)) {
            issues.push({ path: [...here, "widget"], message: `widget ${node.widget} does not fit parameter ${node.param}` });
          }
        } else if (node.kind === "action") {
          const action = actionsById.get(node.action);
          if (action === void 0) {
            issues.push({ path: [...here, "action"], message: `unknown action: ${node.action}` });
          } else if (action.scope === "row") {
            issues.push({ path: [...here, "action"], message: `row-scoped action must be placed in rowActions: ${node.action}` });
          }
        } else if (node.kind === "record") {
          collectRecordNodeIssues(node, here, recordsById, actionsById, keysAddressesOf, fieldIndexOf, issues);
        } else if (node.kind === "tabs") {
          node.tabs.forEach((tab, tabIndex) => visit(tab.children, [...here, "tabs", tabIndex, "children"]));
        } else {
          visit(node.children, [...here, "children"]);
        }
      });
    };
    visit(screen.children, ["screens", screenIndex, "children"]);
  });
  return issues;
}
var SurfaceDefinitionSchema = SurfaceDefinitionStructureSchema.superRefine((definition, context) => {
  for (const issue of collectSurfaceDefinitionIssues(definition)) {
    context.addIssue({ code: external_exports.ZodIssueCode.custom, path: issue.path, message: issue.message });
  }
});

// ../shared/src/osc-pad.ts
var OSC_PAD_FORMAT = "oscdesk-pad";
var OSC_PAD_VERSION = 1;
var OSC_PAD = {
  MAX_ROWS: 12,
  MAX_COLUMNS: 12,
  // 送信ログ(D-067)が切り詰めずに見せられる個数に揃える(押した内容がログで全部見えるように)
  MAX_ARGS: SENT_LOG.MAX_ARGS,
  MAX_LABEL_CHARS: 64,
  MAX_STRING_ARG_CHARS: 1024,
  // 画像はパッドの JSON に data URL で埋め込む(D-080)。1 枚と合計の上限で、pad フレーム(全 UI へ配る)の大きさを抑える
  MAX_IMAGE_BYTES: 256 * 1024,
  MAX_TOTAL_IMAGE_BYTES: 4 * 1024 * 1024,
  // アドレスの長さ(JS の length)。上限が無いと、巨大なアドレス 1 つで pad フレームが UI の受信上限を超える
  MAX_ADDRESS_CHARS: 256,
  // 保存・採用するパッドの JSON(UTF-8)の上限。pad フレームは全 UI へ配り、UI の受信上限は 16 MiB(D-071)なので、
  // 画像の合計 4 MiB(base64 で約 5.4 MiB)を収めつつ十分な余裕を残す値にする。超えたパッドは採用しない
  MAX_SERIALIZED_BYTES: 8 * 1024 * 1024
};
var INT32_MIN2 = -2147483648;
var INT32_MAX2 = 2147483647;
var IDENTIFIER_PATTERN2 = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
var COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
var IMAGE_DATA_URL_PATTERN = /^data:image\/(?:png|jpeg|gif|webp);base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/;
function imageDataUrlBytes(dataUrl) {
  const match = IMAGE_DATA_URL_PATTERN.exec(dataUrl);
  if (match === null) return null;
  const body = match[1];
  const padding = body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0;
  return body.length / 4 * 3 - padding;
}
var LONE_SURROGATE_PATTERN = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
function hasLoneSurrogate(text) {
  return LONE_SURROGATE_PATTERN.test(text);
}
var OscPadArgSchema = external_exports.discriminatedUnion("type", [
  external_exports.object({ type: external_exports.literal("i"), value: external_exports.number().int().min(INT32_MIN2).max(INT32_MAX2) }).strict(),
  // OSC の f は float32。有限でも float32 に収まらない値(1e300 など)は Unity で +Inf になるので、float32 へ丸めて有限なものだけ受ける
  external_exports.object({ type: external_exports.literal("f"), value: external_exports.number().finite().refine((value) => Number.isFinite(Math.fround(value)), { message: "f must fit in float32" }) }).strict(),
  // OSC の文字列は NUL で終わるので、途中の NUL は受け側で切れて保存した内容と違うものが届く(エンコーダが例外を投げる実装もある)
  external_exports.object({ type: external_exports.literal("s"), value: external_exports.string().max(OSC_PAD.MAX_STRING_ARG_CHARS).refine((value) => !value.includes("\0"), { message: "s must not contain NUL" }).refine((value) => !hasLoneSurrogate(value), { message: "s must not contain lone surrogates" }) }).strict()
]);
var OscPadButtonSchema = external_exports.object({
  id: external_exports.string().regex(IDENTIFIER_PATTERN2),
  // 0 始まりのマス。格子の外・重なりは意味検証で拒否する
  row: external_exports.number().int().min(0).max(OSC_PAD.MAX_ROWS - 1),
  column: external_exports.number().int().min(0).max(OSC_PAD.MAX_COLUMNS - 1),
  // 画像や色だけのボタンもあり得るので空を許す
  label: external_exports.string().max(OSC_PAD.MAX_LABEL_CHARS),
  color: external_exports.string().regex(COLOR_PATTERN).optional(),
  image: external_exports.string().regex(IMAGE_DATA_URL_PATTERN).optional(),
  // サーフェス定義と同じ具体アドレスの規則(/sys/*・/oscdesk/* と、パターン文字・空白・空パートを拒否)
  // NUL は具体アドレスの正規表現(空白・パターン文字の除外)では弾けないので別に拒否する(OSC の文字列の終端と衝突する)
  address: external_exports.string().max(OSC_PAD.MAX_ADDRESS_CHARS).regex(new RegExp(PARAMETER_ADDRESS_PATTERN)).refine((value) => !value.includes("\0"), { message: "address must not contain NUL" }).refine((value) => !hasLoneSurrogate(value), { message: "address must not contain lone surrogates" }),
  args: external_exports.array(OscPadArgSchema).max(OSC_PAD.MAX_ARGS)
}).strict();
var OscPadStructureSchema = external_exports.object({
  format: external_exports.literal(OSC_PAD_FORMAT),
  version: external_exports.literal(OSC_PAD_VERSION),
  rows: external_exports.number().int().min(1).max(OSC_PAD.MAX_ROWS),
  columns: external_exports.number().int().min(1).max(OSC_PAD.MAX_COLUMNS),
  buttons: external_exports.array(OscPadButtonSchema).max(OSC_PAD.MAX_ROWS * OSC_PAD.MAX_COLUMNS)
}).strict();
function collectOscPadIssues(pad) {
  const issues = [];
  const ids = /* @__PURE__ */ new Set();
  const cells = /* @__PURE__ */ new Set();
  let totalImageBytes = 0;
  pad.buttons.forEach((button, index) => {
    if (ids.has(button.id)) issues.push({ path: ["buttons", index, "id"], message: `duplicate button id "${button.id}"` });
    ids.add(button.id);
    if (button.row >= pad.rows || button.column >= pad.columns) {
      issues.push({ path: ["buttons", index], message: `button "${button.id}" is outside the ${String(pad.rows)}x${String(pad.columns)} grid` });
    }
    const cell = `${String(button.row)},${String(button.column)}`;
    if (cells.has(cell)) issues.push({ path: ["buttons", index], message: `button "${button.id}" overlaps another button` });
    cells.add(cell);
    if (button.image !== void 0) {
      const bytes = imageDataUrlBytes(button.image) ?? 0;
      totalImageBytes += bytes;
      if (bytes > OSC_PAD.MAX_IMAGE_BYTES) {
        issues.push({ path: ["buttons", index, "image"], message: `image of "${button.id}" exceeds ${String(OSC_PAD.MAX_IMAGE_BYTES)} bytes` });
      }
    }
  });
  if (totalImageBytes > OSC_PAD.MAX_TOTAL_IMAGE_BYTES) {
    issues.push({ path: ["buttons"], message: `images exceed ${String(OSC_PAD.MAX_TOTAL_IMAGE_BYTES)} bytes in total` });
  }
  return issues;
}
var OscPadSchema = OscPadStructureSchema.superRefine((pad, context) => {
  for (const issue of collectOscPadIssues(pad)) context.addIssue({ code: external_exports.ZodIssueCode.custom, ...issue });
});
function oscPadSerializedBytes(pad) {
  return new TextEncoder().encode(JSON.stringify(pad)).length;
}
var OscPadStoredSchema = OscPadSchema.superRefine((pad, context) => {
  const bytes = oscPadSerializedBytes(pad);
  if (bytes > OSC_PAD.MAX_SERIALIZED_BYTES) {
    context.addIssue({ code: external_exports.ZodIssueCode.custom, path: [], message: `pad is ${String(bytes)} bytes as JSON (limit ${String(OSC_PAD.MAX_SERIALIZED_BYTES)})` });
  }
});

// ../shared/src/surface-name.ts
var SURFACE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
var WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
function isValidSurfaceName(name) {
  return SURFACE_NAME_PATTERN.test(name) && !WINDOWS_RESERVED_NAME.test(name);
}
var SurfaceNameSchema = external_exports.string().refine(isValidSurfaceName, { message: "invalid surface name" });

// ../shared/src/surface-record.ts
function recordHasRowIds(record) {
  return record.keysFrom.source === "ui";
}
function recordHeadLength(record) {
  return recordHasRowIds(record) ? 2 : 1;
}
function recordInitialValues(record) {
  return record.fields.map((field) => {
    const value = record.kind === "state" ? field.default : field.value;
    if (value === void 0) throw new Error(`record ${record.id} field ${field.id} has no ${record.kind === "state" ? "default" : "value"}`);
    return value;
  });
}
function fieldArg(field, value) {
  switch (field.type) {
    case "i":
      return { type: "i", value: Number(value) };
    case "f":
      return { type: "f", value: Number(value) };
    case "s":
      return { type: "s", value: String(value) };
    case "bool":
      return { type: "i", value: value === true || value === 1 ? 1 : 0 };
  }
}
function recordFieldArgs(record, values) {
  if (values.length !== record.fields.length) {
    throw new Error(`record ${record.id} expects ${record.fields.length} field values, got ${values.length}`);
  }
  return record.fields.map((field, index) => fieldArg(field, values[index]));
}
function fieldAccepts(field, arg) {
  if (field.type === "s") {
    return arg.type === "s" && (field.options === void 0 || field.optionsFrom !== void 0 || field.options.includes(arg.value));
  }
  if (arg.type !== "i" && arg.type !== "f") return false;
  if (!Number.isFinite(arg.value)) return false;
  if (field.type === "bool") return arg.value === 0 || arg.value === 1;
  return field.range === void 0 || arg.value >= field.range[0] && arg.value <= field.range[1];
}
function recordKeyOf(record, args) {
  const offset = recordHeadLength(record);
  if (args.length !== record.fields.length + offset) return void 0;
  const head = args[0];
  if (head.type !== "s" || args[offset - 1].type !== "s") return void 0;
  return record.fields.every((field, index) => fieldAccepts(field, args[index + offset])) ? head.value : void 0;
}

// ../shared/src/project-file.ts
var PROJECT_FILE_FORMAT = "oscdesk-project";
var PROJECT_FILE_VERSION = 1;
var PROJECT_FILE = {
  // プロジェクトの JSON(区切りの空白なし、UTF-8)の上限。書き出しは project フレームで UI へ届き、UI の受信上限は
  // 16 MiB(D-071)なので、パッドの上限 8 MiB(D-080)と定義・保持値を収めつつ余裕を残す値にする
  MAX_SERIALIZED_BYTES: 12 * 1024 * 1024,
  // 書き出しの要求と応答を結ぶ印。UI のプロセスはブラウザのページを複数抱えるので、どのページの要求かを返す
  MAX_REQUEST_ID_CHARS: 64,
  // UI で管理する一覧 1 つの行数の上限(定義の keysFrom.max の上限 1000 と同じ)。取り込む一覧の行は、一覧を共有する
  // state レコードの数だけ保持値の行に展開されるので、行数と展開後の大きさを採用の前に抑える(PR #80 のレビュー指摘)
  MAX_KEY_LIST_ROWS: 1e3,
  // 保持値のレコードの行の上限(UI で管理する一覧の行の展開を含む)
  MAX_HELD_ROWS: 2e4,
  // 取り込み後の desired(full)の大きさの見積もりの上限。desired は全 UI へ配り、UI の受信上限は 16 MiB(D-071)なので、
  // 見積もりの誤差を見込んで半分に抑える。超えると再接続のたびに受け切れないフレームを配り続ける
  MAX_DESIRED_BYTES: 8 * 1024 * 1024
};
var INT32_MIN3 = -2147483648;
var INT32_MAX3 = 2147483647;
var HeldArgSchema = external_exports.discriminatedUnion("type", [
  external_exports.object({ type: external_exports.literal("i"), value: external_exports.number().int().min(INT32_MIN3).max(INT32_MAX3) }).strict(),
  external_exports.object({ type: external_exports.literal("f"), value: external_exports.number().finite() }).strict(),
  external_exports.object({ type: external_exports.literal("s"), value: external_exports.string() }).strict()
]);
var HeldValueSchema = external_exports.object({
  id: external_exports.string().min(1),
  address: external_exports.string().min(1),
  type: external_exports.enum(["i", "f", "s", "bool"]),
  args: external_exports.array(HeldArgSchema)
}).strict();
var HeldRecordRowSchema = external_exports.object({
  id: external_exports.string().min(1),
  address: external_exports.string().min(1),
  key: external_exports.string(),
  fields: external_exports.array(external_exports.object({
    id: external_exports.string().min(1),
    type: external_exports.enum(["i", "f", "s", "bool"]),
    arg: HeldArgSchema
  }).strict())
}).strict();
var HeldKeyListSchema = external_exports.object({
  address: external_exports.string().min(1),
  rows: external_exports.array(external_exports.object({ id: external_exports.string().min(1), name: external_exports.string() }).strict())
}).strict();
var SPAWN_RECORD = {
  // 生成担当 1 つが同時に残せる数の既定は 64(受け口の Max Instances)。PC と生成担当の数を見込んだ全体の上限
  MAX_ENTRIES: 4096,
  MAX_NAME_CHARS: 128,
  MAX_HOST_CHARS: 253
};
var SPAWN_NAME_PATTERN = /^[^\s/*?[\]{},#\u0000-\u001f\u007f]+$/u;
var isValidSpawnName = (name) => name.length > 0 && name.length <= SPAWN_RECORD.MAX_NAME_CHARS && SPAWN_NAME_PATTERN.test(name);
var isSpawnAddress = (address) => {
  const segments = address.split("/");
  return segments.length === 4 && segments[0] === "" && segments[3] === "spawn" && segments.slice(1, 3).every((segment) => isValidSpawnName(segment)) && segments[1] !== "sys" && segments[1] !== "oscdesk";
};
var HeldSpawnSchema = external_exports.object({
  param: external_exports.string().min(1),
  address: external_exports.string().refine(isSpawnAddress, { message: "not a spawner address (/<package>/<target>/spawn)" }),
  name: external_exports.string().refine(isValidSpawnName, { message: "invalid spawn name" }),
  host: external_exports.string().min(1).max(SPAWN_RECORD.MAX_HOST_CHARS),
  removedElsewhere: external_exports.literal(true).optional()
}).strict();
var HeldValuesSchema = external_exports.object({
  values: external_exports.array(HeldValueSchema),
  records: external_exports.array(HeldRecordRowSchema),
  keyLists: external_exports.array(HeldKeyListSchema).optional(),
  spawns: external_exports.array(HeldSpawnSchema).optional()
}).strict();
var ProjectHeldValuesSchema = external_exports.object({
  values: external_exports.array(HeldValueSchema),
  records: external_exports.array(HeldRecordRowSchema).max(PROJECT_FILE.MAX_HELD_ROWS),
  keyLists: external_exports.array(HeldKeyListSchema.extend({
    rows: external_exports.array(external_exports.object({ id: external_exports.string().min(1), name: external_exports.string() }).strict()).max(PROJECT_FILE.MAX_KEY_LIST_ROWS)
  }).strict()).optional(),
  // 生成の記録(HID-385)。読み込むと今の記録と置き換わり、「Unity へ送る」まで自動では復元しない
  spawns: external_exports.array(HeldSpawnSchema).max(SPAWN_RECORD.MAX_ENTRIES).optional()
}).strict();
var ProjectFileSchema = external_exports.object({
  format: external_exports.literal(PROJECT_FILE_FORMAT),
  version: external_exports.literal(PROJECT_FILE_VERSION),
  exportedAt: external_exports.string().datetime({ offset: true }),
  // 保持値は定義ごとに意味が決まる(照合は定義の id・型・値域で行う。D-058)ので、定義の中に置く
  surface: external_exports.object({
    name: SurfaceNameSchema,
    definition: SurfaceDefinitionSchema,
    values: ProjectHeldValuesSchema
  }).strict().superRefine((surface, context) => {
    const expanded = estimateImportedDesired(surface.definition, surface.values);
    if (expanded.rows > PROJECT_FILE.MAX_HELD_ROWS) {
      context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["values"], message: `held values expand to ${String(expanded.rows)} record rows (limit ${String(PROJECT_FILE.MAX_HELD_ROWS)})` });
    }
    if (expanded.bytes > PROJECT_FILE.MAX_DESIRED_BYTES) {
      context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["values"], message: `held values expand to about ${String(expanded.bytes)} bytes (limit ${String(PROJECT_FILE.MAX_DESIRED_BYTES)})` });
    }
    if (expanded.optionsBytes > PROJECT_FILE.MAX_DESIRED_BYTES) {
      context.addIssue({ code: external_exports.ZodIssueCode.custom, path: ["values", "keyLists"], message: `UI-managed lists expand to about ${String(expanded.optionsBytes)} bytes of runtime options (limit ${String(PROJECT_FILE.MAX_DESIRED_BYTES)})` });
    }
  }).nullable(),
  pad: external_exports.object({
    name: SurfaceNameSchema,
    pad: OscPadSchema
  }).strict().nullable()
}).strict().refine((project) => project.surface !== null || project.pad !== null, {
  message: "project must contain a surface or a pad"
});
var utf8Bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
var ENTRY_OVERHEAD_BYTES = 32;
var ARG_OVERHEAD_BYTES = 24;
function estimateImportedDesired(definition, values) {
  let rows = 0;
  let bytes = 0;
  let optionsBytes = 0;
  for (const record of definition.records ?? []) {
    if (!recordHasRowIds(record)) continue;
    const list = values.keyLists?.find((candidate) => candidate.address === record.keysFrom.address);
    if (list === void 0) continue;
    const listed = list.rows.slice(0, Math.min(list.rows.length, record.keysFrom.max ?? Number.POSITIVE_INFINITY));
    optionsBytes += utf8Bytes(record.id) + ENTRY_OVERHEAD_BYTES + utf8Bytes(listed.map((row) => row.id)) + utf8Bytes(listed.map((row) => row.name));
  }
  for (const param of definition.parameters) {
    if (param.kind !== "state" || param.standalone === false) continue;
    const held = values.values.find((value) => value.address === param.address);
    const fromFile = held === void 0 ? 0 : utf8Bytes(held.args);
    const fromDefault = param.default === void 0 ? 0 : utf8Bytes(param.default) + ARG_OVERHEAD_BYTES;
    bytes += utf8Bytes(param.address) + ENTRY_OVERHEAD_BYTES + Math.max(fromFile, fromDefault);
  }
  for (const record of definition.records ?? []) {
    if (record.kind !== "state") continue;
    const defaults = recordFieldArgs(record, recordInitialValues(record)).map((arg) => utf8Bytes(arg));
    const fileRows = /* @__PURE__ */ new Map();
    for (const row of values.records) {
      if (row.id === record.id && row.address === record.address && row.key !== "") fileRows.set(row.key, row);
    }
    let keys;
    if (recordHasRowIds(record)) {
      const list = values.keyLists?.find((candidate) => candidate.address === record.keysFrom.address);
      const listed = list?.rows ?? [];
      keys = listed.slice(0, Math.min(listed.length, record.keysFrom.max ?? Number.POSITIVE_INFINITY)).map((row) => ({ key: row.id, name: row.name }));
    } else {
      keys = [...fileRows.keys()].map((key) => ({ key }));
    }
    const address = utf8Bytes(record.address) + ENTRY_OVERHEAD_BYTES;
    for (const { key, name } of keys) {
      const fileRow = fileRows.get(key);
      let rowBytes = address + utf8Bytes(key) + ARG_OVERHEAD_BYTES + (name === void 0 ? 0 : utf8Bytes(name) + ARG_OVERHEAD_BYTES);
      record.fields.forEach((field, index) => {
        const held = fileRow?.fields.find((candidate) => candidate.id === field.id);
        rowBytes += Math.max(defaults[index], held === void 0 ? 0 : utf8Bytes(held.arg));
      });
      rows += 1;
      bytes += rowBytes;
    }
  }
  return { rows, bytes, optionsBytes };
}
function projectSerializedBytes(project) {
  return new TextEncoder().encode(JSON.stringify(project)).length;
}

// ../shared/src/wire.ts
var WIRE_PROTOCOL_VERSION = 1;
var TARGET_ADAPTER_KINDS = ["osc"];
var ParamValueSchema = external_exports.union([external_exports.number().finite(), external_exports.string(), external_exports.boolean()]);
var LOCK = {
  LEASE_MS: 2e3,
  MAX_HOLDER_CHARS: 64,
  MAX_LABEL_CHARS: 64
};
var LockRefPartSchema = external_exports.string().min(1).max(256);
var LockRefSchema = external_exports.union([
  external_exports.object({ param: LockRefPartSchema }).strict(),
  external_exports.object({ record: LockRefPartSchema, key: LockRefPartSchema }).strict()
]);
var LockHolderSchema = external_exports.string().min(1).max(LOCK.MAX_HOLDER_CHARS);
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
  type: external_exports.literal("osc.message"),
  address: external_exports.string().startsWith("/"),
  args: external_exports.array(WireArgSchema)
};
var LinkUnityStatusSchema = strictObject({
  reachability: external_exports.enum(["unknown", "reachable", "lost"]),
  lastRttMs: external_exports.number().nonnegative().nullable(),
  consecutiveLosses: external_exports.number().int().nonnegative(),
  lastPongSeq: external_exports.number().int().nonnegative().nullable()
});
var LinkTargetStatusSchema = strictObject({
  name: external_exports.string(),
  primary: external_exports.boolean(),
  ...LinkUnityStatusSchema.shape
});
var HelloFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("hello"),
  clientId: external_exports.string(),
  protocolVersion: external_exports.number().int(),
  server: strictObject({ name: external_exports.string(), version: external_exports.string() }),
  unity: strictObject({ host: external_exports.string(), sendPort: external_exports.number().int().min(1).max(65535) }),
  // 冗長構成の宛先一覧(主系が先頭。D-046)。unity は主系と同じ値で、旧い UI のために残す
  targets: external_exports.array(strictObject({
    name: external_exports.string(),
    host: external_exports.string(),
    sendPort: external_exports.number().int().min(1).max(65535),
    primary: external_exports.boolean()
  })).min(1),
  bridge: strictObject({
    oscListenPort: external_exports.number().int().min(1).max(65535),
    wsPort: external_exports.number().int().min(1).max(65535)
  }),
  heartbeat: strictObject({ intervalMs: external_exports.number().positive(), timeoutMs: external_exports.number().positive() }),
  pingIntervalMs: external_exports.number().positive(),
  debug: external_exports.boolean(),
  // ブリッジが持つ通信アダプタ(HID-373)。UI は osc があるときだけ OSC 専用の機能(osc.* のフレーム:
  // OSC パッド・送信ログ)を出す。今は OSC のアダプタしか無く、複数のアダプタの同時稼働は作らない
  adapters: external_exports.array(external_exports.enum(TARGET_ADAPTER_KINDS)).min(1)
});
var SurfaceFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("surface"),
  name: SurfaceNameSchema,
  // 採用のたびに 1 ずつ増える(ブリッジの再起動で 1 に戻る)。同じ定義の再採用も増える。
  revision: external_exports.number().int().positive(),
  at: external_exports.string().datetime({ offset: true }),
  definition: SurfaceDefinitionSchema
});
var SurfaceListFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("surfaceList"),
  names: external_exports.array(SurfaceNameSchema),
  active: SurfaceNameSchema.nullable()
});
var DesiredFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("desired"),
  full: external_exports.boolean(),
  values: external_exports.array(strictObject({ address: external_exports.string().startsWith("/"), args: external_exports.array(WireArgSchema) }))
});
var RuntimeOptionsFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("runtimeOptions"),
  lists: external_exports.array(strictObject({
    address: external_exports.string().startsWith("/"),
    targets: external_exports.array(strictObject({ name: external_exports.string(), options: external_exports.array(external_exports.string()) }))
  })),
  choices: external_exports.array(strictObject({ param: external_exports.string(), options: external_exports.array(external_exports.string()) })),
  // レコード(D-061)。keys は keysFrom を持つレコードごとのキーの一覧(主系の順 → 副系にしか無い名前を config の宛先順、
  // 重複と空文字を除く)。fieldChoices は optionsFrom を持つレコードのフィールドごとの選択肢(choices と同じ順序規則)。
  // ブリッジは常に送るが、旧いブリッジとの互換のため省略可にし、UI は無ければ空として扱う。
  // keysFrom.source 'ui' のレコード(D-087)では keys が行の ID で、names に同じ並びで Name を載せる
  // (行を指す状態はすべて ID で持ち、Name は表示と Unity へ送るためのラベルに留める)
  keys: external_exports.array(strictObject({ record: external_exports.string(), keys: external_exports.array(external_exports.string()), names: external_exports.array(external_exports.string()).optional() }).refine((entry) => entry.names === void 0 || entry.names.length === entry.keys.length, {
    message: "names must have the same length as keys"
  })).optional(),
  fieldChoices: external_exports.array(strictObject({ record: external_exports.string(), field: external_exports.string(), options: external_exports.array(external_exports.string()) })).optional(),
  // 届いたが反映していない一覧(D-088)。lists 以下はすべて反映済みの一覧から作り、届いた一覧と食い違う出所
  // (宛先。ブロードキャストの宛先では host に答えたホスト)だけをここに載せる。added / removed は反映済みの一覧から見た
  // 名前の増減で、両方が空なら並びだけが違う。旧いブリッジとの互換のため省略可にし、UI は無ければ空として扱う
  pending: external_exports.array(strictObject({
    address: external_exports.string().startsWith("/"),
    target: external_exports.string(),
    host: external_exports.string().optional(),
    added: external_exports.array(external_exports.string()),
    removed: external_exports.array(external_exports.string())
  })).optional()
});
var SENT_LOG_ORIGINS = ["ui", "action", "resend", "row", "request", "relay", "pad"];
var SentLogRecordSchema = strictObject({
  // ブリッジの起動ごとに 1 から振る。間引き(count)で更新した記録は同じ seq のまま届き直す
  seq: external_exports.number().int().positive(),
  at: external_exports.string().datetime({ offset: true }),
  origin: external_exports.enum(SENT_LOG_ORIGINS),
  targets: external_exports.array(external_exports.string()).min(1),
  address: external_exports.string().startsWith("/"),
  args: external_exports.array(WireArgSchema).max(SENT_LOG.MAX_ARGS),
  // 同じアドレスへの連続送信をまとめた件数(1 なら単発)。at と args は最後の送信のもの
  count: external_exports.number().int().positive(),
  // まとめ送りの 1 件なら、そのバッチの番号と中での位置
  batch: strictObject({
    id: external_exports.number().int().positive(),
    index: external_exports.number().int().nonnegative(),
    size: external_exports.number().int().positive()
  }).nullable(),
  // 引数を表示用に切り詰めたか(長い文字列・blob・多すぎる引数)
  clipped: external_exports.boolean()
});
var SentLogFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("osc.sentLog"),
  // true なら UI は手元の記録を捨ててこれで置き換える(接続直後の既存分の先頭)。false は seq で追加・更新
  full: external_exports.boolean(),
  records: external_exports.array(SentLogRecordSchema).max(SENT_LOG.MAX_RECORDS_PER_FRAME)
});
var DestinationsFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("destinations"),
  sendPort: external_exports.number().int().min(1).max(65535),
  scanning: external_exports.boolean(),
  scannedAt: external_exports.string().datetime({ offset: true }).nullable(),
  devices: external_exports.array(strictObject({
    host: external_exports.string().min(1),
    hostname: external_exports.string().min(1).max(253).nullable(),
    alias: external_exports.string().min(1).max(DESTINATIONS.MAX_ALIAS_CHARS).nullable(),
    mac: external_exports.string().nullable(),
    interface: external_exports.string().nullable(),
    self: external_exports.boolean(),
    configured: external_exports.boolean(),
    found: external_exports.boolean()
  })),
  broadcasts: external_exports.array(strictObject({ address: external_exports.string().min(1), interface: external_exports.string(), network: external_exports.string() })),
  selection: strictObject({
    source: external_exports.enum(["config", "saved", "unsaved"]),
    allDevices: external_exports.boolean(),
    networks: external_exports.array(external_exports.string().min(1)),
    hosts: external_exports.array(external_exports.string().min(1))
  }),
  targets: external_exports.array(strictObject({
    name: external_exports.string(),
    host: external_exports.string(),
    sendPort: external_exports.number().int().min(1).max(65535),
    primary: external_exports.boolean(),
    broadcast: external_exports.boolean()
  })).min(1),
  primaryHosts: external_exports.array(external_exports.string())
});
var PadVersionSchema = external_exports.string().min(1).max(64);
var PadFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("osc.pad"),
  name: SurfaceNameSchema,
  revision: external_exports.number().int().positive(),
  version: PadVersionSchema,
  at: external_exports.string().datetime({ offset: true }),
  pad: OscPadSchema
});
var PadListFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("osc.padList"),
  names: external_exports.array(SurfaceNameSchema),
  active: SurfaceNameSchema.nullable()
});
var ProjectRequestIdSchema = external_exports.string().min(1).max(PROJECT_FILE.MAX_REQUEST_ID_CHARS);
var ProjectFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("project"),
  requestId: ProjectRequestIdSchema,
  project: ProjectFileSchema
});
var DesiredStatusFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("desiredStatus"),
  unsent: external_exports.boolean(),
  since: external_exports.string().datetime({ offset: true }).nullable()
});
var DownstreamOscFrameSchema = strictObject({
  ...OscFrameFields,
  from: PeerSchema
});
var LinkFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("link"),
  unity: LinkUnityStatusSchema,
  targets: external_exports.array(LinkTargetStatusSchema).min(1)
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
var CatalogFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("catalog"),
  pcs: external_exports.array(CatalogPcSchema)
});
var LocksFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("locks"),
  locks: external_exports.array(strictObject({
    ref: LockRefSchema,
    clientId: external_exports.string(),
    holder: LockHolderSchema,
    label: external_exports.string().max(LOCK.MAX_LABEL_CHARS)
  }))
});
var BlueprintStatusFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("blueprintStatus"),
  pc: strictObject({ host: external_exports.string(), name: external_exports.string() }).nullable(),
  absent: external_exports.array(external_exports.string())
});
var DownstreamFrameSchema = external_exports.discriminatedUnion("type", [
  LocksFrameSchema,
  BlueprintStatusFrameSchema,
  HelloFrameSchema,
  DownstreamOscFrameSchema,
  LinkFrameSchema,
  HeartbeatFrameSchema,
  NoticeFrameSchema,
  SurfaceFrameSchema,
  SurfaceListFrameSchema,
  DesiredFrameSchema,
  RuntimeOptionsFrameSchema,
  SentLogFrameSchema,
  DestinationsFrameSchema,
  PadFrameSchema,
  PadListFrameSchema,
  ProjectFrameSchema,
  DesiredStatusFrameSchema,
  CatalogFrameSchema
]);
var UpstreamOscFrameSchema = strictObject({ ...OscFrameFields, holder: LockHolderSchema.optional() });
var OscBatchMessageSchema = strictObject({
  address: external_exports.string().startsWith("/"),
  args: external_exports.array(WireArgSchema)
});
var UpstreamOscBatchFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("osc.batch"),
  messages: external_exports.array(OscBatchMessageSchema).min(1).max(OSC_BATCH.MAX_MESSAGES),
  holder: LockHolderSchema.optional()
});
var HeartbeatAckFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("heartbeatAck"),
  t: external_exports.number()
});
var ResendFrameSchema = strictObject({ v: VersionSchema, type: external_exports.literal("resend"), target: external_exports.string().optional() });
var ReconcileFrameSchema = strictObject({ v: VersionSchema, type: external_exports.literal("reconcile"), target: external_exports.string().min(1) });
var RuntimeOptionsRefreshFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("runtimeOptionsRefresh"),
  request: external_exports.string().startsWith("/").optional()
});
var RuntimeOptionsApplyFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("runtimeOptionsApply"),
  address: external_exports.string().startsWith("/").optional()
});
var RecordKeyAddFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("recordKeyAdd"),
  record: external_exports.string().min(1),
  key: external_exports.string().min(1)
});
var RecordKeyRemoveFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("recordKeyRemove"),
  record: external_exports.string().min(1),
  key: external_exports.string().min(1)
});
var RecordKeyRenameFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("recordKeyRename"),
  record: external_exports.string().min(1),
  key: external_exports.string().min(1),
  name: external_exports.string().min(1)
});
var DestinationsScanFrameSchema = strictObject({ v: VersionSchema, type: external_exports.literal("destinationsScan") });
var DestinationsSelectFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("destinationsSelect"),
  allDevices: external_exports.boolean(),
  networks: external_exports.array(external_exports.string().min(1).max(18)).max(DESTINATIONS.MAX_SCAN_INTERFACES),
  hosts: external_exports.array(external_exports.string().min(1).max(253)).max(DESTINATIONS.MAX_SELECTED_HOSTS)
});
var DestinationsResetFrameSchema = strictObject({ v: VersionSchema, type: external_exports.literal("destinationsReset") });
var DestinationsAliasFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("destinationsAlias"),
  host: external_exports.string().min(1).max(253),
  // 別名の上限(MAX_ALIAS_CHARS)の検査はブリッジが行い、超えたら destination-alias-rejected で理由を返す
  alias: external_exports.string().max(DESTINATIONS.MAX_ALIAS_INPUT_CHARS).nullable()
});
var SurfaceRequestFrameSchema = strictObject({ v: VersionSchema, type: external_exports.literal("surfaceRequest") });
var SurfaceLoadFrameSchema = strictObject({ v: VersionSchema, type: external_exports.literal("surfaceLoad"), name: SurfaceNameSchema });
var SurfaceSaveFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("surfaceSave"),
  name: SurfaceNameSchema,
  definition: external_exports.record(external_exports.string(), external_exports.unknown()),
  activate: external_exports.boolean().optional()
});
var PadRequestFrameSchema = strictObject({ v: VersionSchema, type: external_exports.literal("osc.padRequest") });
var PadLoadFrameSchema = strictObject({ v: VersionSchema, type: external_exports.literal("osc.padLoad"), name: SurfaceNameSchema });
var PadSaveFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("osc.padSave"),
  name: SurfaceNameSchema,
  pad: external_exports.record(external_exports.string(), external_exports.unknown())
});
var PadPressFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("osc.padPress"),
  name: SurfaceNameSchema,
  version: PadVersionSchema,
  button: external_exports.string().min(1)
});
var ProjectExportFrameSchema = strictObject({ v: VersionSchema, type: external_exports.literal("projectExport"), requestId: ProjectRequestIdSchema });
var ProjectImportFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("projectImport"),
  project: external_exports.record(external_exports.string(), external_exports.unknown())
});
var CatalogRequestFrameSchema = strictObject({ v: VersionSchema, type: external_exports.literal("catalogRequest") });
var CatalogAdoptFrameSchema = strictObject({ v: VersionSchema, type: external_exports.literal("catalogAdopt"), host: external_exports.string().min(1).max(253) });
var SetFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("set"),
  param: external_exports.string().min(1),
  value: ParamValueSchema.optional(),
  // 操作した画面が描いた定義の版(surface フレームの revision)。採用中の版と違えばブリッジは断る(stale-surface)。
  // 別のブラウザが定義を切り替えた直後に、旧画面の操作が同じ id の別のアドレスへ読み替わって送られないようにするため。
  // 省くと照合しない(UI 以外の道具のため。NiceGUI の UI は常に付ける)
  revision: external_exports.number().int().positive().optional(),
  // 操作したブラウザのページ(HID-378)。ロック中のパラメータは持ち主の holder からの変更だけを通す
  holder: LockHolderSchema.optional()
});
var LockFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("lock"),
  ref: LockRefSchema,
  holder: LockHolderSchema,
  label: external_exports.string().max(LOCK.MAX_LABEL_CHARS)
});
var UnlockFrameSchema = strictObject({
  v: VersionSchema,
  type: external_exports.literal("unlock"),
  ref: LockRefSchema,
  holder: LockHolderSchema
});
var UpstreamFrameSchema = external_exports.discriminatedUnion("type", [
  UpstreamOscFrameSchema,
  UpstreamOscBatchFrameSchema,
  HeartbeatAckFrameSchema,
  SurfaceRequestFrameSchema,
  SurfaceLoadFrameSchema,
  SurfaceSaveFrameSchema,
  ResendFrameSchema,
  ReconcileFrameSchema,
  RuntimeOptionsRefreshFrameSchema,
  RuntimeOptionsApplyFrameSchema,
  RecordKeyAddFrameSchema,
  RecordKeyRemoveFrameSchema,
  RecordKeyRenameFrameSchema,
  DestinationsScanFrameSchema,
  DestinationsSelectFrameSchema,
  DestinationsResetFrameSchema,
  DestinationsAliasFrameSchema,
  PadRequestFrameSchema,
  PadLoadFrameSchema,
  PadSaveFrameSchema,
  PadPressFrameSchema,
  ProjectExportFrameSchema,
  ProjectImportFrameSchema,
  CatalogRequestFrameSchema,
  CatalogAdoptFrameSchema,
  SetFrameSchema,
  LockFrameSchema,
  UnlockFrameSchema
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
  // 受けたが処理しなかったものの任意の報告(D-105)。Unity → OscDesk。UI へは流さない
  IGNORED: "/sys/ignored",
  FAILED: "/sys/failed"
};
var OSCDESK = {
  STATUS_REQUEST: "/oscdesk/status/request",
  STATUS: "/oscdesk/status",
  // OSC ネイティブ UI がエコーバック宛先として自分を登録する名乗り。
  HELLO: "/oscdesk/hello"
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
var import_promises2 = require("node:dns/promises");
var import_node_fs4 = __toESM(require("node:fs"));
var import_node_net2 = __toESM(require("node:net"));
var import_node_os = __toESM(require("node:os"));
var import_node_path12 = __toESM(require("node:path"));

// src/blueprint-surface.ts
function blueprintSurfaceName(pcName) {
  const hash = (crc32(Buffer.from(pcName, "utf8")) >>> 0).toString(16).padStart(8, "0");
  const cleaned = pcName.normalize("NFKC").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^[-_]+/, "").replace(/[-_]+$/, "").slice(0, 44);
  const name = `blueprint-${cleaned === "" ? "pc" : cleaned}-${hash}`;
  return isValidSurfaceName(name) ? name : `blueprint-pc-${hash}`;
}
var KINDS = /* @__PURE__ */ new Set(["state", "trigger"]);
var TYPES = /* @__PURE__ */ new Set(["i", "f", "s", "bool"]);
function props(item, key) {
  return item.props.filter((prop) => prop.key === key).map((prop) => prop.arg.value);
}
var firstNumber = (values) => values.find((value) => typeof value === "number");
var firstString = (values) => values.find((value) => typeof value === "string");
function parameterId(address, taken) {
  const base = `p_${address.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`.slice(0, 56);
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}_${String(n)}`;
  taken.add(id);
  return id;
}
function toParameter(item, id) {
  if (!KINDS.has(item.kind) || !TYPES.has(item.type)) return null;
  const label = firstString(props(item, "label")) ?? item.address;
  const widget = firstString(props(item, "widget"));
  const base = {
    id,
    address: item.address,
    label,
    kind: item.kind,
    type: item.type,
    ...widget !== void 0 && SURFACE_WIDGET_HINTS.includes(widget) ? { widget } : {}
  };
  if (item.type === "i" || item.type === "f") {
    const min = firstNumber(props(item, "min"));
    const max = firstNumber(props(item, "max"));
    const step = firstNumber(props(item, "step"));
    const value = firstNumber(props(item, item.kind === "trigger" ? "value" : "default"));
    if (min !== void 0 && max !== void 0 && min < max) base.range = [min, max];
    if (step !== void 0 && step > 0) base.step = step;
    if (item.kind === "trigger") base.value = value ?? 1;
    else if (value !== void 0) base.default = value;
  } else if (item.type === "s") {
    const options = props(item, "options").filter((option) => typeof option === "string");
    if (options.length > 0) base.options = options;
    const value = firstString(props(item, item.kind === "trigger" ? "value" : "default"));
    if (item.kind === "trigger") base.value = value ?? "";
    else if (value !== void 0) base.default = value;
  } else {
    const raw = props(item, item.kind === "trigger" ? "value" : "default")[0];
    const value = raw === void 0 ? void 0 : raw === 1 || raw === "true";
    if (item.kind === "trigger") base.value = value ?? true;
    else if (value !== void 0) base.default = value;
  }
  const parsed = SurfaceParameterSchema.safeParse(base);
  return parsed.success ? parsed.data : null;
}
function groupLabel(address) {
  const parts = address.split("/").filter((part) => part !== "");
  return parts.length >= 3 ? `${parts[0]} / ${parts[1]}` : parts[0] ?? address;
}
function buildBlueprintSurface(pcName, items) {
  const taken = /* @__PURE__ */ new Set();
  const groups = /* @__PURE__ */ new Map();
  const parameters = [];
  const sorted = [...items].sort((a, b) => a.address < b.address ? -1 : a.address > b.address ? 1 : 0);
  for (const item of sorted) {
    const parameter = toParameter(item, parameterId(item.address, taken));
    if (parameter === null) continue;
    const alone = SurfaceDefinitionSchema.safeParse({
      format: SURFACE_DEFINITION_FORMAT,
      version: SURFACE_DEFINITION_VERSION,
      name: "check",
      parameters: [parameter],
      screens: []
    });
    if (!alone.success) continue;
    parameters.push(parameter);
    const label = groupLabel(item.address);
    groups.set(label, [...groups.get(label) ?? [], { kind: "control", param: parameter.id }]);
  }
  const definition = {
    format: SURFACE_DEFINITION_FORMAT,
    version: SURFACE_DEFINITION_VERSION,
    name: pcName,
    parameters,
    screens: [{
      id: "blueprint",
      label: pcName,
      children: [...groups].map(([label, children]) => ({ kind: "group", label, children }))
    }]
  };
  const parsed = SurfaceDefinitionSchema.safeParse(definition);
  return parsed.success ? parsed.data : { ...definition, parameters: [], screens: [{ id: "blueprint", label: pcName, children: [] }] };
}
function absentParameters(definition, items) {
  const present = new Set(items.map((item) => item.address));
  return definition.parameters.filter((parameter) => !present.has(parameter.address)).map((parameter) => parameter.id);
}

// src/blueprint-manager.ts
function createBlueprintManager(deps) {
  const logInfo = deps.logInfo ?? console.info;
  let last = "";
  const status = () => {
    const active = deps.active();
    const pc = active === null ? void 0 : deps.pcs().find((candidate) => blueprintSurfaceName(candidate.name) === active.name);
    if (active === null || pc === void 0) return { v: 1, type: "blueprintStatus", pc: null, absent: [] };
    return { v: 1, type: "blueprintStatus", pc: { host: pc.host, name: pc.name }, absent: absentParameters(active.definition, pc.items) };
  };
  return {
    handleUiFrame(frame, clientId) {
      if (frame.type !== "catalogAdopt") return false;
      const pc = deps.pcs().find((candidate) => candidate.host === frame.host);
      if (pc === void 0) {
        deps.publish({ v: 1, type: "notice", level: "error", code: "catalog-adopt-rejected", detail: `unknown-pc: ${frame.host}` }, clientId);
        return true;
      }
      const name = blueprintSurfaceName(pc.name);
      const result = deps.adoptBlueprint(name, buildBlueprintSurface(pc.name, pc.items));
      if (!result.ok) {
        deps.publish({ v: 1, type: "notice", level: "error", code: "catalog-adopt-rejected", detail: result.detail }, clientId);
        return true;
      }
      logInfo("(INFO, BRIDGE)", `Adopted ${result.saved ? "the saved" : "a new"} screen "${name}" for the blueprint of "${pc.name}" (${pc.host}).`);
      deps.publish({ v: 1, type: "notice", level: "info", code: "catalog-adopted", detail: name }, clientId);
      return true;
    },
    refresh() {
      const frame = status();
      const key = JSON.stringify(frame);
      if (key === last) return;
      last = key;
      deps.publish(frame);
    },
    publish(clientId) {
      deps.publish(status(), clientId);
    }
  };
}

// src/catalog-manager.ts
var STAGING_TIMEOUT_MS = 2e3;
var MAX_PUBLISH_WAIT_MS = 500;
var REQUEST_MIN_INTERVAL_MS = 1e3;
var REQUEST_ANSWER_WINDOW_MS = 5e3;
var START_MIN_INTERVAL_MS = 5e3;
var itemBytes = (item) => catalogItemBytes(item);
function createCatalogManager(deps) {
  const now = deps.now ?? Date.now;
  const logWarn = deps.logWarn ?? console.warn;
  const delay2 = deps.publishDelayMs ?? 50;
  const pcs = /* @__PURE__ */ new Map();
  let timer = null;
  let firstScheduledAt = 0;
  let lastRequestAt = Number.NEGATIVE_INFINITY;
  let closed = false;
  const stagingTimers = /* @__PURE__ */ new Map();
  const startedAt = /* @__PURE__ */ new Map();
  const snapshot = () => ({
    v: 1,
    type: "catalog",
    pcs: [...pcs.values()].map((pc) => ({
      host: pc.host,
      name: pc.name,
      receivedAt: new Date(pc.receivedAt).toISOString(),
      verified: pc.verified,
      items: [...pc.items.values()]
    }))
  });
  const publishNow = (clientId) => deps.publish(snapshot(), clientId);
  const schedulePublish = () => {
    if (closed) return;
    if (timer !== null) {
      if (now() - firstScheduledAt >= MAX_PUBLISH_WAIT_MS) return;
      clearTimeout(timer);
    } else {
      firstScheduledAt = now();
    }
    timer = setTimeout(() => {
      timer = null;
      publishNow();
    }, delay2);
  };
  const pcFor = (host) => {
    const held = pcs.get(host);
    if (held !== void 0) return held;
    if (pcs.size >= CATALOG.MAX_PCS) {
      const oldest = [...pcs.values()].sort((a, b) => a.receivedAt - b.receivedAt)[0];
      clearStagingTimer(oldest.host);
      pcs.delete(oldest.host);
      logWarn("(WARN, BRIDGE)", `Dropped the catalog of ${oldest.name} ${oldest.host}: more than ${String(CATALOG.MAX_PCS)} PCs.`);
    }
    const created = { host, name: host, receivedAt: now(), verified: null, items: /* @__PURE__ */ new Map(), bytes: 0, staging: null };
    pcs.set(host, created);
    return created;
  };
  const intArg = (arg) => arg?.type === "i" ? arg.value : null;
  const verify = (pc, count, crc, where) => {
    const mine = catalogDigest([...pc.items.values()]);
    const ok = count === mine.count && crc === mine.crc;
    pc.verified = ok;
    if (!ok) {
      logWarn("(WARN, BRIDGE)", `Catalog digest mismatch (${where}) from ${pc.name} ${pc.host}: received ${String(mine.count)} items crc ${String(mine.crc)}, sender said ${String(count)} items crc ${String(crc)}.`);
      deps.publish({
        v: 1,
        type: "notice",
        level: "warn",
        code: "catalog-mismatch",
        detail: `${pc.name} (${pc.host}): received ${String(mine.count)} items, expected ${String(count)}. Press Sync to fetch again.`
      });
    }
  };
  const totalBytes = () => [...pcs.values()].reduce((sum, pc) => sum + (pc.staging === null ? pc.bytes : pc.staging.bytes), 0);
  const clearStagingTimer = (host) => {
    const timer2 = stagingTimers.get(host);
    if (timer2 !== void 0) clearTimeout(timer2);
    stagingTimers.delete(host);
  };
  const armStagingTimer = (pc) => {
    clearStagingTimer(pc.host);
    stagingTimers.set(pc.host, setTimeout(() => {
      stagingTimers.delete(pc.host);
      if (closed || pc.staging === null) return;
      commitStaging(pc, null, null, "end missing");
      schedulePublish();
    }, STAGING_TIMEOUT_MS));
  };
  const commitStaging = (pc, count, crc, where) => {
    if (pc.staging === null) return;
    const others = [...pcs.values()].reduce((sum, other) => sum + (other === pc ? 0 : other.bytes), 0);
    if (others + pc.staging.bytes > CATALOG.MAX_TOTAL_BYTES) {
      logWarn("(WARN, BRIDGE)", `Discarded the catalog received from ${pc.name} ${pc.host}: the catalogs would exceed ${String(CATALOG.MAX_TOTAL_BYTES)} bytes in total.`);
      pc.staging = null;
      clearStagingTimer(pc.host);
      pc.verified = false;
      deps.publish({ v: 1, type: "notice", level: "warn", code: "catalog-too-large", detail: `${pc.name} (${pc.host}): the catalogs are too large to hold. The previous content is kept.` });
      return;
    }
    pc.name = pc.staging.name;
    pc.items = pc.staging.items;
    pc.bytes = pc.staging.bytes;
    pc.staging = null;
    clearStagingTimer(pc.host);
    verify(pc, count, crc, where);
  };
  return {
    handleOscIn(message) {
      if (!message.address.startsWith("/sys/catalog/")) return false;
      if (closed) return true;
      const host = message.from.host;
      if (message.address === CATALOG_ADDRESSES.REQUEST) return true;
      const held = pcs.get(host);
      const [first, second] = message.args;
      switch (message.address) {
        case CATALOG_ADDRESSES.BEGIN: {
          if (first?.type !== "s" || intArg(second) === null) {
            logWarn("(WARN, BRIDGE)", "Ignored malformed /sys/catalog/begin.");
            return true;
          }
          const pc = pcFor(host);
          pc.receivedAt = now();
          pc.staging = { name: first.value.slice(0, CATALOG.MAX_NAME_CHARS) || host, items: /* @__PURE__ */ new Map(), bytes: 0, lastAt: now() };
          armStagingTimer(pc);
          if (now() - lastRequestAt >= REQUEST_ANSWER_WINDOW_MS && now() - (startedAt.get(host) ?? Number.NEGATIVE_INFINITY) >= START_MIN_INTERVAL_MS) {
            startedAt.delete(host);
            startedAt.set(host, now());
            for (const [known, at] of startedAt) if (now() - at >= START_MIN_INTERVAL_MS) startedAt.delete(known);
            while (startedAt.size > CATALOG.MAX_PCS) startedAt.delete(startedAt.keys().next().value);
            deps.onTargetStarted?.(host);
          }
          break;
        }
        case CATALOG_ADDRESSES.ADD: {
          const parsed = parseCatalogAdd(message.args);
          if (!parsed.ok) {
            logWarn("(WARN, BRIDGE)", `Ignored malformed /sys/catalog/add from ${host}: ${parsed.reason}`);
            return true;
          }
          const pc = pcFor(host);
          pc.receivedAt = now();
          const staging = pc.staging;
          const target = staging?.items ?? pc.items;
          if (staging !== null) {
            staging.lastAt = now();
            armStagingTimer(pc);
          }
          const previous = target.get(parsed.item.address);
          if (previous === void 0 && target.size >= CATALOG.MAX_ITEMS_PER_PC) {
            logWarn("(WARN, BRIDGE)", `Ignored catalog item from ${host}: more than ${String(CATALOG.MAX_ITEMS_PER_PC)} items.`);
            return true;
          }
          const size = itemBytes(parsed.item);
          const delta = size - (previous === void 0 ? 0 : itemBytes(previous));
          if (delta > 0 && totalBytes() + delta > CATALOG.MAX_TOTAL_BYTES) {
            logWarn("(WARN, BRIDGE)", `Ignored catalog item from ${host}: the catalogs would exceed ${String(CATALOG.MAX_TOTAL_BYTES)} bytes in total.`);
            return true;
          }
          target.set(parsed.item.address, parsed.item);
          if (staging !== null) staging.bytes += delta;
          else pc.bytes += delta;
          deps.onItemAdded?.(host, parsed.item.address);
          if (pc.staging === null) pc.verified = null;
          break;
        }
        case CATALOG_ADDRESSES.REMOVE: {
          const pc = held;
          if (first?.type === "s") deps.onItemRemoved?.(host, first.value);
          if (first?.type !== "s" || pc === void 0) return true;
          pc.receivedAt = now();
          if (pc.staging !== null) {
            pc.staging.lastAt = now();
            armStagingTimer(pc);
          }
          const removing = (pc.staging?.items ?? pc.items).get(first.value);
          if (removing !== void 0) {
            if (pc.staging !== null) pc.staging.bytes -= itemBytes(removing);
            else pc.bytes -= itemBytes(removing);
          }
          ;
          (pc.staging?.items ?? pc.items).delete(first.value);
          if (pc.staging === null) pc.verified = null;
          break;
        }
        case CATALOG_ADDRESSES.END: {
          const pc = held;
          if (pc?.staging == null) {
            logWarn("(WARN, BRIDGE)", `Ignored /sys/catalog/end from ${host} without begin.`);
            return true;
          }
          pc.receivedAt = now();
          commitStaging(pc, intArg(first), intArg(second), "end");
          break;
        }
        case CATALOG_ADDRESSES.DIGEST: {
          const pc = held;
          if (pc === void 0 || pc.staging !== null) return true;
          pc.receivedAt = now();
          verify(pc, intArg(first), intArg(second), "digest");
          break;
        }
        default:
          return true;
      }
      schedulePublish();
      return true;
    },
    pcs: () => [...pcs.values()].map((pc) => ({ host: pc.host, name: pc.name, items: [...pc.items.values()] })),
    handleUiFrame(frame) {
      if (frame.type !== "catalogRequest") return false;
      if (now() - lastRequestAt >= REQUEST_MIN_INTERVAL_MS) {
        lastRequestAt = now();
        deps.requestFromTargets();
      }
      return true;
    },
    publish: publishNow,
    close() {
      closed = true;
      for (const host of [...stagingTimers.keys()]) clearStagingTimer(host);
      if (timer !== null) clearTimeout(timer);
      timer = null;
    }
  };
}

// src/desired-values-file.ts
var import_node_path3 = __toESM(require("node:path"));
var DESIRED_VALUES_FILE_FORMAT = "oscdesk-desired-values";
var DESIRED_VALUES_FILE_VERSION = 5;
var DEFAULT_DESIRED_VALUES_WRITE_DELAY_MS = 500;
var FILE_SUFFIX = ".values.json";
var PersistedValueSchema = HeldValueSchema;
var PersistedRecordRowSchema = HeldRecordRowSchema;
var fileHeader = {
  format: external_exports.literal(DESIRED_VALUES_FILE_FORMAT),
  surface: external_exports.string().refine(isValidSurfaceName, { message: "invalid surface name" }),
  savedAt: external_exports.string(),
  values: external_exports.array(PersistedValueSchema)
};
var DesiredValuesFileV1Schema = external_exports.object({ ...fileHeader, version: external_exports.literal(1) }).strict();
var LegacyKeyListSchema = external_exports.object({ address: external_exports.string().min(1), keys: external_exports.array(external_exports.string()) }).strict();
var DesiredValuesFileV2Schema = external_exports.object({
  ...fileHeader,
  version: external_exports.literal(2),
  records: external_exports.array(PersistedRecordRowSchema),
  keyLists: external_exports.array(LegacyKeyListSchema).optional()
}).strict();
var PersistedKeyListSchema = HeldKeyListSchema;
var DesiredValuesFileV3Schema = external_exports.object({
  ...fileHeader,
  version: external_exports.literal(3),
  records: external_exports.array(PersistedRecordRowSchema),
  keyLists: external_exports.array(PersistedKeyListSchema).optional()
}).strict();
var DesiredValuesFileV4Schema = external_exports.object({
  ...fileHeader,
  version: external_exports.literal(4),
  records: external_exports.array(PersistedRecordRowSchema),
  keyLists: external_exports.array(PersistedKeyListSchema).optional(),
  unsentSince: external_exports.string().datetime({ offset: true }).optional()
}).strict();
var DesiredValuesFileSchema = external_exports.object({
  ...fileHeader,
  version: external_exports.literal(DESIRED_VALUES_FILE_VERSION),
  records: external_exports.array(PersistedRecordRowSchema),
  keyLists: external_exports.array(PersistedKeyListSchema).optional(),
  unsentSince: external_exports.string().datetime({ offset: true }).optional(),
  spawns: external_exports.array(HeldSpawnSchema).optional()
}).strict();
var ReadableDesiredValuesFileSchema = external_exports.discriminatedUnion("version", [
  DesiredValuesFileV1Schema,
  DesiredValuesFileV2Schema,
  DesiredValuesFileV3Schema,
  DesiredValuesFileV4Schema,
  DesiredValuesFileSchema
]);
function desiredValuesFilePath(dir, name) {
  return import_node_path3.default.join(import_node_path3.default.resolve(dir), `${name}${FILE_SUFFIX}`);
}
function createDesiredValuesFileStore(options) {
  const fs5 = options.fs;
  const now = options.now ?? Date.now;
  const delayMs = options.delayMs ?? DEFAULT_DESIRED_VALUES_WRITE_DELAY_MS;
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  const pid = options.pid ?? process.pid;
  const logWarn = options.logWarn ?? console.warn;
  const dir = import_node_path3.default.resolve(options.dir);
  let pending = null;
  let timer = null;
  let closed = false;
  const write = (name, values) => {
    const target = desiredValuesFilePath(dir, name);
    const temp = `${target}.${String(pid)}.tmp`;
    try {
      const body = {
        format: DESIRED_VALUES_FILE_FORMAT,
        version: DESIRED_VALUES_FILE_VERSION,
        surface: name,
        savedAt: new Date(now()).toISOString(),
        ...toHeldValues(values),
        ...values.unsentSince === void 0 ? {} : { unsentSince: values.unsentSince }
      };
      fs5.mkdirSync(dir, { recursive: true });
      fs5.writeFileSync(temp, `${JSON.stringify(body, null, 2)}
`, "utf8");
      fs5.renameSync(temp, target);
    } catch (error) {
      try {
        fs5.rmSync(temp, { force: true });
      } catch {
      }
      logWarn("(WARN, BRIDGE)", `Failed to save desired values for surface "${name}" to "${target}": ${describe(error)}`);
    }
  };
  const flush = () => {
    if (timer !== null) {
      clearTimeoutFn(timer);
      timer = null;
    }
    if (pending === null) return;
    const { name, values } = pending;
    pending = null;
    write(name, values);
  };
  const read = (name, warn) => {
    if (!isValidSurfaceName(name)) return null;
    if (pending?.name === name) flush();
    const file = desiredValuesFilePath(dir, name);
    const notRestored = (reason) => {
      warn?.("(WARN, BRIDGE)", `Desired values for surface "${name}" not restored (starting from defaults): ${reason}`);
      return null;
    };
    let text;
    try {
      text = fs5.readFileSync(file, "utf8");
    } catch (error) {
      if (isErrorCode(error, "ENOENT")) return null;
      return notRestored(`failed to read "${file}": ${describe(error)}`);
    }
    let json;
    try {
      json = JSON.parse(text.replace(/^﻿/, ""));
    } catch (error) {
      return notRestored(`"${file}" is not valid JSON: ${describe(error)}`);
    }
    const parsed = ReadableDesiredValuesFileSchema.safeParse(json);
    if (!parsed.success) {
      const issues = parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`);
      return notRestored(`"${file}" is invalid: ${issues.join("; ")}`);
    }
    if (parsed.data.surface !== name) {
      return notRestored(`"${file}" belongs to surface "${parsed.data.surface}".`);
    }
    return {
      values: parsed.data.values.map((value) => ({ ...value, args: value.args.map((arg) => ({ ...arg })) })),
      records: (parsed.data.version === 1 ? [] : parsed.data.records).map((row) => ({
        ...row,
        fields: row.fields.map((field) => ({ ...field, arg: { ...field.arg } }))
      })),
      ...keyListsOf(parsed.data),
      ...(parsed.data.version === 4 || parsed.data.version === DESIRED_VALUES_FILE_VERSION) && parsed.data.unsentSince !== void 0 ? { unsentSince: parsed.data.unsentSince } : {},
      ...parsed.data.version === DESIRED_VALUES_FILE_VERSION && parsed.data.spawns !== void 0 ? { spawns: parsed.data.spawns.map((spawn) => ({ ...spawn })) } : {}
    };
  };
  return {
    load: (name) => read(name, logWarn),
    unsentSince: (name) => read(name, null)?.unsentSince,
    save(name, values) {
      if (closed || !isValidSurfaceName(name)) return;
      if (pending !== null && pending.name !== name) flush();
      pending = { name, values };
      if (timer === null) {
        timer = setTimeoutFn(() => {
          timer = null;
          flush();
        }, delayMs);
      }
    },
    flush,
    close() {
      flush();
      closed = true;
    }
  };
}
function keyListsOf(data) {
  if (data.version === 1 || data.keyLists === void 0) return {};
  if (data.version === 2) {
    return { keyLists: data.keyLists.map((list) => ({ address: list.address, rows: list.keys.map((name) => ({ name })) })) };
  }
  return { keyLists: data.keyLists.map((list) => ({ address: list.address, rows: list.rows.map((row) => ({ ...row })) })) };
}
function toHeldValues(values) {
  return {
    values: values.values.map((value) => ({ id: value.id, address: value.address, type: value.type, args: value.args.map(toPersistedArg) })),
    records: values.records.map((row) => ({
      id: row.id,
      address: row.address,
      key: row.key,
      fields: row.fields.map((field) => ({ id: field.id, type: field.type, arg: toPersistedArg(field.arg) }))
    })),
    ...values.keyLists !== void 0 && values.keyLists.length > 0 ? {
      keyLists: values.keyLists.map((list) => ({
        address: list.address,
        rows: list.rows.flatMap((row) => row.id === void 0 ? [] : [{ id: row.id, name: row.name }])
      }))
    } : {},
    // 記録が無ければ書かない(生成担当を使わない定義のファイル・プロジェクトを従来と同じ形に保つ)
    ...values.spawns !== void 0 && values.spawns.length > 0 ? { spawns: values.spawns.map((spawn) => ({ ...spawn })) } : {}
  };
}
function fromHeldValues(values) {
  return {
    values: values.values.map((value) => ({ ...value, args: value.args.map((arg) => ({ ...arg })) })),
    records: values.records.map((row) => ({ ...row, fields: row.fields.map((field) => ({ ...field, arg: { ...field.arg } })) })),
    keyLists: (values.keyLists ?? []).map((list) => ({ address: list.address, rows: list.rows.map((row) => ({ ...row })) })),
    // 取り込みは今の記録を捨てて置き換える(HID-385)。無ければ空の記録
    spawns: (values.spawns ?? []).map((spawn) => ({ ...spawn }))
  };
}
function toPersistedArg(arg) {
  if (arg.type === "b") throw new Error("blob arguments are never held as desired values");
  return { type: arg.type, value: arg.value };
}
function describe(error) {
  return error instanceof Error ? error.message : String(error);
}
function isErrorCode(error, code) {
  return typeof error === "object" && error !== null && error.code === code;
}

// src/device-aliases.ts
var import_node_path5 = __toESM(require("node:path"));

// src/json-file.ts
var import_node_path4 = __toESM(require("node:path"));
function readJsonFile(fs5, file) {
  let text;
  try {
    text = fs5.readFileSync(file, "utf8");
  } catch (error) {
    if (isErrorCode2(error, "ENOENT")) return { kind: "missing" };
    return { kind: "failed", reason: `failed to read "${file}": ${describeError(error)}` };
  }
  try {
    return { kind: "ok", json: JSON.parse(text.replace(/^﻿/, "")) };
  } catch (error) {
    return { kind: "failed", reason: `"${file}" is not valid JSON: ${describeError(error)}` };
  }
}
function writeJsonFileAtomically(fs5, file, body, pid) {
  const temp = `${file}.${String(pid)}.tmp`;
  try {
    fs5.mkdirSync(import_node_path4.default.dirname(file), { recursive: true });
    fs5.writeFileSync(temp, `${JSON.stringify(body, null, 2)}
`, "utf8");
    fs5.renameSync(temp, file);
  } catch (error) {
    try {
      fs5.rmSync(temp, { force: true });
    } catch {
    }
    throw error;
  }
}
function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}
function isErrorCode2(error, code) {
  return typeof error === "object" && error !== null && error.code === code;
}

// src/lan-scan.ts
var import_node_child_process = require("node:child_process");
var import_node_dgram = __toESM(require("node:dgram"));
var import_node_fs2 = __toESM(require("node:fs"));
var import_promises = require("node:timers/promises");

// src/ipv4.ts
var IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
function ipv4ToInt(value) {
  const match = IPV4_PATTERN.exec(value);
  if (match === null) return null;
  let result = 0;
  for (const part of match.slice(1)) {
    const octet = Number(part);
    if (octet > 255) return null;
    result = result * 256 + octet;
  }
  return result >>> 0;
}
function intToIpv4(value) {
  return [24, 16, 8, 0].map((shift) => String(value >>> shift & 255)).join(".");
}
function isIpv4(value) {
  return ipv4ToInt(value) !== null;
}
function prefixLength(maskInt) {
  const inverted = ~maskInt >>> 0;
  if ((inverted & inverted + 1) !== 0) return null;
  return 32 - Math.round(Math.log2(inverted + 1));
}
function maskOf(prefix) {
  return prefix === 0 ? 0 : 4294967295 << 32 - prefix >>> 0;
}
function isUnicastIpv4(value) {
  const int = ipv4ToInt(value);
  if (int === null) return false;
  const first = int >>> 24;
  return int !== 0 && first !== 0 && first < 224;
}

// src/lan-scan.ts
var LINK_LOCAL_INT = ipv4ToInt("169.254.0.0");
var LINK_LOCAL_MASK = maskOf(16);
function scanSubnets(interfaces) {
  const result = [];
  for (const entry of interfaces) {
    if (entry.family !== "IPv4" || entry.internal) continue;
    const address = ipv4ToInt(entry.address);
    const maskInt = ipv4ToInt(entry.netmask);
    if (address === null || maskInt === null) continue;
    if ((address & LINK_LOCAL_MASK) >>> 0 === LINK_LOCAL_INT) continue;
    const prefix = prefixLength(maskInt);
    if (prefix === null || prefix > 30) continue;
    const networkInt = (address & maskInt) >>> 0;
    if (result.some((subnet) => subnet.networkInt === networkInt && subnet.maskInt === maskInt)) continue;
    const broadcastInt = (networkInt | ~maskInt) >>> 0;
    const scanPrefix = Math.max(prefix, DESTINATIONS.MIN_SCAN_PREFIX);
    const scanMask = maskOf(scanPrefix);
    const scanNetwork = (address & scanMask) >>> 0;
    const scanBroadcast = (scanNetwork | ~scanMask) >>> 0;
    const hosts = [];
    for (let value = scanNetwork + 1; value < scanBroadcast; value += 1) {
      if (value === address || value === networkInt || value === broadcastInt) continue;
      hosts.push(intToIpv4(value));
    }
    result.push({
      interface: entry.name,
      address: entry.address,
      networkInt,
      maskInt,
      network: `${intToIpv4(networkInt)}/${String(prefix)}`,
      broadcast: intToIpv4(broadcastInt),
      hosts,
      mac: normalizeMac(entry.mac)
    });
    if (result.length >= DESTINATIONS.MAX_SCAN_INTERFACES) break;
  }
  return result;
}
function localIpv4Addresses(interfaces) {
  return new Set(interfaces.filter((entry) => entry.family === "IPv4" && !entry.internal && ipv4ToInt(entry.address) !== null).map((entry) => entry.address));
}
function subnetsContaining(host, subnets) {
  const value = ipv4ToInt(host);
  if (value === null) return [];
  return subnets.filter((subnet) => (value & subnet.maskInt) >>> 0 === subnet.networkInt);
}
function subnetOf(host, subnets) {
  const value = ipv4ToInt(host);
  if (value === null) return void 0;
  return subnets.find((subnet) => (value & subnet.maskInt) >>> 0 === subnet.networkInt);
}
var IPV4_IN_LINE = /(?<![\d.])(\d{1,3}(?:\.\d{1,3}){3})(?![\d.])/;
var MAC_IN_LINE = /(?<![0-9a-f])((?:[0-9a-f]{1,2}[:-]){5}[0-9a-f]{1,2})(?![0-9a-f])/i;
function parseArpTable(text) {
  const result = [];
  for (const line of text.split(/\r?\n/)) {
    const ip = IPV4_IN_LINE.exec(line)?.[1];
    const mac = MAC_IN_LINE.exec(line)?.[1];
    if (ip === void 0 || mac === void 0 || ipv4ToInt(ip) === null) continue;
    result.push({ host: ip, mac: canonicalMac(mac) });
  }
  return result;
}
function canonicalMac(mac) {
  return mac.toLowerCase().split(/[:-]/).map((part) => part.padStart(2, "0")).join(":");
}
function normalizeMac(mac) {
  if (mac === void 0 || !/^(?:[0-9a-f]{1,2}[:-]){5}[0-9a-f]{1,2}$/i.test(mac)) return null;
  const normalized = canonicalMac(mac);
  return normalized === "00:00:00:00:00:00" ? null : normalized;
}
function selectNeighbors(entries, subnets) {
  const own = new Set(subnets.map((subnet) => subnet.address));
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const entry of entries) {
    const containing = subnetsContaining(entry.host, subnets);
    if (containing.length === 0 || own.has(entry.host) || seen.has(entry.host)) continue;
    const value = ipv4ToInt(entry.host);
    if (containing.some((subnet) => value === subnet.networkInt || value === ipv4ToInt(subnet.broadcast))) continue;
    const mac = entry.mac;
    if (mac !== null && (/^(?:00:){5}00$/.test(mac) || /^(?:ff:){5}ff$/.test(mac) || isMulticastMac(mac))) continue;
    seen.add(entry.host);
    result.push(entry);
  }
  return result;
}
function isMulticastMac(mac) {
  return (Number.parseInt(mac.slice(0, 2), 16) & 1) === 1;
}
var DISCARD_PORT = 9;
var DEFAULT_SETTLE_MS = 2500;
var DEFAULT_ARP_TIMEOUT_MS = 4e3;
function createSystemLanProber(options = {}) {
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
  const send = options.sendProbes ?? sendUdpProbes;
  const readArpTable = options.readArpTable ?? ((signal) => readSystemArpTable(options.arpTimeoutMs ?? DEFAULT_ARP_TIMEOUT_MS, signal));
  return {
    async probe(subnets, signal) {
      signal.throwIfAborted();
      await send(subnets.flatMap((subnet) => subnet.hosts), signal);
      await (0, import_promises.setTimeout)(settleMs, void 0, { signal });
      const table = await readArpTable(signal);
      signal.throwIfAborted();
      return selectNeighbors(parseArpTable(table), subnets);
    }
  };
}
async function sendUdpProbes(hosts, signal) {
  if (hosts.length === 0) return;
  const socket = import_node_dgram.default.createSocket({ type: "udp4", signal });
  socket.on("error", () => void 0);
  const empty = Buffer.alloc(0);
  try {
    await Promise.all(hosts.map((host) => new Promise((resolve) => {
      socket.send(empty, DISCARD_PORT, host, () => resolve());
    })));
  } finally {
    try {
      socket.close();
    } catch {
    }
  }
  signal.throwIfAborted();
}
function readSystemArpTable(timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    (0, import_node_child_process.execFile)("arp", ["-a"], { timeout: timeoutMs, windowsHide: true, encoding: "latin1", signal }, (error, stdout) => {
      if (error === null) {
        resolve(stdout);
        return;
      }
      if (signal.aborted) {
        reject(error);
        return;
      }
      import_node_fs2.default.readFile("/proc/net/arp", { encoding: "utf8", signal }, (fileError, text) => {
        if (fileError === null) resolve(text);
        else reject(error);
      });
    });
  });
}

// src/device-aliases.ts
var DEVICE_ALIASES_FILE_FORMAT = "oscdesk-device-aliases";
var DEVICE_ALIASES_FILE_VERSION = 1;
var DEFAULT_DEVICE_ALIASES_FILE_NAME = ".device-aliases.json";
var MAC_PATTERN = /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/;
var CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
var MAX_HOST_CHARS = 253;
function isAliasableMac(mac) {
  return typeof mac === "string" && MAC_PATTERN.test(mac);
}
function isAliasableHost(host) {
  return host.length > 0 && host.length <= MAX_HOST_CHARS && !CONTROL_CHARS.test(host) && !hasLoneSurrogate(host);
}
function macAliasKey(mac) {
  return `mac:${mac}`;
}
function hostAliasKey(host) {
  return `host:${host}`;
}
function aliasFor(aliases, host, mac) {
  if (isAliasableMac(mac)) {
    const byMac = aliases.get(macAliasKey(mac));
    if (byMac !== void 0) return byMac.alias;
  }
  return aliases.get(hostAliasKey(host))?.alias ?? null;
}
function lastSeenMacs(aliases) {
  const result = /* @__PURE__ */ new Map();
  for (const [key, entry] of aliases) {
    if (entry.host !== void 0 && key.startsWith("mac:")) result.set(entry.host, key.slice("mac:".length));
  }
  return result;
}
function normalizeAlias(input) {
  if (input === null) return { ok: true, alias: null };
  const alias = input.trim();
  if (alias === "") return { ok: true, alias: null };
  if (alias.length > DESTINATIONS.MAX_ALIAS_CHARS) {
    return { ok: false, reason: `alias-too-long: at most ${String(DESTINATIONS.MAX_ALIAS_CHARS)} characters` };
  }
  if (CONTROL_CHARS.test(alias)) return { ok: false, reason: "alias-has-control-characters" };
  if (hasLoneSurrogate(alias)) return { ok: false, reason: "alias-has-lone-surrogates" };
  return { ok: true, alias };
}
function updateAliases(aliases, host, mac, alias) {
  const next = new Map(aliases);
  const hostKey = hostAliasKey(host);
  const macKey = isAliasableMac(mac) ? macAliasKey(mac) : null;
  if (alias === null) {
    next.delete(hostKey);
    if (macKey !== null) next.delete(macKey);
    return { ok: true, aliases: next };
  }
  const key = macKey ?? hostKey;
  if (!next.has(key) && next.size - (macKey !== null && next.has(hostKey) ? 1 : 0) >= DESTINATIONS.MAX_DEVICE_ALIASES) {
    return { ok: false, reason: `too-many-aliases: at most ${String(DESTINATIONS.MAX_DEVICE_ALIASES)}` };
  }
  if (macKey === null) {
    next.set(hostKey, { alias });
    return { ok: true, aliases: next };
  }
  next.delete(hostKey);
  for (const [otherKey, entry] of next) {
    if (otherKey !== macKey && entry.host === host) next.set(otherKey, { alias: entry.alias });
  }
  next.set(macKey, { alias, host });
  return { ok: true, aliases: next };
}
function followMacs(aliases, seen) {
  const next = new Map(aliases);
  let changed = false;
  for (const { host, mac } of seen) {
    if (!isAliasableMac(mac)) continue;
    const macKey = macAliasKey(mac);
    for (const [key, entry] of next) {
      if (key !== macKey && entry.host === host) {
        next.set(key, { alias: entry.alias });
        changed = true;
      }
    }
    const own = next.get(macKey);
    if (own !== void 0 && own.host !== host) {
      next.set(macKey, { alias: own.alias, host });
      changed = true;
    }
  }
  return { aliases: next, changed };
}
var DeviceAliasesFileSchema = external_exports.object({
  format: external_exports.literal(DEVICE_ALIASES_FILE_FORMAT),
  version: external_exports.literal(DEVICE_ALIASES_FILE_VERSION),
  savedAt: external_exports.string(),
  // 1 件ずつ検証する(1 件の書き損じでファイル全体を捨てると、次の保存で全部の別名が消えるため)
  aliases: external_exports.array(external_exports.unknown())
}).strict();
var AliasFileEntrySchema = external_exports.object({
  key: external_exports.string(),
  alias: external_exports.string(),
  host: external_exports.string().optional()
}).strict();
function readEntry(raw) {
  const parsed = AliasFileEntrySchema.safeParse(raw);
  if (!parsed.success) return null;
  const { key, host } = parsed.data;
  const alias = normalizeAlias(parsed.data.alias);
  if (!alias.ok || alias.alias === null) return null;
  if (key.startsWith("mac:")) {
    const mac = normalizeMac(key.slice("mac:".length));
    if (mac === null) return null;
    if (host !== void 0 && !isAliasableHost(host)) return [macAliasKey(mac), { alias: alias.alias }];
    return [macAliasKey(mac), host === void 0 ? { alias: alias.alias } : { alias: alias.alias, host }];
  }
  if (key.startsWith("host:")) {
    const target = key.slice("host:".length);
    return isAliasableHost(target) ? [hostAliasKey(target), { alias: alias.alias }] : null;
  }
  return null;
}
function createDeviceAliasFile(options) {
  const fs5 = options.fs;
  const file = import_node_path5.default.resolve(options.file);
  const now = options.now ?? Date.now;
  const pid = options.pid ?? process.pid;
  const logWarn = options.logWarn ?? console.warn;
  let unreadable = null;
  return {
    file,
    load() {
      unreadable = null;
      const read = readJsonFile(fs5, file);
      if (read.kind === "missing") return /* @__PURE__ */ new Map();
      if (read.kind === "failed") {
        unreadable = read.reason;
        logWarn("(WARN, BRIDGE)", `Device aliases not restored (the file is kept as is): ${read.reason}`);
        return /* @__PURE__ */ new Map();
      }
      const parsed = DeviceAliasesFileSchema.safeParse(read.json);
      if (!parsed.success) {
        const issues = parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`);
        unreadable = `"${file}" is invalid: ${issues.join("; ")}`;
        logWarn("(WARN, BRIDGE)", `Device aliases not restored (the file is kept as is): ${unreadable}`);
        return /* @__PURE__ */ new Map();
      }
      const result = /* @__PURE__ */ new Map();
      const dropped = [];
      parsed.data.aliases.forEach((raw, index) => {
        const entry = readEntry(raw);
        if (entry === null || !result.has(entry[0]) && result.size >= DESTINATIONS.MAX_DEVICE_ALIASES) dropped.push(index);
        else result.set(entry[0], entry[1]);
      });
      if (dropped.length > 0) {
        logWarn("(WARN, BRIDGE)", `Device aliases: ignored ${String(dropped.length)} invalid or excess entr${dropped.length === 1 ? "y" : "ies"} in "${file}" (aliases[${dropped.slice(0, 5).join(", ")}]).`);
      }
      return result;
    },
    save(aliases) {
      if (unreadable !== null) {
        logWarn("(WARN, BRIDGE)", `Not overwriting device aliases in "${file}" because it could not be read (fix or remove it): ${unreadable}`);
        return false;
      }
      try {
        writeJsonFileAtomically(fs5, file, {
          format: DEVICE_ALIASES_FILE_FORMAT,
          version: DEVICE_ALIASES_FILE_VERSION,
          savedAt: new Date(now()).toISOString(),
          aliases: [...aliases].sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => entry.host === void 0 ? { key, alias: entry.alias } : { key, alias: entry.alias, host: entry.host })
        }, pid);
        return true;
      } catch (error) {
        logWarn("(WARN, BRIDGE)", `Failed to save device aliases to "${file}" (the aliases last until the bridge stops): ${describeError(error)}`);
        return false;
      }
    }
  };
}
function createMemoryDeviceAliasStore() {
  let saved = /* @__PURE__ */ new Map();
  return {
    file: "(memory)",
    load: () => new Map(saved),
    save: (aliases) => {
      saved = new Map(aliases);
      return true;
    }
  };
}

// src/destinations.ts
var ALL_DEVICES_TARGET_NAME = "all-devices";
function isSelectableHost(host, configTargets, subnets) {
  if (configTargets.some((target) => target.host === host)) return true;
  if (!isUnicastIpv4(host)) return false;
  const value = ipv4ToInt(host);
  if (intToIpv4(value) !== host) return false;
  const containing = subnetsContaining(host, subnets);
  return containing.length > 0 && containing.every((subnet) => value !== subnet.networkInt && value !== ipv4ToInt(subnet.broadcast));
}
function resolveDestinationTargets(input) {
  const { selection, configTargets, subnets, sendPort } = input;
  const own = input.ownAddresses ?? new Set(subnets.map((subnet) => subnet.address));
  if (selection === null) return configTargets.map((target) => ({ ...target, addresses: withLoopbackAlias(target.host, target.addresses, own) }));
  const ownAddresses = [...own];
  if (selection.allDevices) {
    if (subnets.length === 0) return null;
    return subnets.map((subnet, index) => ({
      name: index === 0 ? ALL_DEVICES_TARGET_NAME : `${ALL_DEVICES_TARGET_NAME}-${String(index + 1)}`,
      host: subnet.broadcast,
      sendPort,
      primary: index === 0,
      ...ownAddresses.length > 0 ? { addresses: ownAddresses } : {},
      broadcast: { networkInt: subnet.networkInt, maskInt: subnet.maskInt }
    }));
  }
  const networks = subnets.filter((subnet) => selection.networks.includes(subnet.network));
  const reaches = (address, subnet) => {
    const narrowest = narrowestSubnet(address, subnets);
    return narrowest !== void 0 && (subnet.network === narrowest.network || subnet.broadcast === narrowest.broadcast && inSubnet(address, subnet));
  };
  const inNetworks = (host, addresses = []) => [host, ...addresses].some((address) => networks.some((subnet) => reaches(address, subnet)));
  const isThisPc = (host, addresses = []) => [host, ...addresses].some((address) => own.has(address) || isLoopbackIpv4(address));
  const covered = (host, port, addresses) => port === sendPort && networks.length > 0 && (inNetworks(host, addresses) || isThisPc(host, addresses));
  const hosts = [...new Set(selection.hosts)].filter((host) => isSelectableHost(host, configTargets, subnets));
  if (hosts.length === 0 && networks.length === 0) return null;
  const used = /* @__PURE__ */ new Set();
  const uniqueName = (base) => {
    let name = base;
    for (let index = 2; used.has(name); index += 1) name = `${base}-${String(index)}`;
    used.add(name);
    return name;
  };
  const slots = hosts.flatMap((host) => {
    const configured = configTargets.filter((target) => target.host === host && !covered(host, target.sendPort, target.addresses));
    if (configured.length > 0) return configured.map((target) => ({ host, target, name: uniqueName(target.name) }));
    if (configTargets.some((target) => target.host === host) || covered(host, sendPort)) return [];
    return [{ host, target: null, name: "" }];
  });
  const broadcastTargets = networks.map((subnet) => ({
    name: uniqueName(`net-${subnet.network.replace(/[./]/g, "-")}`),
    host: subnet.broadcast,
    sendPort,
    primary: false,
    ...ownAddresses.length > 0 ? { addresses: ownAddresses } : {},
    broadcast: { networkInt: subnet.networkInt, maskInt: subnet.maskInt }
  }));
  const unicastTargets = slots.map((slot) => {
    if (slot.target !== null) {
      return { ...slot.target, name: slot.name, primary: false, addresses: withLoopbackAlias(slot.target.host, slot.target.addresses, own) };
    }
    const addresses = withLoopbackAlias(slot.host, [], own);
    return {
      name: uniqueName(`ip-${slot.host.replace(/\./g, "-")}`),
      host: slot.host,
      sendPort,
      primary: false,
      ...addresses.length > 0 ? { addresses } : {}
    };
  });
  const result = [...broadcastTargets, ...unicastTargets];
  if (result.length === 0) return null;
  const configPrimary = configTargets.find((target) => target.primary);
  const unicastPrimary = result.findIndex((target) => configPrimary !== void 0 && target.broadcast === void 0 && target.host === configPrimary.host && target.sendPort === configPrimary.sendPort);
  const networkPrimary = configPrimary === void 0 ? -1 : networks.findIndex((subnet) => [configPrimary.host, ...configPrimary.addresses].some((address) => reaches(address, subnet)));
  const primaryIndex = unicastPrimary >= 0 ? unicastPrimary : Math.max(0, networkPrimary);
  return result.map((target, index) => ({ ...target, primary: index === primaryIndex }));
}
function isLoopbackIpv4(host) {
  const value = ipv4ToInt(host);
  return value !== null && value >>> 24 === 127;
}
function narrowestSubnet(host, subnets) {
  return subnetsContaining(host, subnets).reduce(
    (best, subnet) => best === void 0 || subnet.maskInt > best.maskInt ? subnet : best,
    void 0
  );
}
function inSubnet(host, subnet) {
  const value = ipv4ToInt(host);
  return value !== null && (value & subnet.maskInt) >>> 0 === subnet.networkInt;
}
function withLoopbackAlias(host, addresses, own) {
  const isSelf = own.has(host) || addresses.some((address) => own.has(address));
  return isSelf && !addresses.includes(LOOPBACK_ALIAS) ? [...addresses, LOOPBACK_ALIAS] : [...addresses];
}
var LOOPBACK_ALIAS = "127.0.0.1";
function listDevices(input) {
  const devices = /* @__PURE__ */ new Map();
  const upsert = (host, patch) => {
    const current = devices.get(host) ?? {
      host,
      hostname: input.hostnames?.get(host) ?? null,
      alias: null,
      mac: input.knownMacs?.get(host) ?? null,
      interface: subnetOf(host, input.subnets)?.interface ?? null,
      self: false,
      configured: false,
      found: false
    };
    devices.set(host, { ...current, ...patch });
  };
  for (const neighbor of input.neighbors) upsert(neighbor.host, { mac: neighbor.mac ?? input.knownMacs?.get(neighbor.host) ?? null, found: true });
  for (const subnet of input.subnets) {
    upsert(subnet.address, {
      self: true,
      found: true,
      mac: subnet.mac ?? input.knownMacs?.get(subnet.address) ?? null,
      ...input.localHostname ? { hostname: input.localHostname } : {}
    });
  }
  for (const target of input.configTargets) upsert(target.host, { configured: true });
  for (const host of input.selectedHosts) upsert(host, {});
  const aliases = input.aliases ?? /* @__PURE__ */ new Map();
  return [...devices.values()].map((device) => ({ ...device, alias: aliasFor(aliases, device.host, device.mac) })).sort(compareHosts);
}
function compareHosts(a, b) {
  const left = ipv4ToInt(a.host);
  const right = ipv4ToInt(b.host);
  if (left !== null && right !== null) return left - right;
  if (left !== null) return -1;
  if (right !== null) return 1;
  return a.host.localeCompare(b.host);
}
function createDestinations(deps) {
  const now = deps.now ?? Date.now;
  const setTimeoutFn = deps.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = deps.clearTimeoutFn ?? clearTimeout;
  const logInfo = deps.logInfo ?? console.info;
  const logWarn = deps.logWarn ?? console.warn;
  const configHosts = [...new Set(deps.configTargets.map((target) => target.host))];
  let selection = null;
  let subnets = [];
  let ownAddresses = /* @__PURE__ */ new Set();
  let neighbors = [];
  const hostnames = /* @__PURE__ */ new Map();
  let scannedAt = null;
  let inFlight = null;
  let abortScan = null;
  let closed = false;
  let persisted = true;
  const aliasStore = deps.aliasStore ?? createMemoryDeviceAliasStore();
  let aliases = /* @__PURE__ */ new Map();
  const sessionMacs = /* @__PURE__ */ new Map();
  const knownMacs = () => new Map([...lastSeenMacs(aliases), ...sessionMacs]);
  const rememberMacs = (seen) => {
    for (const { host, mac } of seen) {
      if (mac === null) continue;
      for (const [other, otherMac] of sessionMacs) if (otherMac === mac && other !== host) sessionMacs.delete(other);
      sessionMacs.set(host, mac);
    }
    const followed = followMacs(aliases, seen);
    if (followed.changed) {
      aliases = followed.aliases;
      aliasStore.save(aliases);
    }
  };
  const isListed = (host) => neighbors.some((neighbor) => neighbor.host === host) || subnets.some((subnet) => subnet.address === host) || deps.configTargets.some((target) => target.host === host) || (selection?.hosts.includes(host) ?? false);
  const macOf = (host) => neighbors.find((neighbor) => neighbor.host === host)?.mac ?? subnets.find((subnet) => subnet.address === host)?.mac ?? sessionMacs.get(host) ?? lastSeenMacs(aliases).get(host) ?? null;
  const revalidate = (candidate, context) => {
    const hosts = candidate.hosts.filter((host) => isSelectableHost(host, deps.configTargets, subnets));
    const dropped = candidate.hosts.filter((host) => !hosts.includes(host));
    if (dropped.length > 0) {
      logWarn("(WARN, BRIDGE)", `Destinations (${context}): dropped host(s) outside the local networks and the config targets: ${dropped.join(", ")}.`);
    }
    const known = new Set(subnets.map((subnet) => subnet.network));
    const networks = candidate.networks.filter((network) => known.has(network));
    const droppedNetworks = candidate.networks.filter((network) => !known.has(network));
    if (droppedNetworks.length > 0) {
      logWarn("(WARN, BRIDGE)", `Destinations (${context}): dropped network(s) this PC is no longer on: ${droppedNetworks.join(", ")}.`);
    }
    if (!candidate.allDevices && hosts.length === 0 && networks.length === 0) {
      logWarn("(WARN, BRIDGE)", `Destinations (${context}): no selectable host or network left; using the config targets.`);
      return null;
    }
    return { allDevices: candidate.allDevices, networks, hosts };
  };
  const apply = () => {
    const targets = resolveDestinationTargets({ selection, configTargets: deps.configTargets, subnets, sendPort: deps.sendPort, ownAddresses });
    if (targets === null) {
      logWarn("(WARN, BRIDGE)", selection?.allDevices === true ? 'Destinations: "all devices" needs an IPv4 network interface; using the config targets for now.' : "Destinations: no selectable host in the saved selection; using the config targets for now.");
      deps.applyTargets(resolveDestinationTargets({ selection: null, configTargets: deps.configTargets, subnets, sendPort: deps.sendPort, ownAddresses }));
      return;
    }
    deps.applyTargets(targets);
  };
  const devices = () => listDevices({
    neighbors,
    subnets,
    configTargets: deps.configTargets,
    selectedHosts: selection?.hosts ?? [],
    hostnames,
    localHostname: deps.localHostname?.() ?? null,
    aliases,
    knownMacs: knownMacs()
  });
  const frame = () => ({
    v: 1,
    type: "destinations",
    sendPort: deps.sendPort,
    scanning: inFlight !== null,
    scannedAt: scannedAt === null ? null : new Date(scannedAt).toISOString(),
    devices: devices(),
    broadcasts: subnets.map((subnet) => ({ address: subnet.broadcast, interface: subnet.interface, network: subnet.network })),
    // 未保存の間は設定の宛先のホストを選択中として見せる(チェックを足し引きした結果がそのまま新しい選択になる)
    selection: selection === null ? { source: "config", allDevices: false, networks: [], hosts: configHosts } : { source: persisted ? "saved" : "unsaved", allDevices: selection.allDevices, networks: [...selection.networks], hosts: [...selection.hosts] },
    targets: deps.currentTargets().map((target) => ({
      name: target.name,
      host: target.host,
      sendPort: target.sendPort,
      primary: target.primary,
      broadcast: target.broadcast !== null
    })),
    primaryHosts: [...deps.primaryHosts()]
  });
  const publish = (clientId) => {
    if (!closed) deps.publish(frame(), clientId);
  };
  const reject = (clientId, detail) => {
    deps.publish({ v: 1, type: "notice", level: "error", code: "destinations-rejected", detail }, clientId);
    publish(clientId);
  };
  const networksKey = (list) => list.map((subnet) => `${String(subnet.networkInt)}/${String(subnet.maskInt)}`).join(",");
  const addressesKey = (own) => [...own].sort().join(",");
  const saveFailed = (detail) => {
    deps.publish({ v: 1, type: "notice", level: "error", code: "destinations-save-failed", detail });
  };
  let abortLookup = null;
  const lookupHostnames = async () => {
    if (deps.hostnameResolver === void 0) return;
    const own = new Set(subnets.map((subnet) => subnet.address));
    const targets = [.../* @__PURE__ */ new Set([
      ...neighbors.map((neighbor) => neighbor.host),
      ...selection?.hosts ?? [],
      ...configHosts
    ])].filter((host) => !own.has(host) && ipv4ToInt(host) !== null);
    const controller = new AbortController();
    abortLookup = () => controller.abort(new Error("bridge is closing"));
    try {
      const results = await deps.hostnameResolver.resolve(targets, controller.signal);
      if (closed) return;
      for (const [host, name] of results) {
        if (name === null) hostnames.delete(host);
        else hostnames.set(host, name);
      }
    } catch (error) {
      logWarn("(WARN, BRIDGE)", `Hostname lookup failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      abortLookup = null;
    }
  };
  const scan = () => {
    if (inFlight !== null) return inFlight;
    const controller = new AbortController();
    abortScan = (reason) => controller.abort(reason);
    const scanning = (async () => {
      const interfacesNow = deps.interfaces();
      const subnetsNow = scanSubnets(interfacesNow);
      const ownNow = localIpv4Addresses(interfacesNow);
      const timer = setTimeoutFn(
        () => controller.abort(new Error(`timed out after ${String(deps.scanTimeoutMs)} ms`)),
        deps.scanTimeoutMs
      );
      try {
        const found = await deps.prober.probe(subnetsNow, controller.signal);
        controller.signal.throwIfAborted();
        if (closed) return;
        const networksChanged = networksKey(subnets) !== networksKey(subnetsNow);
        const ownChanged = addressesKey(ownAddresses) !== addressesKey(ownNow);
        subnets = subnetsNow;
        ownAddresses = ownNow;
        neighbors = found;
        rememberMacs([...found, ...subnetsNow.map((subnet) => ({ host: subnet.address, mac: subnet.mac ?? null }))]);
        scannedAt = now();
        logInfo("(INFO, BRIDGE)", `LAN scan found ${String(found.length)} device(s) on ${subnetsNow.map((subnet) => subnet.network).join(", ") || "no IPv4 network"}.`);
        if (networksChanged && selection !== null) selection = revalidate(selection, "network changed");
        if (networksChanged || ownChanged) apply();
        clearTimeoutFn(timer);
        await lookupHostnames();
      } catch (error) {
        if (closed) return;
        const cause = controller.signal.aborted ? controller.signal.reason : error;
        const detail = cause instanceof Error ? cause.message : String(cause);
        logWarn("(WARN, BRIDGE)", `LAN scan failed: ${detail}`);
        deps.publish({ v: 1, type: "notice", level: "warn", code: "destinations-scan-failed", detail });
      } finally {
        clearTimeoutFn(timer);
      }
    })();
    inFlight = scanning.finally(() => {
      inFlight = null;
      abortScan = null;
      publish();
    });
    publish();
    return inFlight;
  };
  const select = (frameIn, clientId) => {
    const hosts = [...new Set(frameIn.hosts)];
    const invalid = hosts.find((host) => !isSelectableHost(host, deps.configTargets, subnets));
    if (invalid !== void 0) return reject(clientId, `invalid-host: ${invalid}`);
    const networks = [...new Set(frameIn.networks)];
    const unknownNetwork = networks.find((network) => !subnets.some((subnet) => subnet.network === network));
    if (unknownNetwork !== void 0) return reject(clientId, `invalid-network: ${unknownNetwork}`);
    if (!frameIn.allDevices && hosts.length === 0 && networks.length === 0) return reject(clientId, "empty-selection");
    if (frameIn.allDevices && subnets.length === 0) return reject(clientId, "no-broadcast-network");
    selection = { allDevices: frameIn.allDevices, networks, hosts };
    persisted = deps.store.save(selection);
    if (!persisted) saveFailed(`could not write ${deps.store.file}; the selection lasts until the bridge stops`);
    apply();
    publish();
  };
  const setAlias = (frameIn, clientId) => {
    const rejectAlias = (detail) => {
      deps.publish({ v: 1, type: "notice", level: "error", code: "destination-alias-rejected", detail }, clientId);
      publish(clientId);
    };
    const host = frameIn.host;
    if (!isListed(host)) return rejectAlias(`unknown-host: ${host}`);
    if (!isAliasableHost(host)) return rejectAlias(`unaliasable-host: ${host}`);
    const normalized = normalizeAlias(frameIn.alias);
    if (!normalized.ok) return rejectAlias(normalized.reason);
    const updated = updateAliases(aliases, host, macOf(host), normalized.alias);
    if (!updated.ok) return rejectAlias(updated.reason);
    aliases = updated.aliases;
    if (!aliasStore.save(aliases)) {
      deps.publish({
        v: 1,
        type: "notice",
        level: "error",
        code: "destination-aliases-save-failed",
        detail: `could not write ${aliasStore.file}; the device names last until the bridge stops`
      });
    }
    publish();
  };
  return {
    start() {
      const interfaces = deps.interfaces();
      subnets = scanSubnets(interfaces);
      ownAddresses = localIpv4Addresses(interfaces);
      aliases = aliasStore.load();
      if (aliases.size > 0) logInfo("(INFO, BRIDGE)", `Restored ${String(aliases.size)} device name(s) from "${aliasStore.file}".`);
      const saved = deps.store.load();
      if (saved !== null) {
        selection = revalidate(saved, `restoring ${deps.store.file}`);
        persisted = true;
        if (selection !== null) logInfo("(INFO, BRIDGE)", `Restored destinations from "${deps.store.file}".`);
      }
      if (selection !== null) apply();
    },
    handleUiFrame(frameIn, clientId) {
      if (frameIn.type === "destinationsScan") {
        if (inFlight !== null) publish(clientId);
        else void scan();
        return true;
      }
      if (frameIn.type === "destinationsSelect") {
        select(frameIn, clientId);
        return true;
      }
      if (frameIn.type === "destinationsReset") {
        selection = null;
        persisted = true;
        if (!deps.store.clear()) saveFailed(`could not remove ${deps.store.file}; the saved selection comes back after a bridge restart`);
        apply();
        publish();
        return true;
      }
      if (frameIn.type === "destinationsAlias") {
        setAlias(frameIn, clientId);
        return true;
      }
      return false;
    },
    publish,
    scan,
    close() {
      closed = true;
      abortScan?.(new Error("bridge is closing"));
      abortLookup?.();
    }
  };
}

// src/destinations-file.ts
var import_node_path6 = __toESM(require("node:path"));
var DESTINATIONS_FILE_FORMAT = "oscdesk-destinations";
var DESTINATIONS_FILE_VERSION = 1;
var DEFAULT_DESTINATIONS_FILE_NAME = ".destinations.json";
var DestinationsFileSchema = external_exports.object({
  format: external_exports.literal(DESTINATIONS_FILE_FORMAT),
  version: external_exports.literal(DESTINATIONS_FILE_VERSION),
  savedAt: external_exports.string(),
  allDevices: external_exports.boolean(),
  // D-085 で足した。足す前に保存したファイル(networks が無い)もそのまま読めるよう、省略は空として扱う
  networks: external_exports.array(external_exports.string().min(1).max(18)).max(DESTINATIONS.MAX_SCAN_INTERFACES).default([]),
  hosts: external_exports.array(external_exports.string().min(1).max(253)).max(DESTINATIONS.MAX_SELECTED_HOSTS)
}).strict();
function createDestinationSelectionFile(options) {
  const fs5 = options.fs;
  const file = import_node_path6.default.resolve(options.file);
  const now = options.now ?? Date.now;
  const pid = options.pid ?? process.pid;
  const logWarn = options.logWarn ?? console.warn;
  return {
    file,
    load() {
      const read = readJsonFile(fs5, file);
      if (read.kind === "missing") return null;
      if (read.kind === "failed") {
        logWarn("(WARN, BRIDGE)", `Destinations not restored (using the config targets): ${read.reason}`);
        return null;
      }
      const parsed = DestinationsFileSchema.safeParse(read.json);
      if (!parsed.success) {
        const issues = parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`);
        logWarn("(WARN, BRIDGE)", `Destinations not restored (using the config targets): "${file}" is invalid: ${issues.join("; ")}`);
        return null;
      }
      return { allDevices: parsed.data.allDevices, networks: [...parsed.data.networks], hosts: [...parsed.data.hosts] };
    },
    save(selection) {
      try {
        writeJsonFileAtomically(fs5, file, {
          format: DESTINATIONS_FILE_FORMAT,
          version: DESTINATIONS_FILE_VERSION,
          savedAt: new Date(now()).toISOString(),
          allDevices: selection.allDevices,
          networks: [...selection.networks],
          hosts: [...selection.hosts]
        }, pid);
        return true;
      } catch (error) {
        logWarn("(WARN, BRIDGE)", `Failed to save destinations to "${file}" (the selection lasts until the bridge stops): ${describeError(error)}`);
        return false;
      }
    },
    clear() {
      try {
        fs5.rmSync(file, { force: true });
        return true;
      } catch (error) {
        logWarn("(WARN, BRIDGE)", `Failed to remove saved destinations "${file}": ${describeError(error)}`);
        return false;
      }
    }
  };
}

// src/lock-manager.ts
function lockKey(ref) {
  return "param" in ref ? `p\0${ref.param}` : `r\0${ref.record}\0${ref.key}`;
}
var MAX_LOCKS_PER_CONNECTION = 256;
var MAX_LOCKS_TOTAL = 1024;
var SWEEP_INTERVAL_MS = 100;
var MIN_BROADCAST_INTERVAL_MS = 100;
function createLockManager(deps) {
  const now = deps.now ?? Date.now;
  const leaseMs = deps.leaseMs ?? LOCK.LEASE_MS;
  const leases = /* @__PURE__ */ new Map();
  const setIntervalFn = deps.setIntervalFn ?? setInterval;
  const clearIntervalFn = deps.clearIntervalFn ?? clearInterval;
  const sameOwner = (lease, clientId, holder) => lease.clientId === clientId && holder !== void 0 && lease.holder === holder;
  const frame = () => ({
    v: 1,
    type: "locks",
    locks: [...leases.values()].map((lease) => ({ ref: lease.ref, clientId: lease.clientId, holder: lease.holder, label: lease.label }))
  });
  let lastBroadcastAt = -Infinity;
  let pending = false;
  const flush = () => {
    pending = false;
    lastBroadcastAt = now();
    deps.publish(frame());
  };
  const broadcast = () => {
    if (now() - lastBroadcastAt >= MIN_BROADCAST_INTERVAL_MS) flush();
    else pending = true;
  };
  const sweep = () => {
    const at = now();
    let changed = false;
    for (const [key, lease] of leases) {
      if (lease.expiresAt <= at) {
        leases.delete(key);
        changed = true;
      }
    }
    if (changed) broadcast();
    if (pending && now() - lastBroadcastAt >= MIN_BROADCAST_INTERVAL_MS) flush();
  };
  const timer = setIntervalFn(sweep, SWEEP_INTERVAL_MS);
  return {
    handleUiFrame(uiFrame, clientId) {
      if (uiFrame.type === "lock") {
        sweep();
        const key = lockKey(uiFrame.ref);
        const current = leases.get(key);
        if (current !== void 0 && !sameOwner(current, clientId, uiFrame.holder)) {
          deps.publish({ v: 1, type: "notice", level: "warn", code: "lock-rejected", detail: `held: ${current.label}` }, clientId);
          return true;
        }
        if (current !== void 0) {
          current.expiresAt = now() + leaseMs;
          return true;
        }
        const owned = [...leases.values()].filter((lease) => lease.clientId === clientId).length;
        if (owned >= MAX_LOCKS_PER_CONNECTION || leases.size >= MAX_LOCKS_TOTAL) {
          deps.publish({ v: 1, type: "notice", level: "warn", code: "lock-rejected", detail: "too-many-locks" }, clientId);
          return true;
        }
        leases.set(key, { ref: uiFrame.ref, clientId, holder: uiFrame.holder, label: uiFrame.label, expiresAt: now() + leaseMs });
        broadcast();
        return true;
      }
      if (uiFrame.type === "unlock") {
        const key = lockKey(uiFrame.ref);
        const current = leases.get(key);
        if (current !== void 0 && sameOwner(current, clientId, uiFrame.holder)) {
          leases.delete(key);
          broadcast();
        }
        return true;
      }
      return false;
    },
    publish(clientId) {
      sweep();
      deps.publish(frame(), clientId);
    },
    releaseConnection(clientId) {
      let changed = false;
      for (const [key, lease] of leases) {
        if (lease.clientId === clientId) {
          leases.delete(key);
          changed = true;
        }
      }
      if (changed) broadcast();
    },
    blockingOwner(refs, clientId, holder) {
      const at = now();
      for (const ref of refs) {
        const lease = leases.get(lockKey(ref));
        if (lease !== void 0 && lease.expiresAt > at && !sameOwner(lease, clientId, holder)) return lease;
      }
      return null;
    },
    close() {
      clearIntervalFn(timer);
    }
  };
}

// src/hostname-lookup.ts
var import_node_dns = __toESM(require("node:dns"));
var import_node_net = __toESM(require("node:net"));
var NO_HOSTNAMES = { resolve: () => Promise.resolve(/* @__PURE__ */ new Map()) };
var DEFAULT_REVERSE_TIMEOUT_MS = 1e3;
var DEFAULT_BUDGET_MS = 3e3;
function createSystemHostnameResolver(options = {}) {
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
  const reverse = options.reverse ?? createReverse(options.reverseTimeoutMs ?? DEFAULT_REVERSE_TIMEOUT_MS);
  const lookupService = options.lookupService ?? (async (host) => (await import_node_dns.default.promises.lookupService(host, 0)).hostname);
  const now = options.now ?? Date.now;
  let systemLookup = null;
  return {
    async resolve(hosts, outerSignal) {
      const results = /* @__PURE__ */ new Map();
      const unique = [...new Set(hosts)].filter((host) => import_node_net.default.isIPv4(host));
      if (unique.length === 0) return results;
      const deadline = now() + budgetMs;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error("hostname lookup budget exceeded")), budgetMs);
      const onOuterAbort = () => controller.abort(outerSignal.reason);
      outerSignal.addEventListener("abort", onOuterAbort, { once: true });
      const signal = controller.signal;
      try {
        await Promise.all(unique.map(async (host) => {
          try {
            const name = (await reverse(host, signal)).map(cleanHostname).find((value) => value !== null);
            if (name !== void 0) results.set(host, name);
          } catch {
          }
        }));
        for (const host of unique) {
          if (results.has(host)) continue;
          if (signal.aborted || systemLookup !== null) break;
          const remaining = deadline - now();
          if (remaining <= 0) break;
          const pending = lookupService(host);
          systemLookup = pending;
          void pending.catch(() => void 0).finally(() => {
            if (systemLookup === pending) systemLookup = null;
          });
          const outcome = await raceAbort(pending, signal);
          if (outcome.kind === "aborted") break;
          results.set(host, outcome.kind === "value" ? cleanHostname(outcome.value) : null);
        }
      } finally {
        clearTimeout(timer);
        outerSignal.removeEventListener("abort", onOuterAbort);
      }
      return results;
    }
  };
}
function createReverse(timeoutMs) {
  return async (host, signal) => {
    const resolver = new import_node_dns.default.promises.Resolver({ timeout: timeoutMs, tries: 1 });
    const cancel = () => resolver.cancel();
    signal.addEventListener("abort", cancel, { once: true });
    try {
      return await resolver.reverse(host);
    } finally {
      signal.removeEventListener("abort", cancel);
    }
  };
}
function raceAbort(promise, signal) {
  if (signal.aborted) return Promise.resolve({ kind: "aborted" });
  return new Promise((resolve) => {
    const onAbort = () => resolve({ kind: "aborted" });
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => resolve({ kind: "value", value }),
      () => resolve({ kind: "failed" })
    ).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
function cleanHostname(value) {
  const name = value.trim().replace(/\.$/, "");
  if (name === "" || name.length > 253 || import_node_net.default.isIP(name) !== 0) return null;
  if (/[\u0000-\u001f\u007f\s]/.test(name)) return null;
  if (/^localhost(?:\.localdomain)?$/i.test(name)) return null;
  return name;
}

// src/pad-manager.ts
var import_node_crypto = require("node:crypto");
var import_node_path8 = __toESM(require("node:path"));

// src/surface-store.ts
var import_node_fs3 = __toESM(require("node:fs"));
var import_node_path7 = __toESM(require("node:path"));
var BACKUP_DIR_NAME = ".backups";
var BACKUPS_PER_NAME = 20;
var FILE_EXTENSION = ".json";
function formatSurfaceStoreError(error, label = "surface") {
  switch (error.kind) {
    case "invalid-name":
      return `invalid ${label} name "${error.name}"`;
    case "not-found":
      return `${label} "${error.name}" not found`;
    case "read-failed":
      return `failed to read ${label} "${error.name}": ${error.detail}`;
    case "invalid-json":
      return `${label} "${error.name}" is not valid JSON: ${error.detail}`;
    case "invalid-definition":
      return `${label} "${error.name}" is invalid: ${error.issues.join("; ")}`;
    case "write-failed":
      return `failed to write ${label} "${error.name}": ${error.detail}`;
  }
}
function createSurfaceStore(options) {
  return createNamedJsonStore({ ...options, schema: SurfaceDefinitionSchema });
}
function createNamedJsonStore(options) {
  const dir = import_node_path7.default.resolve(options.dir);
  const backupDir = import_node_path7.default.join(dir, BACKUP_DIR_NAME);
  const now = options.now ?? Date.now;
  const filePath = (name) => import_node_path7.default.join(dir, `${name}${FILE_EXTENSION}`);
  const validate = (name, input) => {
    const parsed = options.schema.safeParse(input);
    if (parsed.success) return { ok: true, value: parsed.data };
    return {
      ok: false,
      error: {
        kind: "invalid-definition",
        name,
        issues: parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      }
    };
  };
  const readRaw = (name) => {
    if (!isValidSurfaceName(name)) return { ok: false, error: { kind: "invalid-name", name } };
    try {
      return { ok: true, value: import_node_fs3.default.readFileSync(filePath(name), "utf8") };
    } catch (error) {
      if (isErrorCode3(error, "ENOENT")) return { ok: false, error: { kind: "not-found", name } };
      return { ok: false, error: { kind: "read-failed", name, detail: describe2(error) } };
    }
  };
  return {
    list() {
      let entries;
      try {
        entries = import_node_fs3.default.readdirSync(dir);
      } catch {
        return [];
      }
      return entries.filter((entry) => entry.endsWith(FILE_EXTENSION)).map((entry) => entry.slice(0, -FILE_EXTENSION.length)).filter(isValidSurfaceName).sort();
    },
    readRaw,
    validate,
    read(name) {
      const raw = readRaw(name);
      if (!raw.ok) return raw;
      let json;
      try {
        json = JSON.parse(raw.value.replace(/^﻿/, ""));
      } catch (error) {
        return { ok: false, error: { kind: "invalid-json", name, detail: describe2(error) } };
      }
      return validate(name, json);
    },
    save(name, input) {
      if (!isValidSurfaceName(name)) return { ok: false, error: { kind: "invalid-name", name } };
      const checked = validate(name, input);
      if (!checked.ok) return checked;
      return write(name, checked.value);
    },
    saveValidated(name, value) {
      if (!isValidSurfaceName(name)) return { ok: false, error: { kind: "invalid-name", name } };
      return write(name, value);
    }
  };
  function write(name, value) {
    const checked = { ok: true, value };
    const target = filePath(name);
    const temp = `${target}.${String(process.pid)}.tmp`;
    try {
      import_node_fs3.default.mkdirSync(dir, { recursive: true });
      if (import_node_fs3.default.existsSync(target)) {
        import_node_fs3.default.mkdirSync(backupDir, { recursive: true });
        import_node_fs3.default.copyFileSync(target, import_node_path7.default.join(backupDir, `${name}.${backupStamp(now())}${FILE_EXTENSION}`));
        pruneBackups(backupDir, name);
      }
      import_node_fs3.default.writeFileSync(temp, `${JSON.stringify(checked.value, null, 2)}
`, "utf8");
      import_node_fs3.default.renameSync(temp, target);
    } catch (error) {
      import_node_fs3.default.rmSync(temp, { force: true });
      return { ok: false, error: { kind: "write-failed", name, detail: describe2(error) } };
    }
    return checked;
  }
}
function backupStamp(timestamp) {
  return new Date(timestamp).toISOString().replace(/[-:]/g, "").replace(".", "");
}
function pruneBackups(backupDir, name) {
  const prefix = `${name}.`;
  const stampPattern = /^\d{8}T\d{9}Z\.json$/;
  const mine = import_node_fs3.default.readdirSync(backupDir).filter((file) => file.startsWith(prefix) && stampPattern.test(file.slice(prefix.length))).sort();
  for (const file of mine.slice(0, Math.max(0, mine.length - BACKUPS_PER_NAME))) {
    import_node_fs3.default.rmSync(import_node_path7.default.join(backupDir, file), { force: true });
  }
}
function describe2(error) {
  return error instanceof Error ? error.message : String(error);
}
function isErrorCode3(error, code) {
  return typeof error === "object" && error !== null && error.code === code;
}

// src/pad-manager.ts
var ACTIVE_FILE_NAME = ".active.json";
var ACTIVE_FORMAT = "oscdesk-pad-active";
function createPadActiveFile(options) {
  const file = import_node_path8.default.join(import_node_path8.default.resolve(options.dir), ACTIVE_FILE_NAME);
  const logWarn = options.logWarn ?? console.warn;
  return {
    load() {
      let raw;
      try {
        raw = options.fs.readFileSync(file, "utf8");
      } catch (error) {
        if (error?.code === "ENOENT") return void 0;
        logWarn("(WARN, BRIDGE)", `Failed to read pad selection file "${file}".`, error);
        return void 0;
      }
      try {
        const parsed = JSON.parse(raw.replace(/^﻿/, ""));
        if (parsed.format === ACTIVE_FORMAT && typeof parsed.active === "string" && isValidSurfaceName(parsed.active)) return parsed.active;
      } catch {
      }
      logWarn("(WARN, BRIDGE)", `Ignoring broken pad selection file "${file}".`);
      return void 0;
    },
    save(name) {
      const temp = `${file}.${String(process.pid)}.tmp`;
      try {
        options.fs.mkdirSync(import_node_path8.default.dirname(file), { recursive: true });
        options.fs.writeFileSync(temp, `${JSON.stringify({ format: ACTIVE_FORMAT, active: name })}
`, "utf8");
        options.fs.renameSync(temp, file);
      } catch (error) {
        options.fs.rmSync(temp, { force: true });
        logWarn("(WARN, BRIDGE)", `Failed to remember pad selection "${name}".`, error);
      }
    }
  };
}
function createPadManager(deps) {
  const now = deps.now ?? Date.now;
  const epoch = deps.epoch ?? (0, import_node_crypto.randomBytes)(6).toString("hex");
  const logInfo = deps.logInfo ?? console.info;
  const logWarn = deps.logWarn ?? console.warn;
  let active = null;
  let revision = 0;
  const listFrame = () => ({ v: 1, type: "osc.padList", names: deps.store.list(), active: active?.name ?? null });
  const padFrame = () => active === null ? null : {
    v: 1,
    type: "osc.pad",
    name: active.name,
    revision: active.revision,
    version: active.version,
    at: active.at,
    pad: active.pad
  };
  const reject = (clientId, code, detail) => {
    logWarn("(WARN, BRIDGE)", `Pad request rejected (${code}): ${detail}`);
    deps.publish({ v: 1, type: "notice", level: "error", code, detail }, clientId);
  };
  const adopt = (name, pad, persist) => {
    revision += 1;
    active = { name, revision, version: `${epoch}-${String(revision)}`, at: new Date(now()).toISOString(), pad };
    const frame = padFrame();
    if (frame !== null) deps.publish(frame);
    deps.publish(listFrame());
    if (persist) deps.activeStore.save(name);
    logInfo("(INFO, BRIDGE)", `Pad "${name}" adopted (revision ${String(revision)}).`);
  };
  return {
    active: () => active === null ? null : { name: active.name, pad: active.pad },
    importPad(name, pad) {
      const saved = deps.store.saveValidated(name, pad);
      if (!saved.ok) return { ok: false, detail: formatSurfaceStoreError(saved.error, "pad") };
      adopt(name, saved.value, true);
      return { ok: true };
    },
    start() {
      const name = deps.activeStore.load();
      if (name === void 0) return;
      const loaded = deps.store.read(name);
      if (!loaded.ok) {
        logWarn("(WARN, BRIDGE)", `Last pad not adopted: ${formatSurfaceStoreError(loaded.error, "pad")}`);
        return;
      }
      adopt(name, loaded.value, false);
    },
    handleUiFrame(frame, clientId) {
      switch (frame.type) {
        case "osc.padRequest": {
          deps.publish(listFrame(), clientId);
          const current = padFrame();
          if (current !== null) deps.publish(current, clientId);
          return true;
        }
        case "osc.padLoad": {
          const loaded = deps.store.read(frame.name);
          if (!loaded.ok) {
            reject(clientId, "pad-rejected", formatSurfaceStoreError(loaded.error, "pad"));
            return true;
          }
          adopt(frame.name, loaded.value, true);
          return true;
        }
        case "osc.padSave": {
          const saved = deps.store.save(frame.name, frame.pad);
          if (!saved.ok) {
            reject(clientId, "pad-rejected", formatSurfaceStoreError(saved.error, "pad"));
            return true;
          }
          adopt(frame.name, saved.value, true);
          return true;
        }
        case "osc.padPress": {
          if (active === null || active.name !== frame.name || active.version !== frame.version) {
            reject(clientId, "pad-press-rejected", `stale-pad: ${frame.name}@${frame.version}`);
            return true;
          }
          const button = active.pad.buttons.find((candidate) => candidate.id === frame.button);
          if (button === void 0) {
            reject(clientId, "pad-press-rejected", `unknown-button: ${frame.button}`);
            return true;
          }
          const result = deps.fire(button.address, button.args);
          if (!result.ok) reject(clientId, "pad-press-rejected", result.reason);
          return true;
        }
        default:
          return false;
      }
    }
  };
}

// src/project-manager.ts
function createProjectManager(deps) {
  const now = deps.now ?? Date.now;
  const logInfo = deps.logInfo ?? console.info;
  const logWarn = deps.logWarn ?? console.warn;
  const reject = (clientId, code, detail) => {
    logWarn("(WARN, BRIDGE)", `Project request rejected (${code}): ${detail}`);
    deps.publish({ v: 1, type: "notice", level: "error", code, detail }, clientId);
  };
  const tooLarge = (bytes) => `too-large: ${String(bytes)} bytes (limit ${String(PROJECT_FILE.MAX_SERIALIZED_BYTES)})`;
  const exportProject = (requestId, clientId) => {
    const surface = deps.surfaces.active();
    const pad = deps.pads.active();
    if (surface === null && pad === null) return reject(clientId, "project-export-rejected", "empty: no surface or pad is adopted");
    const project = {
      format: PROJECT_FILE_FORMAT,
      version: PROJECT_FILE_VERSION,
      exportedAt: new Date(now()).toISOString(),
      surface: surface === null ? null : { name: surface.name, definition: surface.definition, values: toHeldValues(deps.heldValues()) },
      pad: pad === null ? null : { name: pad.name, pad: pad.pad }
    };
    const bytes = projectSerializedBytes(project);
    if (bytes > PROJECT_FILE.MAX_SERIALIZED_BYTES) return reject(clientId, "project-export-rejected", tooLarge(bytes));
    const checked = ProjectFileSchema.safeParse(project);
    if (!checked.success) return reject(clientId, "project-export-rejected", `invalid: ${describeIssues(checked.error.issues)}`);
    deps.publish({ v: 1, type: "project", requestId, project }, clientId);
    logInfo("(INFO, BRIDGE)", `Project exported (surface ${surface === null ? "none" : `"${surface.name}"`}, pad ${pad === null ? "none" : `"${pad.name}"`}).`);
  };
  const importProject = (raw, clientId) => {
    const bytes = projectSerializedBytes(raw);
    if (bytes > PROJECT_FILE.MAX_SERIALIZED_BYTES) return reject(clientId, "project-import-rejected", tooLarge(bytes));
    const parsed = ProjectFileSchema.safeParse(raw);
    if (!parsed.success) return reject(clientId, "project-import-rejected", `invalid: ${describeIssues(parsed.error.issues)}`);
    const project = parsed.data;
    if (project.pad !== null) {
      const padBytes = oscPadSerializedBytes(project.pad.pad);
      if (padBytes > OSC_PAD.MAX_SERIALIZED_BYTES) {
        return reject(clientId, "project-import-rejected", `invalid: pad.pad: pad is ${String(padBytes)} bytes as JSON (limit ${String(OSC_PAD.MAX_SERIALIZED_BYTES)})`);
      }
    }
    if (project.surface !== null) {
      const result = deps.surfaces.importDefinition(project.surface.name, project.surface.definition, fromHeldValues(project.surface.values));
      if (!result.ok) return reject(clientId, "project-import-rejected", `surface: ${result.detail}`);
    }
    if (project.pad !== null) {
      const result = deps.pads.importPad(project.pad.name, project.pad.pad);
      if (!result.ok) {
        return reject(clientId, "project-import-rejected", `pad: ${result.detail}${project.surface === null ? "" : " (the surface and its values were imported)"}`);
      }
    }
    const parts = [
      project.surface === null ? null : `surface "${project.surface.name}"`,
      project.pad === null ? null : `pad "${project.pad.name}"`
    ].filter((part) => part !== null);
    logInfo("(INFO, BRIDGE)", `Project imported (${parts.join(", ")}).`);
    deps.publish({ v: 1, type: "notice", level: "info", code: "project-imported", detail: parts.join(", ") }, clientId);
  };
  return {
    handleUiFrame(frame, clientId) {
      if (frame.type === "projectExport") {
        exportProject(frame.requestId, clientId);
        return true;
      }
      if (frame.type === "projectImport") {
        importProject(frame.project, clientId);
        return true;
      }
      return false;
    }
  };
}
function describeIssues(issues) {
  return issues.slice(0, 5).map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`).join("; ");
}

// src/sent-log.ts
var COALESCED_ORIGINS = /* @__PURE__ */ new Set(["ui", "relay"]);
function createSentLog(options) {
  const now = options.now ?? Date.now;
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  const capacity = options.capacity ?? SENT_LOG.CAPACITY;
  const entries = [];
  const pending = /* @__PURE__ */ new Set();
  let nextSeq = 1;
  let nextBatchId = 1;
  let timer = null;
  let closed = false;
  const push = (entry) => {
    entries.push(entry);
    if (entries.length > capacity) {
      const evicted = entries.splice(0, entries.length - capacity);
      for (const old of evicted) pending.delete(old.record.seq);
    }
    pending.add(entry.record.seq);
  };
  const flush = () => {
    timer = null;
    if (pending.size === 0) return;
    const records = entries.filter((entry) => pending.has(entry.record.seq)).map((entry) => entry.record);
    pending.clear();
    for (const chunk of chunks(records)) options.publish({ v: 1, type: "osc.sentLog", full: false, records: chunk });
  };
  const scheduleFlush = () => {
    if (timer !== null || closed) return;
    timer = setTimeoutFn(flush, SENT_LOG.FLUSH_INTERVAL_MS);
  };
  return {
    record(event) {
      if (closed || event.targets.length === 0 || event.messages.length === 0) return;
      const timestamp = now();
      const at = new Date(timestamp).toISOString();
      const targets = [...event.targets];
      const batchId = event.batch === true ? nextBatchId++ : null;
      event.messages.forEach((message, index) => {
        const { args, clipped } = clipArgs(message.args);
        const identity = `${event.origin}
${targets.join("\n")}
${message.address}
${keyOf(message.args)}`;
        const last = entries.at(-1);
        if (batchId === null && COALESCED_ORIGINS.has(event.origin) && last !== void 0 && last.identity === identity && last.record.batch === null && timestamp - last.firstAtMs < SENT_LOG.COALESCE_WINDOW_MS) {
          last.record = { ...last.record, at, args, clipped, count: last.record.count + 1 };
          pending.add(last.record.seq);
          return;
        }
        push({
          firstAtMs: timestamp,
          identity,
          record: {
            seq: nextSeq++,
            at,
            origin: event.origin,
            targets,
            address: message.address,
            args,
            count: 1,
            batch: batchId === null ? null : { id: batchId, index, size: event.messages.length },
            clipped
          }
        });
      });
      scheduleFlush();
    },
    publishBacklog(clientId) {
      const records = entries.map((entry) => entry.record);
      const frames = chunks(records);
      if (frames.length === 0) frames.push([]);
      frames.forEach((chunk, index) => options.publish({ v: 1, type: "osc.sentLog", full: index === 0, records: chunk }, clientId));
    },
    snapshot() {
      return entries.map((entry) => entry.record);
    },
    close() {
      closed = true;
      if (timer !== null) clearTimeoutFn(timer);
      timer = null;
      pending.clear();
    }
  };
}
function chunks(records) {
  const result = [];
  for (let index = 0; index < records.length; index += SENT_LOG.MAX_RECORDS_PER_FRAME) {
    result.push(records.slice(index, index + SENT_LOG.MAX_RECORDS_PER_FRAME));
  }
  return result;
}
function keyOf(args) {
  const head = args[0];
  return head?.type === "s" ? head.value : "";
}
function clipArgs(args) {
  let clipped = args.length > SENT_LOG.MAX_ARGS;
  const result = args.slice(0, SENT_LOG.MAX_ARGS).map((arg) => {
    if (arg.type === "s") {
      if (arg.value.length <= SENT_LOG.MAX_STRING_CHARS) return arg;
      clipped = true;
      return { type: "s", value: arg.value.slice(0, SENT_LOG.MAX_STRING_CHARS) };
    }
    if (arg.type === "b") {
      const bytes = arg.value.length > SENT_LOG.MAX_BLOB_BYTES ? arg.value.subarray(0, SENT_LOG.MAX_BLOB_BYTES) : arg.value;
      if (bytes !== arg.value) clipped = true;
      return { type: "b", value: Buffer.from(bytes).toString("base64") };
    }
    if (!Number.isFinite(arg.value)) {
      clipped = true;
      return { type: "s", value: String(arg.value) };
    }
    return arg;
  });
  return { args: result, clipped };
}

// src/surface-core.ts
var import_node_crypto3 = require("node:crypto");

// src/desired-values.ts
function createDesiredValues(rowName = () => void 0) {
  const tracked = /* @__PURE__ */ new Map();
  const records = /* @__PURE__ */ new Map();
  const rowValue = (record, key, fields) => {
    if (!recordHasRowIds(record)) return { address: record.address, args: [{ type: "s", value: key }, ...fields] };
    const name = rowName(record, key);
    return name === void 0 ? void 0 : { address: record.address, args: [{ type: "s", value: key }, { type: "s", value: name }, ...fields] };
  };
  return {
    setDefinition(definition) {
      const previous = new Map(tracked);
      const previousRecords = new Map(records);
      const reset = [];
      tracked.clear();
      records.clear();
      for (const param of definition?.parameters ?? []) {
        if (param.kind !== "state" || param.standalone === false) continue;
        const before = previous.get(param.address);
        const carried = before?.args != null && carries(param, before.param.id, before.param.type, before.args) ? before.args : null;
        if (carried === null) reset.push(param.address);
        tracked.set(param.address, { param, args: carried ?? defaultArgs(param) });
      }
      for (const record of definition?.records ?? []) {
        if (record.kind !== "state") continue;
        const entry = { record, rows: /* @__PURE__ */ new Map() };
        records.set(record.address, entry);
        const before = previousRecords.get(record.address);
        if (before === void 0 || before.record.id !== record.id) continue;
        for (const [key, fields] of before.rows) {
          const next = carryFields(record, persistedFields(before.record, fields));
          if (!sameExactArgs(next, fields)) reset.push(rowId(record.address, key));
          entry.rows.set(key, next);
        }
      }
      return reset;
    },
    record(address, args) {
      const entry = tracked.get(address);
      if (entry !== void 0) {
        if (!acceptsArgs(entry.param, args)) return false;
        entry.args = args;
        return true;
      }
      const recordEntry = records.get(address);
      if (recordEntry === void 0) return false;
      const key = keyOf2(recordEntry.record, args);
      if (key === void 0) return false;
      recordEntry.rows.set(key, args.slice(recordHeadLength(recordEntry.record)));
      return true;
    },
    differsFromEcho(address, args) {
      const entry = tracked.get(address);
      if (entry !== void 0) return entry.args !== null && !sameArgs(entry.args, args);
      const recordEntry = records.get(address);
      const head = args[0];
      if (recordEntry === void 0 || head?.type !== "s") return false;
      const row = recordEntry.rows.get(head.value);
      return row !== void 0 && !sameArgs(row, args.slice(recordHeadLength(recordEntry.record)));
    },
    entryId(address, args) {
      const head = args[0];
      return records.has(address) && head?.type === "s" ? rowId(address, head.value) : address;
    },
    snapshot() {
      const values = [];
      for (const [address, entry] of tracked) {
        if (entry.args !== null) values.push({ address, args: entry.args });
      }
      for (const entry of records.values()) {
        for (const [key, fields] of entry.rows) {
          const value = rowValue(entry.record, key, fields);
          if (value !== void 0) values.push(value);
        }
      }
      return values;
    },
    persistable() {
      const values = [];
      for (const [address, entry] of tracked) {
        if (entry.args !== null) values.push({ id: entry.param.id, address, type: entry.param.type, args: entry.args });
      }
      const rows = [];
      for (const [address, entry] of records) {
        for (const [key, fields] of entry.rows) {
          rows.push({ id: entry.record.id, address, key, fields: persistedFields(entry.record, fields) });
        }
      }
      return { values, records: rows };
    },
    restore(saved) {
      const restored = [];
      for (const value of saved.values) {
        const entry = tracked.get(value.address);
        if (entry === void 0 || !carries(entry.param, value.id, value.type, value.args)) continue;
        entry.args = value.args;
        restored.push(value.address);
      }
      for (const row of saved.records) {
        const entry = records.get(row.address);
        if (entry === void 0 || entry.record.id !== row.id || row.key === "") continue;
        entry.rows.set(row.key, carryFields(entry.record, row.fields));
        restored.push(rowId(row.address, row.key));
      }
      return restored;
    },
    addKeys(lists) {
      const created = [];
      for (const list of lists) {
        const entry = [...records.values()].find((candidate) => candidate.record.id === list.record);
        if (entry === void 0) continue;
        for (const key of list.keys) {
          if (key === "" || entry.rows.has(key)) continue;
          const fields = initialFields(entry.record);
          entry.rows.set(key, fields);
          const value = rowValue(entry.record, key, fields);
          if (value !== void 0) created.push(value);
        }
      }
      return created;
    },
    removeKey(keysAddress, key) {
      let removed = false;
      for (const entry of records.values()) {
        if (entry.record.keysFrom.address === keysAddress && entry.rows.delete(key)) removed = true;
      }
      return removed;
    },
    retainKeys(keysAddress, keys) {
      const keep = new Set(keys);
      let removed = false;
      for (const entry of records.values()) {
        if (entry.record.keysFrom.address !== keysAddress) continue;
        for (const key of [...entry.rows.keys()]) {
          if (!keep.has(key)) {
            entry.rows.delete(key);
            removed = true;
          }
        }
      }
      return removed;
    },
    rowsOf(keysAddress, key) {
      const values = [];
      for (const entry of records.values()) {
        if (entry.record.keysFrom.address !== keysAddress) continue;
        const fields = entry.rows.get(key);
        const value = fields === void 0 ? void 0 : rowValue(entry.record, key, fields);
        if (value !== void 0) values.push(value);
      }
      return values;
    }
  };
}
function migrateLegacyRowKeys(saved, definition, newRowId) {
  const lists = saved.keyLists ?? [];
  if (lists.every((list) => list.rows.every((row) => row.id !== void 0))) return saved;
  const assigned = /* @__PURE__ */ new Map();
  const keyLists = lists.map((list) => {
    if (list.rows.every((row) => row.id !== void 0)) return list;
    const ids = /* @__PURE__ */ new Map();
    assigned.set(list.address, ids);
    return {
      address: list.address,
      rows: list.rows.map((row) => {
        if (row.id !== void 0) return row;
        const id = ids.get(row.name) ?? newRowId();
        ids.set(row.name, id);
        return { id, name: row.name };
      })
    };
  });
  const keysAddressOf = /* @__PURE__ */ new Map();
  for (const record of definition.records ?? []) {
    if (recordHasRowIds(record)) keysAddressOf.set(`${record.id}\0${record.address}`, record.keysFrom.address);
  }
  const records = saved.records.map((row) => {
    const keysAddress = keysAddressOf.get(`${row.id}\0${row.address}`);
    const id = keysAddress === void 0 ? void 0 : assigned.get(keysAddress)?.get(row.key);
    return id === void 0 ? row : { ...row, key: id };
  });
  return { ...saved, records, keyLists };
}
function rowId(address, key) {
  return `${address}\0${key}`;
}
function carries(param, id, type, args) {
  return param.id === id && param.type === type && acceptsArgs(param, args);
}
function carryFields(record, previous) {
  const defaults = initialFields(record);
  return record.fields.map((field, index) => {
    const before = previous.find((candidate) => candidate.id === field.id);
    return before !== void 0 && before.type === field.type && acceptsArgs(field, [before.arg]) ? before.arg : defaults[index];
  });
}
function persistedFields(record, fields) {
  return record.fields.flatMap((field, index) => {
    const arg = fields[index];
    return arg === void 0 ? [] : [{ id: field.id, type: field.type, arg }];
  });
}
function initialFields(record) {
  return recordFieldArgs(record, recordInitialValues(record)).map(toOscArg);
}
function keyOf2(record, args) {
  if (args.some((arg) => arg.type === "b")) return void 0;
  const key = recordKeyOf(record, args);
  return key === "" ? void 0 : key;
}
function toOscArg(arg) {
  if (arg.type === "b") throw new Error("record fields never carry blobs");
  return arg;
}
function acceptsArgs(spec, args) {
  if (args.length !== 1) return false;
  const arg = args[0];
  if (spec.type === "s") {
    return arg.type === "s" && (spec.options === void 0 || spec.optionsFrom !== void 0 || spec.options.includes(arg.value));
  }
  if (arg.type !== "i" && arg.type !== "f" || !Number.isFinite(arg.value)) return false;
  if (spec.type === "bool") return arg.value === 0 || arg.value === 1;
  return spec.range === void 0 || arg.value >= spec.range[0] && arg.value <= spec.range[1];
}
function defaultArgs(param) {
  if (param.default === void 0) return null;
  switch (param.type) {
    case "i":
      return [{ type: "i", value: param.default }];
    case "f":
      return [{ type: "f", value: param.default }];
    case "s":
      return [{ type: "s", value: param.default }];
    case "bool":
      return [{ type: "i", value: param.default ? 1 : 0 }];
  }
}
function sameArgs(a, b) {
  if (a.length !== b.length) return false;
  return a.every((left, index) => {
    const right = b[index];
    if (left.type === "s" || right.type === "s") return left.type === right.type && left.value === right.value;
    if (left.type === "b" || right.type === "b") return false;
    return Math.abs(left.value - right.value) <= 1e-4 * Math.max(1, Math.abs(left.value));
  });
}
function sameExactArgs(a, b) {
  return a.length === b.length && a.every((left, index) => {
    const right = b[index];
    return left.type === right.type && left.value === right.value;
  });
}

// src/ping-monitor.ts
var PingMonitor = class {
  nextSeq = 1;
  pending = null;
  lastRttMs = null;
  consecutiveLosses = 0;
  lastPongSeq = null;
  /** 返事待ちの ping の seq。複数宛先で seq を共有空間にし、pong の出所を特定するのに使う。 */
  pendingSeq() {
    return this.pending?.seq ?? null;
  }
  /** seq を渡すと採番を外部に委ねる(複数宛先で一意な seq を振るため。省略時は内部採番)。 */
  nextPing(nowMs, assignedSeq) {
    if (this.pending !== null) {
      this.consecutiveLosses += 1;
    }
    const seq = assignedSeq ?? this.nextSeq;
    this.nextSeq = Math.max(this.nextSeq, seq + 1);
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
  /**
   * Unity(主系)を差し替える(宛先タブ。D-078)。主系がブロードキャストの宛先(D-079)のときは、
   * pong を返したホストを unityHosts に渡す(ブロードキャストアドレスからエコーは届かないため)。
   */
  setUnity(unity, unityHosts) {
    this.#unity = unity;
    this.#unityHosts = /* @__PURE__ */ new Set([unity.host, ...unityHosts]);
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

// src/runtime-options.ts
var import_node_crypto2 = require("node:crypto");
var sourceKey = (target, host) => host === void 0 ? target : `${target}\0${host}`;
function createRuntimeOptions(targetNames, newRowId = import_node_crypto2.randomUUID) {
  let lists = /* @__PURE__ */ new Map();
  let requests = [];
  let requestSet = /* @__PURE__ */ new Set();
  let choices = [];
  let fieldChoices = [];
  let keySources = [];
  let uiKeys = /* @__PURE__ */ new Map();
  const unionOf = (address, head) => {
    const seen = /* @__PURE__ */ new Set();
    const result = [];
    const add = (names) => {
      for (const name of names) {
        if (seen.has(name)) continue;
        seen.add(name);
        result.push(name);
      }
    };
    add(head);
    const applied = lists.get(address)?.applied;
    for (const name of targetNames) {
      for (const source of sourcesOf(applied, name)) add(source.names);
    }
    return result;
  };
  const sourcesOf = (bySource, target) => [...bySource?.values() ?? []].filter((source) => source.target === target);
  const targetOptions = (sources) => sources.length === 1 ? [...sources[0].names] : [...new Set(sources.flatMap((source) => source.names))];
  const pending = () => [...lists].flatMap(([address, state]) => targetNames.flatMap((name) => sourcesOf(state.received, name).flatMap((source) => {
    const applied = state.applied.get(sourceKey(source.target, source.host))?.names ?? [];
    if (sameNames(applied, source.names)) return [];
    const before = new Set(applied);
    const after = new Set(source.names);
    return [{
      address,
      target: source.target,
      ...source.host === void 0 ? {} : { host: source.host },
      added: [...after].filter((item) => !before.has(item)),
      removed: [...before].filter((item) => !after.has(item))
    }];
  })));
  const recordKeys = () => keySources.map((source) => {
    const ui = uiKeys.get(source.address);
    if (ui !== void 0) {
      return { record: source.record, keys: ui.rows.map((row) => row.id), names: ui.rows.map((row) => row.name) };
    }
    return { record: source.record, keys: unionOf(source.address, []).filter((key) => key !== "") };
  });
  return {
    setDefinition(definition) {
      const previousAddresses = new Set(lists.keys());
      const previousRequests = new Set(requests);
      const nextLists = /* @__PURE__ */ new Map();
      const nextChoices = [];
      const nextFieldChoices = [];
      const nextKeySources = [];
      const nextUiKeys = /* @__PURE__ */ new Map();
      const nextRequests = [];
      const added = [];
      const addSource = (source) => {
        const { address, request } = source;
        if (!nextLists.has(address)) nextLists.set(address, lists.get(address) ?? { received: /* @__PURE__ */ new Map(), applied: /* @__PURE__ */ new Map() });
        if (request === void 0) return;
        if (!nextRequests.includes(request)) nextRequests.push(request);
        if ((!previousAddresses.has(address) || !previousRequests.has(request)) && !added.includes(request)) {
          added.push(request);
        }
      };
      for (const param of definition?.parameters ?? []) {
        if (param.type !== "s" || param.optionsFrom === void 0) continue;
        nextChoices.push({ param: param.id, address: param.optionsFrom.address, options: param.options ?? [] });
        addSource(param.optionsFrom);
      }
      for (const record of definition?.records ?? []) {
        nextKeySources.push({ record: record.id, address: record.keysFrom.address });
        if (record.keysFrom.source === "ui") {
          const { address, max } = record.keysFrom;
          if (!nextUiKeys.has(address)) {
            const rows = [...uiKeys.get(address)?.rows ?? []];
            nextUiKeys.set(address, { max, rows: max === void 0 ? rows : rows.slice(0, max) });
          }
        } else {
          addSource(record.keysFrom);
        }
        for (const field of record.fields) {
          if (field.type !== "s" || field.optionsFrom === void 0) continue;
          nextFieldChoices.push({ record: record.id, field: field.id, address: field.optionsFrom.address, options: field.options ?? [] });
          addSource(field.optionsFrom);
        }
      }
      lists = nextLists;
      choices = nextChoices;
      fieldChoices = nextFieldChoices;
      keySources = nextKeySources;
      uiKeys = nextUiKeys;
      requests = nextRequests;
      requestSet = new Set(nextRequests);
      return added;
    },
    // UI で管理するキーのアドレスも一覧扱いにする。ブリッジが Unity へ送った一覧のエコーを、値の osc として UI へ流さないため
    isListAddress: (address) => lists.has(address) || uiKeys.has(address),
    isRequestAddress: (address) => requestSet.has(address),
    receive(target, address, args, host) {
      if (uiKeys.has(address)) return "unchanged";
      const state = lists.get(address);
      if (state === void 0) return "unchanged";
      if (!args.every((arg) => arg.type === "s")) return "invalid";
      const names = args.map((arg) => arg.value);
      const key = sourceKey(target, host);
      const before = state.received.get(key);
      if (before !== void 0 && sameNames(before.names, names)) return "unchanged";
      const entry = { target, host, names };
      state.received.set(key, entry);
      if (sourcesOf(state.applied, target).length === 0) {
        state.applied.set(key, entry);
        return "changed";
      }
      return "held";
    },
    apply(address) {
      if (address !== void 0 && !lists.has(address)) return "unknown";
      let changed = false;
      for (const [listAddress, state] of lists) {
        if (address !== void 0 && listAddress !== address) continue;
        for (const [key, entry] of state.received) {
          const applied = state.applied.get(key);
          if (applied !== void 0 && sameNames(applied.names, entry.names)) continue;
          state.applied.set(key, entry);
          changed = true;
        }
      }
      return changed ? "applied" : "unchanged";
    },
    requestAddresses: () => [...requests],
    recordKeys,
    frame() {
      return {
        v: 1,
        type: "runtimeOptions",
        lists: [...lists].map(([address, state]) => ({
          address,
          targets: targetNames.flatMap((name) => {
            const sources = sourcesOf(state.applied, name);
            return sources.length === 0 ? [] : [{ name, options: targetOptions(sources) }];
          })
        })),
        choices: choices.map((choice) => ({ param: choice.param, options: unionOf(choice.address, choice.options) })),
        // レコードの欄は UI が無い場合に備えて省略可能だが、ブリッジは常に載せる(D-062)
        keys: recordKeys(),
        fieldChoices: fieldChoices.map((choice) => ({
          record: choice.record,
          field: choice.field,
          options: unionOf(choice.address, choice.options)
        })),
        pending: pending()
      };
    },
    uiKeyLists: () => [...uiKeys].map(([address, list]) => ({ address, rows: list.rows.map((row) => ({ ...row })) })),
    addUiKey(address, name) {
      const list = uiKeys.get(address);
      if (list === void 0) return { result: "unknown" };
      if (list.rows.some((row) => row.name === name)) return { result: "exists" };
      if (list.max !== void 0 && list.rows.length >= list.max) return { result: "full" };
      let id = newRowId();
      while (list.rows.some((row) => row.id === id)) id = newRowId();
      list.rows.push({ id, name });
      return { result: "added", id };
    },
    removeUiKey(address, id) {
      const list = uiKeys.get(address);
      const index = list?.rows.findIndex((row) => row.id === id) ?? -1;
      if (list === void 0 || index < 0) return false;
      list.rows.splice(index, 1);
      return true;
    },
    renameUiKey(address, id, name) {
      const list = uiKeys.get(address);
      if (list === void 0) return "unknown";
      const row = list.rows.find((candidate) => candidate.id === id);
      if (row === void 0) return "not-found";
      if (row.name === name) return "unchanged";
      if (list.rows.some((candidate) => candidate.name === name)) return "exists";
      row.name = name;
      return "renamed";
    },
    uiRowName: (address, id) => uiKeys.get(address)?.rows.find((row) => row.id === id)?.name,
    restoreUiKeys(saved) {
      for (const { address, rows } of saved) {
        const list = uiKeys.get(address);
        if (list === void 0) continue;
        const ids = /* @__PURE__ */ new Set();
        const names = /* @__PURE__ */ new Set();
        const unique = [];
        for (const row of rows) {
          if (row.id === "" || row.name === "" || ids.has(row.id) || names.has(row.name)) continue;
          ids.add(row.id);
          names.add(row.name);
          unique.push({ id: row.id, name: row.name });
        }
        list.rows = list.max === void 0 ? unique : unique.slice(0, list.max);
      }
    },
    forgetTarget(target) {
      for (const state of lists.values()) {
        for (const bySource of [state.received, state.applied]) {
          for (const [key, source] of bySource) if (source.target === target) bySource.delete(key);
        }
      }
    }
  };
}
function sameNames(a, b) {
  return a.length === b.length && a.every((name, index) => name === b[index]);
}

// src/spawn-record.ts
function spawnCommandOf(parameter) {
  if (parameter.kind !== "trigger" || parameter.type !== "s") return null;
  if (spawnerPackage(parameter.address) === null) return null;
  if (parameter.address.endsWith("/spawn")) return "spawn";
  if (parameter.address.endsWith("/destroy")) return "destroy";
  return null;
}
function spawnerPackage(address) {
  const segments = address.split("/");
  if (segments.length !== 4 || segments[0] !== "" || segments.slice(1).some((segment) => segment === "")) return null;
  return segments[1];
}
function spawnerOf(address) {
  return address.slice(0, address.lastIndexOf("/"));
}
function spawnedPrefix(packageName, name) {
  return `/${packageName}/${name}/`;
}
function spawnedNameOf(itemAddress) {
  const segments = itemAddress.split("/");
  if (segments.length < 4 || segments[0] !== "" || segments[1] === "" || segments[2] === "") return null;
  return { packageName: segments[1], name: segments[2] };
}
var NUMBERED = /^(.*?)(\d+)$/u;
function spawnBase(name) {
  const matched = NUMBERED.exec(name);
  return matched === null || matched[1] === "" ? name : matched[1];
}
var DEFAULT_RESERVE_MS = 1e4;
var MAX_RESERVED = SPAWN_RECORD.MAX_ENTRIES;
function createSpawnRecord(deps = {}) {
  const now = deps.now ?? Date.now;
  const reserveMs = deps.reserveMs ?? DEFAULT_RESERVE_MS;
  let list = [];
  const reserved = /* @__PURE__ */ new Map();
  const nameKey = (packageName, name) => `${packageName}\0${name}`;
  const expectedRemoves = /* @__PURE__ */ new Map();
  const removeKey = (host, packageName, name) => `${host}\0${packageName}\0${name}`;
  const purge = (map) => {
    const at = now();
    for (const [key, until] of map) if (until <= at) map.delete(key);
    while (map.size > MAX_RESERVED) map.delete(map.keys().next().value);
  };
  const packageOfEntry = (entry) => spawnerPackage(entry.address);
  const sameThing = (entry, packageName, name) => entry.name === name && packageOfEntry(entry) === packageName;
  const reserve = (packageName, name) => {
    const at = now();
    for (const [key2, until] of reserved) if (until <= at) reserved.delete(key2);
    const key = nameKey(packageName, name);
    reserved.delete(key);
    reserved.set(key, at + reserveMs);
    while (reserved.size > MAX_RESERVED) reserved.delete(reserved.keys().next().value);
  };
  const isReserved = (packageName, name) => {
    const until = reserved.get(nameKey(packageName, name));
    if (until === void 0) return false;
    if (until > now()) return true;
    reserved.delete(nameKey(packageName, name));
    return false;
  };
  return {
    entries: () => list.map((entry) => ({ ...entry })),
    forHost: (host) => list.filter((entry) => entry.host === host).map((entry) => ({ ...entry })),
    allocate(spawnAddress, value, usedInBlueprints) {
      const packageName = spawnerPackage(spawnAddress) ?? "";
      const used = (name2) => usedInBlueprints(packageName, name2) || list.some((entry) => sameThing(entry, packageName, name2)) || isReserved(packageName, name2);
      let name = value;
      if (!NUMBERED.test(value)) {
        let index = 1;
        while (used(`${value}${String(index)}`)) index += 1;
        name = `${value}${String(index)}`;
      }
      if (!isValidSpawnName(name)) return null;
      reserve(packageName, name);
      return name;
    },
    canRecord(spawnAddress, name, hosts) {
      const adding = [...new Set(hosts)].filter((host) => !list.some((entry) => entry.host === host && entry.address === spawnAddress && entry.name === name)).length;
      return list.length + adding <= SPAWN_RECORD.MAX_ENTRIES;
    },
    recordSpawn(param, spawnAddress, name, hosts) {
      for (const host of new Set(hosts)) {
        const held = list.find((entry) => entry.host === host && entry.address === spawnAddress && entry.name === name);
        if (held !== void 0) {
          delete held.removedElsewhere;
          continue;
        }
        if (list.length >= SPAWN_RECORD.MAX_ENTRIES) break;
        list.push({ param, address: spawnAddress, name, host });
      }
    },
    recordDestroy(destroyAddress, name, hosts) {
      const spawner = spawnerOf(destroyAddress);
      const packageName = spawnerPackage(destroyAddress);
      if (packageName !== null) {
        reserve(packageName, name);
        for (const host of new Set(hosts)) expectedRemoves.set(removeKey(host, packageName, name), now() + reserveMs);
        purge(expectedRemoves);
      }
      const targets = new Set(hosts);
      const before = list.length;
      list = list.filter((entry) => !(targets.has(entry.host) && entry.name === name && spawnerOf(entry.address) === spawner));
      return list.length !== before;
    },
    catalogRemoved(host, itemAddress, isDown) {
      const spawned = spawnedNameOf(itemAddress);
      if (spawned === null) return false;
      const matching = (entry) => sameThing(entry, spawned.packageName, spawned.name);
      const expected = removeKey(host, spawned.packageName, spawned.name);
      const until = expectedRemoves.get(expected);
      if (until !== void 0 && until > now()) return false;
      expectedRemoves.delete(expected);
      const before = list.length;
      list = list.filter((entry) => !(entry.host === host && matching(entry)));
      let changed = list.length !== before;
      for (const entry of list) {
        if (entry.host !== host && matching(entry) && entry.removedElsewhere !== true && isDown(entry.host)) {
          entry.removedElsewhere = true;
          changed = true;
        }
      }
      return changed;
    },
    catalogSeen(host, itemAddress) {
      const spawned = spawnedNameOf(itemAddress);
      if (spawned === null) return false;
      let changed = false;
      for (const entry of list) {
        if (entry.host === host && entry.removedElsewhere === true && sameThing(entry, spawned.packageName, spawned.name)) {
          delete entry.removedElsewhere;
          changed = true;
        }
      }
      return changed;
    },
    takeRestore(host) {
      const restore = [];
      const dropped = [];
      list = list.filter((entry) => {
        if (entry.host !== host) return true;
        if (entry.removedElsewhere === true) {
          dropped.push({ ...entry });
          return false;
        }
        restore.push({ ...entry });
        return true;
      });
      return { restore, dropped };
    },
    reconcile(host, items, spawners) {
      const present = /* @__PURE__ */ new Set();
      for (const address of items ?? []) {
        const spawned = spawnedNameOf(address);
        if (spawned !== null) present.add(nameKey(spawned.packageName, spawned.name));
      }
      const isPresent = (entry) => items !== null && present.has(nameKey(packageOfEntry(entry) ?? "", entry.name));
      const dropped = [];
      list = list.filter((entry) => {
        if (entry.host !== host || entry.removedElsewhere !== true) return true;
        if (isPresent(entry)) {
          delete entry.removedElsewhere;
          return true;
        }
        dropped.push({ ...entry });
        return false;
      });
      const mine = list.filter((entry) => entry.host === host);
      const missing = mine.filter((entry) => !isPresent(entry)).map((entry) => ({ ...entry }));
      const extras = [];
      const seen = /* @__PURE__ */ new Set();
      for (const key of present) {
        const [packageName, name] = key.split("\0");
        if (!NUMBERED.test(name) || seen.has(key)) continue;
        if (mine.some((entry) => sameThing(entry, packageName, name))) continue;
        const recorded = new Set(list.filter((entry) => sameThing(entry, packageName, name)).map((entry) => entry.address));
        const candidates = recorded.size > 0 ? [...recorded] : [...new Set(spawners.filter((candidate) => spawnerPackage(candidate.address) === packageName && candidate.bases.includes(spawnBase(name))).map((candidate) => candidate.address))];
        if (candidates.length !== 1) continue;
        seen.add(key);
        extras.push({ destroyAddress: `${spawnerOf(candidates[0])}/destroy`, name });
      }
      return { missing, extras, dropped };
    },
    retainHosts(keep) {
      const before = list.length;
      list = list.filter((entry) => keep(entry.host));
      return list.length !== before;
    },
    replace(entries) {
      list = entries.filter((entry) => isValidSpawnName(entry.name) && isSpawnAddress(entry.address)).slice(0, SPAWN_RECORD.MAX_ENTRIES).map((entry) => ({
        param: entry.param,
        address: entry.address,
        name: entry.name,
        host: entry.host,
        ...entry.removedElsewhere === true ? { removedElsewhere: true } : {}
      }));
      reserved.clear();
    }
  };
}

// src/surface-core.ts
var PING_INTERVAL_MS = 2e3;
var SPAWNS_PER_STEP = 8;
var SPAWN_STEP_MS = 100;
var ECHO_SETTLE_MS = 1e3;
function createSurfaceCore(deps) {
  const now = deps.now ?? Date.now;
  const setIntervalFn = deps.setIntervalFn ?? setInterval;
  const clearIntervalFn = deps.clearIntervalFn ?? clearInterval;
  const setTimeoutFn = deps.setTimeoutFn ?? setTimeout;
  const logInfo = deps.logInfo ?? console.info;
  const logWarn = deps.logWarn ?? console.warn;
  const logError = deps.logError ?? console.error;
  const newRuntimeTarget = (spec) => ({
    name: spec.name,
    host: spec.host,
    sendPort: spec.sendPort,
    primary: spec.primary,
    monitor: new PingMonitor(),
    addresses: /* @__PURE__ */ new Set([spec.host, ...spec.addresses ?? []]),
    hasBeenReachable: false,
    broadcast: spec.broadcast ?? null,
    responders: /* @__PURE__ */ new Map(),
    pingRound: 0,
    lastPingSeq: null
  });
  let targets = resolveUnityTargets(deps.config.unity).map((target) => newRuntimeTarget({
    ...target,
    addresses: (target.primary ? deps.unityAddresses : deps.secondaryAddresses?.[target.name]) ?? []
  }));
  const primaryTarget = () => targets[0];
  let pingSeq = 1;
  const uiRouter = deps.config.oscUi.enabled ? new OscUiRouter({
    unity: { host: deps.config.unity.host, port: deps.config.unity.sendPort },
    unityAddresses: deps.unityAddresses,
    config: deps.config.oscUi
  }) : null;
  const newRowId = deps.newRowId ?? import_node_crypto3.randomUUID;
  const desired = createDesiredValues((record, key) => runtimeOptions.uiRowName(record.keysFrom.address, key));
  const targetNames = targets.map((target) => target.name);
  const runtimeOptions = createRuntimeOptions(targetNames, newRowId);
  const spawns = createSpawnRecord({ now });
  let timer = null;
  let stopped = false;
  let hasDefinition = false;
  let activeName;
  let definedRecords = [];
  let definedParameters = /* @__PURE__ */ new Map();
  let parameterIdsByAddress = /* @__PURE__ */ new Map();
  let recordIdsByAddress = /* @__PURE__ */ new Map();
  const lockRefsOf = (address, args) => {
    const param = parameterIdsByAddress.get(address);
    if (param !== void 0) return [{ param }];
    const record = recordIdsByAddress.get(address);
    const key = args[0];
    if (record !== void 0 && key?.type === "s" && key.value !== "") return [{ record, key: key.value }];
    return [];
  };
  const describeLockRef = (ref) => "param" in ref ? ref.param : `${ref.record}[${ref.key}]`;
  const lockRejection = (refs, clientId, holder) => {
    if (deps.lockedBy === void 0 || refs.length === 0) return null;
    for (const ref of refs) {
      const owner = deps.lockedBy([ref], clientId, holder);
      if (owner !== null) return `locked: ${describeLockRef(ref)} by ${owner}`;
    }
    return null;
  };
  let lastLinkPublishedAt = -Infinity;
  let unsentSince = null;
  const warnedInternalAddresses = /* @__PURE__ */ new Set();
  const warnedNonUnitySources = /* @__PURE__ */ new Set();
  const warnedEchoMismatch = /* @__PURE__ */ new Set();
  const warnedRuntimeOptions = /* @__PURE__ */ new Set();
  const warnRuntimeOptionsOnce = (key, message) => {
    if (warnedRuntimeOptions.has(key)) return;
    warnedRuntimeOptions.add(key);
    logWarn("(WARN, BRIDGE)", message);
  };
  const isTargetHost = (target, host) => target.addresses.has(host) || target.responders.has(host);
  const isUnityHost = (host) => targets.some((target) => isTargetHost(target, host));
  const inBroadcastNetwork = (target, host) => target.broadcast !== null && (isInNetwork(host, target.broadcast) || isInNetwork(host, LOOPBACK_NETWORK) || target.addresses.has(host));
  const sourceTarget = (from) => {
    const candidates = targets.filter((target) => isTargetHost(target, from.host));
    if (candidates.length === 0) return null;
    return candidates.find((target) => target.sendPort === from.port) ?? candidates.find((target) => target.primary) ?? candidates[0];
  };
  let diagnostics = null;
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
  const desiredFrame = (full, values = desired.snapshot()) => ({
    v: 1,
    type: "desired",
    full,
    values: values.map((value) => ({ address: value.address, args: toWireArgs(value.args) }))
  });
  const publishDesiredFull = (target) => {
    if (!hasDefinition) return;
    deps.publish(desiredFrame(true), target);
  };
  const resendDesired = (reason, only, to = targets) => {
    sendUiKeyLists("resend", to);
    const values = desired.snapshot().filter((value) => only === void 0 || only.has(desired.entryId(value.address, value.args)));
    if (values.length === 0) return;
    for (const target of to) {
      logInfo("(INFO, BRIDGE)", `Resending ${String(values.length)} desired value(s) to Unity "${target.name}" (${reason}).`);
      for (const value of values) sendLogged("resend", [target], value.address, ...value.args);
    }
  };
  const autoResendDesired = (reason, only, to = targets) => {
    if (to.length === 0) return;
    if (unsentSince !== null) {
      logInfo("(INFO, BRIDGE)", `Not resending desired values to Unity ${to.map((target) => `"${target.name}"`).join(", ")} (${reason}): the imported project has not been sent yet.`);
      return;
    }
    resendDesired(reason, only, to);
  };
  const desiredStatusFrame = () => ({ v: 1, type: "desiredStatus", unsent: unsentSince !== null, since: unsentSince });
  const publishDesiredStatus = (target) => {
    deps.publish(desiredStatusFrame(), target);
  };
  const publishRuntimeOptions = (target) => {
    if (hasDefinition) deps.publish(runtimeOptions.frame(), target);
  };
  const requestRuntimeOptions = (reason, addresses, to) => {
    if (addresses.length === 0 || to.length === 0) return;
    if (unsentSince !== null) {
      logInfo("(INFO, BRIDGE)", `Not requesting ${String(addresses.length)} option list(s) from Unity (${reason}): the imported project has not been sent yet.`);
      return;
    }
    for (const target of to) {
      logInfo("(INFO, BRIDGE)", `Requesting ${String(addresses.length)} option list(s) from Unity "${target.name}" (${reason}).`);
      for (const address of addresses) sendLogged("request", [target], address);
    }
  };
  const sendLogged = (origin, to, address, ...args) => {
    for (const target of to) sendMessage(target.host, target.sendPort, address, ...args);
    if (to.length > 0) deps.onSent?.({ origin, targets: to.map((target) => target.name), messages: [{ address, args }] });
  };
  const sendToAllTargets = (origin, address, ...args) => {
    sendLogged(origin, targets, address, ...args);
  };
  const sendUiKeyLists = (origin, to, only) => {
    for (const list of runtimeOptions.uiKeyLists()) {
      if (only !== void 0 && list.address !== only) continue;
      sendLogged(origin, to, list.address, ...list.rows.map((row) => ({ type: "s", value: row.id })));
    }
  };
  const heldValues = () => {
    const keyLists = runtimeOptions.uiKeyLists();
    const spawned = spawns.entries();
    return {
      ...desired.persistable(),
      ...keyLists.length === 0 ? {} : { keyLists },
      ...spawned.length === 0 ? {} : { spawns: spawned }
    };
  };
  const persistDesired = () => {
    if (activeName === void 0) return;
    deps.desiredValuesStore?.save(activeName, { ...heldValues(), ...unsentSince === null ? {} : { unsentSince } });
  };
  const rejectRecordKey = (clientId, detail) => {
    deps.publish({ v: 1, type: "notice", level: "error", code: "record-key-rejected", detail }, clientId);
  };
  const addRecordKey = (recordId, key, clientId) => {
    const record = definedRecords.find((candidate) => candidate.id === recordId);
    if (record === void 0) return rejectRecordKey(clientId, `unknown-record: ${recordId}`);
    if (key === "") return rejectRecordKey(clientId, "empty-key");
    const keysAddress = record.keysFrom.address;
    let rowKey = key;
    if (recordHasRowIds(record)) {
      const added = runtimeOptions.addUiKey(keysAddress, key);
      if (added.result !== "added") return rejectRecordKey(clientId, `${added.result === "full" ? "full" : "exists"}: ${key}`);
      rowKey = added.id;
      sendUiKeyLists("ui", targets, keysAddress);
      publishRuntimeOptions();
    }
    const lists = definedRecords.filter((candidate) => candidate.keysFrom.address === keysAddress).map((candidate) => ({ record: candidate.id, keys: [rowKey] }));
    const created = desired.addKeys(lists);
    if (created.length === 0 && record.keysFrom.source !== "ui") return rejectRecordKey(clientId, `exists: ${key}`);
    addRecordRows(created, false);
    persistDesired();
  };
  const removeRecordKey = (recordId, key, clientId) => {
    const record = definedRecords.find((candidate) => candidate.id === recordId);
    if (record === void 0) return rejectRecordKey(clientId, `unknown-record: ${recordId}`);
    const keysAddress = record.keysFrom.address;
    const name = recordHasRowIds(record) ? runtimeOptions.uiRowName(keysAddress, key) : void 0;
    const listed = recordHasRowIds(record) && runtimeOptions.removeUiKey(keysAddress, key);
    const removed = desired.removeKey(keysAddress, key);
    if (!listed && !removed) return rejectRecordKey(clientId, `not-found: ${key}`);
    if (listed) {
      sendUiKeyLists("ui", targets, keysAddress);
      publishRuntimeOptions();
    }
    logInfo("(INFO, BRIDGE)", `Removed record row "${name ?? key}" (${keysAddress}).`);
    const recreated = desired.addKeys(runtimeOptions.recordKeys());
    for (const target of targets.filter(isTargetReachable)) {
      for (const value of recreated) sendLogged("row", [target], value.address, ...value.args);
    }
    publishDesiredFull();
    persistDesired();
  };
  const renameRecordKey = (recordId, key, name, clientId) => {
    const record = definedRecords.find((candidate) => candidate.id === recordId);
    if (record === void 0) return rejectRecordKey(clientId, `unknown-record: ${recordId}`);
    if (!recordHasRowIds(record)) return rejectRecordKey(clientId, `not-renamable: ${recordId}`);
    if (name === "") return rejectRecordKey(clientId, "empty-key");
    const keysAddress = record.keysFrom.address;
    const before = runtimeOptions.uiRowName(keysAddress, key);
    const result = runtimeOptions.renameUiKey(keysAddress, key, name);
    if (result === "unchanged") return;
    if (result === "not-found" || result === "unknown") return rejectRecordKey(clientId, `not-found: ${key}`);
    if (result === "exists") return rejectRecordKey(clientId, `exists: ${name}`);
    logInfo("(INFO, BRIDGE)", `Renamed record row "${before ?? key}" to "${name}" (${keysAddress}).`);
    publishRuntimeOptions();
    const rows = desired.rowsOf(keysAddress, key);
    for (const value of rows) sendToAllTargets("ui", value.address, ...value.args);
    if (rows.length > 0) deps.publish(desiredFrame(false, rows));
    persistDesired();
  };
  const retainUiRows = () => {
    for (const list of runtimeOptions.uiKeyLists()) desired.retainKeys(list.address, list.rows.map((row) => row.id));
  };
  const lastOperatedAt = /* @__PURE__ */ new Map();
  const uiRecordAt = (address) => definedRecords.find((candidate) => candidate.address === address && recordHasRowIds(candidate));
  const isUnlistedUiRow = (address, args) => {
    const record = uiRecordAt(address);
    const head = args[0];
    if (record === void 0 || head?.type !== "s") return false;
    return runtimeOptions.uiRowName(record.keysFrom.address, head.value) === void 0;
  };
  const withCurrentRowName = (address, args) => {
    const record = uiRecordAt(address);
    const head = args[0];
    if (record === void 0 || head?.type !== "s" || args[1]?.type !== "s") return [...args];
    const name = runtimeOptions.uiRowName(record.keysFrom.address, head.value);
    return name === void 0 || name === args[1].value ? [...args] : [head, { type: "s", value: name }, ...args.slice(2)];
  };
  const recordDesired = (messages) => {
    const changed = messages.filter((message) => !isUnlistedUiRow(message.address, message.args) && desired.record(message.address, message.args));
    for (const message of changed) lastOperatedAt.set(desired.entryId(message.address, message.args), now());
    if (changed.length > 0) {
      deps.publish(desiredFrame(false, changed));
      persistDesired();
    }
  };
  const isTargetReachable = (target) => {
    const status = target.monitor.snapshot();
    return status.lastPongSeq !== null && status.consecutiveLosses === 0;
  };
  const recordHostsOf = (target) => target.broadcast === null ? [target.host] : [...target.responders.keys()];
  const allRecordHosts = () => [...new Set(targets.flatMap(recordHostsOf))];
  const sendTargetForHost = (host) => {
    const unicast = targets.find((target) => target.broadcast === null && target.host === host);
    if (unicast !== void 0) return unicast;
    const broadcast = targets.find((target) => target.broadcast !== null && (target.responders.has(host) || inBroadcastNetwork(target, host)));
    return broadcast === void 0 ? null : { ...broadcast, host };
  };
  const recordHostsForSource = (fromHost) => {
    const hosts = /* @__PURE__ */ new Set();
    for (const target of targets) {
      if (target.broadcast === null) {
        if (isTargetHost(target, fromHost)) hosts.add(target.host);
      } else if (target.responders.has(fromHost) || inBroadcastNetwork(target, fromHost)) {
        hosts.add(fromHost);
      }
    }
    return [...hosts];
  };
  const isHostDown = (host) => {
    const target = sendTargetForHost(host);
    if (target === null) return true;
    if (target.broadcast === null) return !isTargetReachable(target);
    const round = target.responders.get(host);
    return round === void 0 || round < target.pingRound - 1;
  };
  const usedInBlueprints = (packageName, name) => {
    const prefix = spawnedPrefix(packageName, name);
    return (deps.catalogPcs?.() ?? []).some((pc) => pc.items.some((item) => item.address.startsWith(prefix)));
  };
  const knownSpawners = () => {
    const bases = /* @__PURE__ */ new Map();
    const add = (address, base) => bases.set(address, (bases.get(address) ?? /* @__PURE__ */ new Set()).add(base));
    for (const entry of spawns.entries()) add(entry.address, spawnBase(entry.name));
    for (const parameter of definedParameters.values()) {
      if (spawnCommandOf(parameter) === "spawn" && typeof parameter.value === "string") add(parameter.address, spawnBase(parameter.value));
    }
    return [...bases].map(([address, set]) => ({ address, bases: [...set] }));
  };
  const sendSpawn = (to, address, name) => sendLogged("resend", [to], address, { type: "s", value: name });
  const restoreGenerations = /* @__PURE__ */ new Map();
  let restoreGeneration = 0;
  const sendSpawnsPaced = (host, entries, then) => {
    const generation = ++restoreGeneration;
    restoreGenerations.set(host, generation);
    const steps = [];
    for (const entry of entries) {
      const index = steps.findIndex((step) => step.filter((sent) => sent.address === entry.address).length < SPAWNS_PER_STEP);
      if (index === -1) steps.push([entry]);
      else steps[index].push(entry);
    }
    const run = (index) => {
      if (stopped || restoreGenerations.get(host) !== generation) return;
      const to = sendTargetForHost(host);
      if (to === null) return;
      const current = spawns.forHost(host);
      for (const entry of steps[index] ?? []) {
        if (current.some((held) => held.address === entry.address && held.name === entry.name)) sendSpawn(to, entry.address, entry.name);
      }
      if (index + 1 < steps.length) setTimeoutFn(() => run(index + 1), SPAWN_STEP_MS);
      else {
        restoreGenerations.delete(host);
        then?.(to);
      }
    };
    run(0);
  };
  const restoreSpawns = (host, reason, then) => {
    const to = sendTargetForHost(host);
    if (to === null) return 0;
    const { restore, dropped } = spawns.takeRestore(host);
    for (const entry of dropped) {
      logInfo("(INFO, BRIDGE)", `Not restoring "${entry.name}" (${entry.address}) on ${host}: it was removed on another PC while ${host} was down.`);
    }
    if (restore.length > 0) logInfo("(INFO, BRIDGE)", `Restoring ${String(restore.length)} spawned object(s) on ${host} (${reason}).`);
    sendSpawnsPaced(host, restore, then);
    if (dropped.length > 0) persistDesired();
    return restore.length;
  };
  const sendSpawnCommand = (parameter, command, value, clientId, reject) => {
    if (!isValidSpawnName(value)) {
      reject(`invalid-name: ${parameter.id}`);
      return;
    }
    const hosts = allRecordHosts();
    if (command === "spawn") {
      const name = spawns.allocate(parameter.address, value, usedInBlueprints);
      if (name === null) {
        reject(`invalid-name: ${parameter.id}`);
        return;
      }
      if (!spawns.canRecord(parameter.address, name, hosts)) {
        reject(`spawn-record-full: ${parameter.id}`);
        return;
      }
      sendToAllTargets("ui", parameter.address, { type: "s", value: name });
      spawns.recordSpawn(parameter.id, parameter.address, name, hosts);
      logInfo("(INFO, BRIDGE)", `Spawned "${name}" with ${parameter.address} on ${hosts.length === 0 ? "no known PC" : hosts.join(", ")}.`);
      deps.publish({ v: 1, type: "notice", level: "info", code: "spawned", detail: name }, clientId);
    } else {
      sendToAllTargets("ui", parameter.address, { type: "s", value });
      spawns.recordDestroy(parameter.address, value, hosts);
      logInfo("(INFO, BRIDGE)", `Destroyed "${value}" with ${parameter.address} on ${hosts.length === 0 ? "no known PC" : hosts.join(", ")}.`);
    }
    persistDesired();
  };
  const reconcileTarget = (name, clientId) => {
    const target = targets.find((candidate) => candidate.name === name);
    if (target === void 0) {
      deps.publish({ v: 1, type: "notice", level: "error", code: "reconcile-rejected", detail: `unknown-target: ${name}` }, clientId);
      return;
    }
    let spawned = 0;
    let destroyed = 0;
    let changed = false;
    for (const host of recordHostsOf(target)) {
      const to = sendTargetForHost(host);
      if (to === null) continue;
      const pc = (deps.catalogPcs?.() ?? []).find((candidate) => recordHostsForSource(candidate.host).includes(host));
      const plan = spawns.reconcile(host, pc === void 0 ? null : pc.items.map((item) => item.address), knownSpawners());
      for (const entry of plan.dropped) {
        logInfo("(INFO, BRIDGE)", `Not restoring "${entry.name}" (${entry.address}) on ${host}: it was removed on another PC while ${host} was down.`);
      }
      for (const extra of plan.extras) {
        sendLogged("resend", [to], extra.destroyAddress, { type: "s", value: extra.name });
        spawns.recordDestroy(extra.destroyAddress, extra.name, [host]);
      }
      for (const entry of plan.missing) spawns.recordSpawn(entry.param, entry.address, entry.name, [host]);
      sendSpawnsPaced(host, plan.missing);
      spawned += plan.missing.length;
      destroyed += plan.extras.length;
      changed ||= plan.dropped.length > 0 || plan.missing.length > 0;
    }
    logInfo("(INFO, BRIDGE)", `Reconciled Unity "${target.name}" with the spawn record: spawned ${String(spawned)}, destroyed ${String(destroyed)}.`);
    resendDesired("reconcile requested by UI", void 0, [target]);
    if (changed) persistDesired();
    deps.publish({ v: 1, type: "notice", level: "info", code: "reconciled", detail: `${target.name}: spawned ${String(spawned)}, destroyed ${String(destroyed)}` }, clientId);
  };
  const addRecordRows = (created, automatic = true) => {
    if (created.length === 0) return;
    const sendTo = automatic && unsentSince !== null ? [] : targets.filter(isTargetReachable);
    if (sendTo.length === 0 && automatic && unsentSince !== null) {
      logInfo("(INFO, BRIDGE)", `Not sending ${String(created.length)} new record row(s) to Unity: the imported project has not been sent yet.`);
    }
    for (const target of sendTo) {
      logInfo("(INFO, BRIDGE)", `Sending ${String(created.length)} new record row(s) to Unity "${target.name}".`);
      for (const value of created) sendLogged("row", [target], value.address, ...value.args);
    }
    deps.publish(desiredFrame(false, created));
    persistDesired();
  };
  const tick = () => {
    if (stopped) return;
    for (const target of targets) {
      const before = target.monitor.snapshot().consecutiveLosses;
      const seq = target.monitor.nextPing(now(), pingSeq++);
      target.pingRound += 1;
      target.lastPingSeq = seq;
      const lost = target.monitor.snapshot().consecutiveLosses > before;
      if (target.primary) diagnostics?.onPingCycle?.({ previousLost: lost });
      sendMessage(target.host, target.sendPort, SYS.PING, { type: "i", value: seq });
    }
    publishLink();
  };
  const linkSnapshot = () => ({
    unity: unityStatus(),
    targets: targets.map((target) => ({ name: target.name, primary: target.primary, ...statusOf(target) }))
  });
  function unityStatus() {
    return statusOf(primaryTarget());
  }
  const onBroadcastPong = (target, host, seq) => {
    const result = target.monitor.onPong(seq, now());
    const previous = target.responders.get(host);
    target.responders.set(host, target.pingRound);
    const isNew = previous === void 0;
    if (isNew || previous < target.pingRound - 1) {
      const reason = isNew ? `Unity first reachable at ${host}` : `Unity recovered at ${host}`;
      const unicast = { ...target, host };
      autoResendDesired(reason, void 0, [unicast]);
      requestRuntimeOptions(reason, runtimeOptions.requestAddresses(), [unicast]);
    }
    if (isNew) {
      if (target.primary) syncRouterUnity();
      deps.onRespondersChanged?.();
    }
    if (result.accepted) {
      target.hasBeenReachable = true;
      publishLink();
      if (target.primary) diagnostics?.onPongAccepted?.();
    }
  };
  function syncRouterUnity() {
    const primary = primaryTarget();
    uiRouter?.setUnity({ host: primary.host, port: primary.sendPort }, [...primary.addresses, ...primary.responders.keys()]);
  }
  function setTargets(specs) {
    const primaries = specs.filter((spec) => spec.primary);
    if (specs.length === 0 || primaries.length !== 1) throw new Error("setTargets needs exactly one primary target");
    const ordered = [...primaries, ...specs.filter((spec) => !spec.primary)];
    const sameNetwork = (a, b) => a === b || a !== null && b !== null && a.networkInt === b.networkInt && a.maskInt === b.maskInt;
    const optionsBefore = JSON.stringify(runtimeOptions.frame());
    targets = ordered.map((spec) => {
      const kept = targets.find((target) => target.name === spec.name && target.host === spec.host && target.sendPort === spec.sendPort && sameNetwork(target.broadcast, spec.broadcast ?? null));
      if (kept === void 0) {
        runtimeOptions.forgetTarget(spec.name);
        return newRuntimeTarget(spec);
      }
      return { ...kept, primary: spec.primary, addresses: /* @__PURE__ */ new Set([spec.host, ...spec.addresses ?? []]) };
    });
    targetNames.splice(0, targetNames.length, ...targets.map((target) => target.name));
    if (JSON.stringify(runtimeOptions.frame()) !== optionsBefore) {
      publishRuntimeOptions();
      addRecordRows(desired.addKeys(runtimeOptions.recordKeys()));
    }
    if (spawns.retainHosts((host) => sendTargetForHost(host) !== null)) {
      logInfo("(INFO, BRIDGE)", "Dropped the spawn record of PCs that are no longer destinations.");
      persistDesired();
    }
    syncRouterUnity();
    warnedEchoMismatch.clear();
    logInfo("(INFO, BRIDGE)", `Unity targets: ${targets.map((target) => `${target.name} ${target.host}:${String(target.sendPort)}${target.primary ? " (primary)" : ""}`).join(", ")}.`);
    publishLink(void 0, true);
  }
  function statusOf(target) {
    const status = target.monitor.snapshot();
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
      stopped = false;
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
      diagnostics = null;
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
      if (message.address === SYS.PONG && !isUnityHost(message.from.host) && !targets.some((target) => inBroadcastNetwork(target, message.from.host))) {
        if (!warnedNonUnitySources.has(message.from.host)) {
          warnedNonUnitySources.add(message.from.host);
          logWarn("(WARN, BRIDGE)", `Ignored ${message.address} from non-Unity source ${message.from.host}:${String(message.from.port)}.`);
        }
        return;
      }
      if (message.address === SYS.PONG) {
        const arg = message.args[0];
        const answered = arg?.type === "i" ? targets.find((target) => target.broadcast === null && target.monitor.pendingSeq() === arg.value && target.addresses.has(message.from.host)) : void 0;
        if (arg?.type === "i" && Number.isInteger(arg.value) && answered === void 0) {
          const broadcastTarget = targets.find((target) => target.lastPingSeq === arg.value && inBroadcastNetwork(target, message.from.host));
          if (broadcastTarget !== void 0) onBroadcastPong(broadcastTarget, message.from.host, arg.value);
          return;
        }
        if (arg?.type === "i" && Number.isInteger(arg.value) && answered !== void 0) {
          const result = answered.monitor.onPong(arg.value, now());
          if (result.accepted && (!answered.hasBeenReachable || result.recoveredFromLoss)) {
            const reason = answered.hasBeenReachable ? "Unity recovered" : "Unity first reachable";
            autoResendDesired(reason, void 0, [answered]);
            requestRuntimeOptions(reason, runtimeOptions.requestAddresses(), [answered]);
          }
          if (result.accepted) answered.hasBeenReachable = true;
          if (result.accepted) publishLink();
          if (result.accepted && answered.primary) diagnostics?.onPongAccepted?.();
        }
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
      if (message.address === OSCDESK.STATUS_REQUEST) {
        deps.sendFn(message.from.host, message.from.port, OSCDESK.STATUS, {
          type: "s",
          value: JSON.stringify(linkSnapshot())
        });
        return;
      }
      if (isInternalAddress(message.address)) return;
      const source = sourceTarget(message.from);
      if (runtimeOptions.isListAddress(message.address)) {
        if (source === null) {
          warnRuntimeOptionsOnce(`source:${message.from.host}:${message.address}`, `Ignored option list "${message.address}" from non-Unity source ${message.from.host}:${String(message.from.port)}.`);
          return;
        }
        const host = source.broadcast === null ? void 0 : message.from.host;
        const result = runtimeOptions.receive(source.name, message.address, message.args, host);
        if (result === "invalid") {
          warnRuntimeOptionsOnce(`args:${source.name}:${message.address}`, `Ignored option list "${message.address}" from Unity "${source.name}": every argument must be a string.`);
        } else if (result === "changed") {
          publishRuntimeOptions();
          addRecordRows(desired.addKeys(runtimeOptions.recordKeys()));
        } else if (result === "held") {
          const from = host === void 0 ? `"${source.name}"` : `"${source.name}" (${host})`;
          logInfo("(INFO, BRIDGE)", `Holding option list "${message.address}" from Unity ${from} until it is applied from the UI.`);
          publishRuntimeOptions();
        }
        return;
      }
      if (source !== null && runtimeOptions.isRequestAddress(message.address)) return;
      const entryId = desired.entryId(message.address, message.args);
      if (source !== null && !source.primary) {
        const key = `${source.name}:${entryId}`;
        const secondarySettling = now() - (lastOperatedAt.get(entryId) ?? -Infinity) < ECHO_SETTLE_MS;
        if (secondarySettling) {
        } else if (desired.differsFromEcho(message.address, message.args)) {
          if (!warnedEchoMismatch.has(key)) {
            warnedEchoMismatch.add(key);
            logWarn("(WARN, BRIDGE)", `Unity "${source.name}" echo differs from desired value for "${describeEntry(message.address, message.args, entryId)}".`);
          }
        } else {
          warnedEchoMismatch.delete(key);
        }
        return;
      }
      if (uiRouter !== null) {
        const decision = uiRouter.route(message.from, now());
        if (decision.kind === "to-unity") {
          sendToAllTargets("relay", message.address, ...message.args);
          recordDesired([{ address: message.address, args: message.args }]);
        } else if (decision.kind === "to-ui") {
          for (const target of decision.targets) {
            deps.sendFn(target.host, target.port, message.address, ...message.args);
          }
        }
      }
      const settling = now() - (lastOperatedAt.get(entryId) ?? -Infinity) < ECHO_SETTLE_MS;
      if (isUnityHost(message.from.host) && !settling && desired.differsFromEcho(message.address, message.args)) {
        if (!warnedEchoMismatch.has(entryId)) {
          warnedEchoMismatch.add(entryId);
          logWarn("(WARN, BRIDGE)", `Unity echo differs from desired value for "${describeEntry(message.address, message.args, entryId)}".`);
        }
      } else {
        warnedEchoMismatch.delete(entryId);
      }
      deps.publish({ v: 1, type: "osc.message", address: message.address, args: toWireArgs(message.args), from: message.from });
    },
    handleUiFrame(frame, clientId) {
      if (frame.type === "heartbeatAck") return;
      if (frame.type === "runtimeOptionsRefresh") {
        if (unsentSince !== null) {
          deps.publish(
            { v: 1, type: "notice", level: "error", code: "runtime-options-refresh-rejected", detail: "unsent-project" },
            clientId
          );
          return;
        }
        if (frame.request === void 0) {
          requestRuntimeOptions("requested by UI", runtimeOptions.requestAddresses(), targets);
          return;
        }
        if (!runtimeOptions.isRequestAddress(frame.request)) {
          deps.publish(
            { v: 1, type: "notice", level: "error", code: "runtime-options-refresh-rejected", detail: `unknown-request: ${frame.request}` },
            clientId
          );
          return;
        }
        requestRuntimeOptions(`sync requested by UI: ${frame.request}`, [frame.request], targets);
        return;
      }
      if (frame.type === "runtimeOptionsApply") {
        const result = runtimeOptions.apply(frame.address);
        if (result === "unknown") {
          deps.publish(
            { v: 1, type: "notice", level: "error", code: "runtime-options-apply-rejected", detail: `unknown-list: ${String(frame.address)}` },
            clientId
          );
          return;
        }
        if (result === "applied") {
          logInfo("(INFO, BRIDGE)", `Applied held option list(s)${frame.address === void 0 ? "" : ` "${frame.address}"`} by UI request.`);
          publishRuntimeOptions();
          addRecordRows(desired.addKeys(runtimeOptions.recordKeys()));
        }
        return;
      }
      if (frame.type === "recordKeyAdd") {
        addRecordKey(frame.record, frame.key, clientId);
        return;
      }
      if (frame.type === "recordKeyRemove") {
        removeRecordKey(frame.record, frame.key, clientId);
        return;
      }
      if (frame.type === "recordKeyRename") {
        renameRecordKey(frame.record, frame.key, frame.name, clientId);
        return;
      }
      if (frame.type === "reconcile") {
        reconcileTarget(frame.target, clientId);
        return;
      }
      if (frame.type === "resend") {
        const only = frame.target === void 0 ? targets : targets.filter((target) => target.name === frame.target);
        if (only.length === 0) {
          deps.publish({ v: 1, type: "notice", level: "error", code: "resend-rejected", detail: `unknown-target: ${String(frame.target)}` }, clientId);
          return;
        }
        if (frame.target === void 0 && unsentSince !== null) {
          for (const host of new Set(spawns.entries().map((entry) => entry.host))) restoreSpawns(host, "imported project sent");
        }
        resendDesired("requested by UI", void 0, only);
        if (frame.target === void 0 && unsentSince !== null) {
          logInfo("(INFO, BRIDGE)", "Imported project values were sent to every Unity target; automatic resends are enabled again.");
          unsentSince = null;
          persistDesired();
          publishDesiredStatus();
          requestRuntimeOptions("imported project sent", runtimeOptions.requestAddresses(), targets);
        }
        return;
      }
      if (frame.type === "set") {
        const parameter = definedParameters.get(frame.param);
        const reject = (detail) => deps.publish({ v: 1, type: "notice", level: "error", code: "set-rejected", detail }, clientId);
        if (parameter === void 0) {
          reject(`unknown-param: ${frame.param}`);
          return;
        }
        if (parameter.standalone === false) {
          reject(`not-standalone: ${frame.param}`);
          return;
        }
        const converted = parameterArgs(parameter, frame.value);
        if (!converted.ok) {
          reject(converted.reason);
          return;
        }
        const locked = lockRejection([{ param: parameter.id }], clientId, frame.holder);
        if (locked !== null) {
          reject(locked);
          return;
        }
        const command = spawnCommandOf(parameter);
        if (command !== null) {
          const head = converted.args[0];
          sendSpawnCommand(parameter, command, head?.type === "s" ? head.value : "", clientId, reject);
          return;
        }
        sendToAllTargets("ui", parameter.address, ...converted.args);
        recordDesired([{ address: parameter.address, args: converted.args }]);
        return;
      }
      if (frame.type === "osc.batch") {
        const internalAddress = frame.messages.find((message) => isInternalAddress(message.address))?.address;
        if (internalAddress !== void 0) {
          rejectBatch(clientId, `internal-address: ${internalAddress}`);
          return;
        }
        const listAddress = frame.messages.find((message) => runtimeOptions.isListAddress(message.address))?.address;
        if (listAddress !== void 0) {
          rejectBatch(clientId, `option-list-address: ${listAddress}`);
          return;
        }
        const lockedStep = lockRejection(
          frame.messages.flatMap((message) => lockRefsOf(message.address, toOscArgs(message.args))),
          clientId,
          frame.holder
        );
        if (lockedStep !== null) {
          rejectBatch(clientId, lockedStep);
          return;
        }
        if (deps.sendBundleFn === void 0) {
          rejectBatch(clientId, "transport-unavailable");
          return;
        }
        const messages = frame.messages.map((message) => ({
          address: message.address,
          args: withCurrentRowName(message.address, toOscArgs(message.args))
        }));
        const primary = primaryTarget();
        const result = deps.sendBundleFn(primary.host, primary.sendPort, messages);
        const delivered = [primary.name];
        if (result.ok) {
          for (const target of targets.slice(1)) {
            const secondaryResult = deps.sendBundleFn(target.host, target.sendPort, messages);
            if (!secondaryResult.ok) logWarn("(WARN, BRIDGE)", `Batch to Unity "${target.name}" failed: ${secondaryResult.reason}.`);
            else delivered.push(target.name);
          }
        }
        if (!result.ok) {
          rejectBatch(clientId, result.reason === "too-large" ? `too-large: ${String(result.bytes)} bytes (limit ${String(result.limitBytes)})` : "transport-unavailable");
          return;
        }
        deps.onSent?.({ origin: "action", targets: delivered, messages, batch: true });
        recordDesired(messages);
        for (const message of messages) {
          for (const target of targets) diagnostics?.recordOutgoing?.(message.address, message.args, target.host, target.sendPort);
        }
        return;
      }
      if (frame.type !== "osc.message") return;
      if (isInternalAddress(frame.address)) {
        if (!warnedInternalAddresses.has(frame.address)) {
          warnedInternalAddresses.add(frame.address);
          logWarn("(WARN, BRIDGE)", `Blocked UI frame to internal address "${frame.address}".`);
        }
        return;
      }
      if (runtimeOptions.isListAddress(frame.address)) {
        warnRuntimeOptionsOnce(`ui:${frame.address}`, `Blocked UI frame to option list address "${frame.address}".`);
        return;
      }
      const args = withCurrentRowName(frame.address, toOscArgs(frame.args));
      const lockedRow = lockRejection(lockRefsOf(frame.address, args), clientId, frame.holder);
      if (lockedRow !== null) {
        deps.publish({ v: 1, type: "notice", level: "error", code: "locked", detail: lockedRow }, clientId);
        return;
      }
      sendToAllTargets("ui", frame.address, ...args);
      recordDesired([{ address: frame.address, args }]);
    },
    onUiConnected(clientId) {
      deps.publish(buildHelloFrame(clientId), clientId);
      publishLink(clientId, true);
    },
    onUiDisconnected(_clientId) {
    },
    linkSnapshot,
    helloFrame: buildHelloFrame,
    setDefinition(definition, name, imported) {
      const holdsValues = hasDefinition;
      const importing = definition !== null && imported !== void 0;
      const sameDefinition = name !== void 0 && name === activeName && holdsValues;
      const keepsUnsent = sameDefinition && unsentSince !== null;
      const markedSince = holdsValues && !importing && !keepsUnsent && definition !== null && name !== void 0 ? deps.desiredValuesStore?.unsentSince?.(name) : void 0;
      const leavingUnsent = unsentSince !== null && !sameDefinition;
      const replace = importing || leavingUnsent || markedSince !== void 0;
      if (replace) desired.setDefinition(null);
      const reset = desired.setDefinition(definition);
      const resend = new Set(reset);
      let savedKeyLists;
      if (!keepsUnsent) unsentSince = null;
      if (importing) {
        const restored = desired.restore(imported);
        savedKeyLists = imported.keyLists ?? [];
        spawns.replace(imported.spawns ?? []);
        unsentSince = new Date(now()).toISOString();
        const total = imported.values.length + imported.records.length;
        logInfo("(INFO, BRIDGE)", `Imported ${String(restored.length)} of ${String(total)} project value(s) for surface "${String(name)}"; they are not sent to Unity until a resend to every target is requested.`);
      } else if (definition !== null && name !== void 0 && (!holdsValues || replace)) {
        if (replace) savedKeyLists = [];
        const loaded = deps.desiredValuesStore?.load(name);
        const saved = loaded == null ? loaded : migrateLegacyRowKeys(loaded, definition, newRowId);
        if (saved != null || replace) spawns.replace(saved?.spawns ?? []);
        if (saved != null) {
          savedKeyLists = saved.keyLists ?? (replace ? [] : void 0);
          if (saved.unsentSince !== void 0) unsentSince = saved.unsentSince;
          const restored = desired.restore(saved);
          for (const id of restored) resend.add(id);
          const total = saved.values.length + saved.records.length;
          logInfo("(INFO, BRIDGE)", `Restored ${String(restored.length)} of ${String(total)} saved desired value(s) for surface "${name}".`);
        }
      }
      activeName = definition === null ? void 0 : name;
      definedRecords = definition?.records ?? [];
      definedParameters = new Map((definition?.parameters ?? []).map((parameter) => [parameter.id, parameter]));
      parameterIdsByAddress = new Map((definition?.parameters ?? []).map((parameter) => [parameter.address, parameter.id]));
      recordIdsByAddress = new Map((definition?.records ?? []).map((record) => [record.address, record.id]));
      const newRequests = runtimeOptions.setDefinition(definition);
      if (savedKeyLists !== void 0) {
        const rowsOf = (list) => list.rows.flatMap((row) => row.id === void 0 ? [] : [{ id: row.id, name: row.name }]);
        const lists = replace ? runtimeOptions.uiKeyLists().map((current) => {
          const saved = savedKeyLists?.find((list) => list.address === current.address);
          return { address: current.address, rows: saved === void 0 ? [] : rowsOf(saved) };
        }) : savedKeyLists.map((list) => ({ address: list.address, rows: rowsOf(list) }));
        runtimeOptions.restoreUiKeys(lists);
      }
      retainUiRows();
      const created = desired.addKeys(runtimeOptions.recordKeys());
      for (const value of created) resend.add(desired.entryId(value.address, value.args));
      persistDesired();
      hasDefinition = definition !== null;
      warnedEchoMismatch.clear();
      warnedRuntimeOptions.clear();
      lastOperatedAt.clear();
      publishDesiredFull();
      publishRuntimeOptions();
      publishDesiredStatus();
      if (hasDefinition) {
        const reachable = targets.filter(isTargetReachable);
        autoResendDesired("definition adopted", resend, reachable);
        requestRuntimeOptions("definition adopted", newRequests, reachable);
      }
    },
    exportDesired: heldValues,
    publishDesiredStatus: (clientId) => publishDesiredStatus(clientId),
    publishDesired: publishDesiredFull,
    publishRuntimeOptions: (clientId) => publishRuntimeOptions(clientId),
    setTargets,
    currentTargets: () => targets.map((target) => ({
      name: target.name,
      host: target.host,
      sendPort: target.sendPort,
      primary: target.primary,
      addresses: [...target.addresses],
      broadcast: target.broadcast
    })),
    primaryHosts: () => [.../* @__PURE__ */ new Set([...primaryTarget().addresses, ...primaryTarget().responders.keys()])],
    requestCatalog: () => sendToAllTargets("request", CATALOG_ADDRESSES.REQUEST),
    onTargetStarted(fromHost) {
      if (stopped) return;
      for (const host of recordHostsForSource(fromHost)) {
        const to = sendTargetForHost(host);
        if (to === null) continue;
        const reason = `Unity started at ${host}`;
        if (unsentSince !== null) {
          logInfo("(INFO, BRIDGE)", `Not restoring spawned objects on ${host} (${reason}): the imported project has not been sent yet.`);
          continue;
        }
        restoreSpawns(host, reason, (restored) => {
          autoResendDesired(reason, void 0, [restored]);
          requestRuntimeOptions(reason, runtimeOptions.requestAddresses(), [restored]);
        });
      }
    },
    onCatalogItemRemoved(fromHost, itemAddress) {
      let changed = false;
      for (const host of recordHostsForSource(fromHost)) changed = spawns.catalogRemoved(host, itemAddress, isHostDown) || changed;
      if (changed) persistDesired();
    },
    onCatalogItemAdded(fromHost, itemAddress) {
      let changed = false;
      for (const host of recordHostsForSource(fromHost)) changed = spawns.catalogSeen(host, itemAddress) || changed;
      if (changed) persistDesired();
    },
    firePad(address, args) {
      if (isInternalAddress(address)) return { ok: false, reason: `internal-address: ${address}` };
      if (runtimeOptions.isListAddress(address)) return { ok: false, reason: `option-list-address: ${address}` };
      sendToAllTargets("pad", address, ...args);
      return { ok: true };
    }
  };
  function buildHelloFrame(clientId) {
    const primary = primaryTarget();
    return {
      v: 1,
      type: "hello",
      clientId,
      protocolVersion: 1,
      server: { name: deps.config.server?.name ?? "oscdesk-bridge", version: deps.config.server?.version ?? "0.1.0" },
      unity: { host: primary.host, sendPort: primary.sendPort },
      targets: targets.map((target) => ({ name: target.name, host: target.host, sendPort: target.sendPort, primary: target.primary })),
      bridge: {
        oscListenPort: deps.config.bridge.oscListenPort,
        wsPort: deps.config.bridge.wsPort
      },
      heartbeat: { intervalMs: 15e3, timeoutMs: 3e4 },
      pingIntervalMs: PING_INTERVAL_MS,
      debug: deps.config.debug,
      adapters: [...deps.adapterKinds ?? ["osc"]]
    };
  }
}
function parameterArgs(parameter, value) {
  const chosen = parameter.kind === "trigger" && value === void 0 ? parameter.value : value;
  if (chosen === void 0) return { ok: false, reason: `missing-value: ${parameter.id}` };
  const inRange = (number) => parameter.type !== "i" && parameter.type !== "f" || parameter.range === void 0 || number >= Math.min(...parameter.range) && number <= Math.max(...parameter.range);
  switch (parameter.type) {
    case "i":
      if (typeof chosen !== "number" || !Number.isInteger(chosen) || chosen < -2147483648 || chosen > 2147483647) {
        return { ok: false, reason: `type-mismatch: ${parameter.id} expects an int32` };
      }
      if (!inRange(chosen)) return { ok: false, reason: `out-of-range: ${parameter.id}` };
      return { ok: true, args: [{ type: "i", value: chosen }] };
    case "f":
      if (typeof chosen !== "number" || !Number.isFinite(chosen)) return { ok: false, reason: `type-mismatch: ${parameter.id} expects a number` };
      if (!inRange(chosen)) return { ok: false, reason: `out-of-range: ${parameter.id}` };
      return { ok: true, args: [{ type: "f", value: chosen }] };
    case "s":
      if (typeof chosen !== "string") return { ok: false, reason: `type-mismatch: ${parameter.id} expects a string` };
      return { ok: true, args: [{ type: "s", value: chosen }] };
    case "bool":
      if (typeof chosen !== "boolean") return { ok: false, reason: `type-mismatch: ${parameter.id} expects a boolean` };
      return { ok: true, args: [{ type: "i", value: chosen ? 1 : 0 }] };
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
function describeEntry(address, args, entryId) {
  const head = args[0];
  return entryId !== address && head?.type === "s" ? `${address}" key "${head.value}` : address;
}
function isBridgeInternalAddress(address) {
  return isOscdeskAddress(address);
}
var LOOPBACK_NETWORK = { networkInt: 2130706432, maskInt: 4278190080 };
function isInNetwork(host, network) {
  const value = ipv4ToInt(host);
  return value !== null && (value & network.maskInt) >>> 0 === network.networkInt;
}

// src/target-adapter.ts
var SYS_IGNORED = "/sys/ignored";
var SYS_FAILED = "/sys/failed";
var CATALOG_PREFIX = "/sys/catalog/";
function createOscAdapter(options) {
  return {
    kind: "osc",
    sendValue(to, binding, args) {
      options.transport()?.send(to.host, to.port, binding, args);
    },
    sendValues(to, messages) {
      return options.transport()?.sendBundle(to.host, to.port, messages) ?? { ok: false, reason: "transport-unavailable" };
    },
    receive(message) {
      const handlers = options.handlers();
      if (handlers === void 0) return;
      if (message.address === SYS.PONG) {
        handlers.alive(message);
        return;
      }
      if (message.address === SYS_IGNORED) {
        handlers.unbound(message.from, message.args.flatMap((arg) => arg.type === "s" ? [arg.value] : []));
        return;
      }
      if (message.address === SYS_FAILED) {
        const entries = [];
        for (let index = 0; index + 1 < message.args.length; index += 2) {
          const ref = message.args[index];
          const reason = message.args[index + 1];
          if (ref.type === "s" && reason.type === "s") entries.push({ ref: ref.value, reason: reason.value });
        }
        handlers.failed(message.from, entries);
        return;
      }
      if (message.address.startsWith(CATALOG_PREFIX) && handlers.blueprint(message)) return;
      handlers.delivered(message);
    }
  };
}

// src/udp-transport.ts
var import_node_dgram2 = __toESM(require("node:dgram"));

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
    const bytes = data.byteOffset === 0 ? data : Uint8Array.from(data);
    const packet = osc.readPacket(bytes, OSC_READ_OPTIONS);
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
  const socket = options.createSocket?.() ?? import_node_dgram2.default.createSocket("udp4");
  const host = options.host ?? "0.0.0.0";
  socket.on("message", (data, remote) => {
    handleIncomingPacket(data, remote, options);
  });
  await bindSocket(socket, options.port, host);
  socket.setBroadcast(true);
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
var import_node_crypto4 = require("node:crypto");
var import_node_http = __toESM(require("node:http"));
var import_ws = require("ws");
var SAFE_HTTP_METHODS = /* @__PURE__ */ new Set(["GET", "HEAD", "OPTIONS"]);
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
  const httpServer = import_node_http.default.createServer((request, response) => {
    const method = request.method ?? "";
    const origin = request.headers.origin;
    if (!SAFE_HTTP_METHODS.has(method) && (origin !== void 0 || request.headers["sec-fetch-site"] === "cross-site")) {
      options.onHttpRejected?.(method, origin ?? "", request.socket.remoteAddress ?? "");
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("forbidden");
      return;
    }
    if (options.onHttpRequest?.(request, response) === true) return;
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("not found");
  });
  const server = new import_ws.WebSocketServer({
    server: httpServer,
    verifyClient: ({ req }, done) => {
      const origin = req.headers.origin;
      if (origin === void 0) return done(true);
      options.onHandshakeRejected?.(origin, req.socket.remoteAddress ?? "");
      done(false, 403, "Forbidden");
    }
  });
  server.on("error", () => void 0);
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
    const clientId = (0, import_node_crypto4.randomUUID)();
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
      httpServer.off("error", onStartupError);
      timer = setIntervalFn(handleHeartbeat, heartbeat.intervalMs);
      const address = httpServer.address();
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
            server.close((error) => {
              if (error) return fail(error);
              httpServer.close((httpError) => httpError ? fail(httpError) : done());
              httpServer.closeAllConnections();
            });
          });
        }
      });
    };
    const onStartupError = (error) => {
      httpServer.off("listening", onListening);
      server.close(() => void 0);
      httpServer.close(() => void 0);
      reject(error);
    };
    httpServer.once("listening", onListening);
    httpServer.once("error", onStartupError);
    httpServer.listen(options.port, options.host ?? "0.0.0.0");
  });
  return ready;
}
function rawText(data) {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  const chunks2 = Array.isArray(data) ? data : [data];
  return Buffer.concat(chunks2.map((chunk) => Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))).toString("utf8");
}
function sendFrame(socket, frame) {
  if (socket.readyState === import_ws.WebSocket.OPEN) socket.send(JSON.stringify(frame));
}

// src/diagnostics-engine.ts
var import_node_path11 = __toESM(require("node:path"));

// src/ndjson-writer.ts
var import_node_path9 = __toESM(require("node:path"));
function createNdjsonWriter(options) {
  const resolvedDir = import_node_path9.default.resolve(process.cwd(), options.dir);
  const fileName = `${options.filePrefix ?? "oscdesk-debug"}-${toSafeTimestamp(options.now())}.ndjson`;
  const filePath = import_node_path9.default.join(resolvedDir, fileName);
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
var import_node_path10 = __toESM(require("node:path"));
function listNdjsonFiles(fs5, dirPath) {
  let names;
  try {
    names = fs5.readdirSync(dirPath);
  } catch (error) {
    if (isMissingDirectory(error)) {
      return [];
    }
    throw error;
  }
  return names.filter((name) => name.endsWith(".ndjson")).map((name) => {
    const stat = fs5.statSync(import_node_path10.default.join(dirPath, name));
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
function ipv4ToInt2(octets) {
  return (octets[0] << 24 >>> 0 | octets[1] << 16 | octets[2] << 8 | octets[3]) >>> 0;
}
function isLoopbackIpv42(octets) {
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
  if (isLoopbackIpv42(destinationIpv4)) {
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
    if (ipv4ToInt2(interfaceAddress) === ipv4ToInt2(destinationIpv4)) {
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
  const destinationInt = ipv4ToInt2(destinationIpv4);
  for (const candidate of candidates) {
    const addressInt = ipv4ToInt2(candidate.address);
    const netmaskInt = ipv4ToInt2(candidate.netmask);
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
  const logDirPath = import_node_path11.default.resolve(process.cwd(), deps.config.diagnostics.ndjsonDir);
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
      currentFileNames: [writer.getCurrentFileName(), ...deps.protectedFileNames ?? []]
    });
    for (const target of purgeTargets) {
      try {
        deps.fs.unlinkSync(import_node_path11.default.join(logDirPath, target));
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

// src/surface-manager.ts
var MAX_UPLOAD_BYTES = 1024 * 1024;
var SURFACE_PATH = /^\/surfaces\/([^/]+)\.json$/;
function createSurfaceManager(deps) {
  const now = deps.now ?? Date.now;
  const logInfo = deps.logInfo ?? console.info;
  const logWarn = deps.logWarn ?? console.warn;
  let active = null;
  let revision = 0;
  const listFrame = () => ({
    v: 1,
    type: "surfaceList",
    names: deps.store.list(),
    active: active?.name ?? null
  });
  const surfaceFrame = () => active === null ? null : {
    v: 1,
    type: "surface",
    name: active.name,
    revision: active.revision,
    at: active.at,
    definition: active.definition
  };
  const reject = (clientId, code, detail) => {
    logWarn("(WARN, BRIDGE)", `Surface request rejected (${code}): ${detail}`);
    deps.publish({ v: 1, type: "notice", level: "error", code, detail }, clientId);
  };
  const adopt = (name, definition, imported) => {
    revision += 1;
    active = { name, revision, at: new Date(now()).toISOString(), definition };
    const frame = surfaceFrame();
    if (frame !== null) deps.publish(frame);
    deps.publish(listFrame());
    logInfo("(INFO, BRIDGE)", `Surface "${name}" adopted (revision ${String(revision)}).`);
    deps.onAdopt?.(definition, name, imported);
  };
  return {
    active: () => active === null ? null : { name: active.name, definition: active.definition },
    adoptBlueprint(name, generated) {
      const existing = deps.store.read(name);
      if (existing.ok) {
        adopt(name, existing.value);
        return { ok: true, saved: true };
      }
      if (existing.error.kind !== "not-found") return { ok: false, detail: formatSurfaceStoreError(existing.error) };
      const saved = deps.store.saveValidated(name, generated);
      if (!saved.ok) return { ok: false, detail: formatSurfaceStoreError(saved.error) };
      adopt(name, saved.value);
      return { ok: true, saved: false };
    },
    activeRevision: () => active?.revision ?? null,
    importDefinition(name, definition, imported) {
      const saved = deps.store.saveValidated(name, definition);
      if (!saved.ok) return { ok: false, detail: formatSurfaceStoreError(saved.error) };
      adopt(name, saved.value, imported);
      return { ok: true };
    },
    start(defaultName) {
      if (defaultName === void 0) return;
      const loaded = deps.store.read(defaultName);
      if (!loaded.ok) {
        logWarn("(WARN, BRIDGE)", `Default surface not adopted: ${formatSurfaceStoreError(loaded.error)}`);
        return;
      }
      adopt(defaultName, loaded.value);
    },
    handleUiFrame(frame, clientId) {
      switch (frame.type) {
        case "surfaceRequest": {
          deps.publish(listFrame(), clientId);
          const current = surfaceFrame();
          if (current !== null) deps.publish(current, clientId);
          return true;
        }
        case "surfaceLoad": {
          const loaded = deps.store.read(frame.name);
          if (!loaded.ok) {
            reject(clientId, "surface-rejected", formatSurfaceStoreError(loaded.error));
            return true;
          }
          adopt(frame.name, loaded.value);
          return true;
        }
        case "surfaceSave": {
          const saved = deps.store.save(frame.name, frame.definition);
          if (!saved.ok) {
            reject(clientId, "surface-rejected", formatSurfaceStoreError(saved.error));
            return true;
          }
          if (frame.activate === false) deps.publish(listFrame());
          else adopt(frame.name, saved.value);
          return true;
        }
        default:
          return false;
      }
    },
    handleHttp(request, response) {
      let url;
      try {
        url = new URL(request.url ?? "/", "http://localhost");
      } catch {
        return respondText(response, 400, "bad request");
      }
      if (url.pathname === "/surfaces") {
        if (request.method !== "GET") return respondText(response, 405, "method not allowed");
        return respondJson(response, 200, { names: deps.store.list(), active: active?.name ?? null });
      }
      const match = SURFACE_PATH.exec(url.pathname);
      if (match === null) return false;
      const name = match[1];
      if (!isValidSurfaceName(name)) return respondText(response, 400, "invalid surface name");
      if (request.method === "GET") {
        const raw = deps.store.readRaw(name);
        if (!raw.ok) return respondText(response, raw.error.kind === "not-found" ? 404 : 500, formatSurfaceStoreError(raw.error));
        response.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${name}.json"`
        });
        response.end(raw.value);
        return true;
      }
      if (request.method === "PUT") {
        readBody(request, MAX_UPLOAD_BYTES).then((body) => {
          if (body === null) return void respondText(response, 413, "payload too large");
          let json;
          try {
            json = JSON.parse(body.replace(/^﻿/, ""));
          } catch (error) {
            return void respondText(response, 400, `invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
          }
          const saved = deps.store.save(name, json);
          if (!saved.ok) {
            return void respondText(response, saved.error.kind === "write-failed" ? 500 : 422, formatSurfaceStoreError(saved.error));
          }
          if (url.searchParams.get("activate") === "0") deps.publish(listFrame());
          else adopt(name, saved.value);
          respondJson(response, 200, { name, active: active?.name ?? null });
        }).catch(() => respondText(response, 500, "upload failed"));
        return true;
      }
      return respondText(response, 405, "method not allowed");
    }
  };
}
function respondText(response, status, text) {
  if (!response.headersSent) response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(text);
  return true;
}
function respondJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
  return true;
}
function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks2 = [];
    let size = 0;
    let exceeded = false;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        exceeded = true;
        chunks2.length = 0;
        return;
      }
      if (!exceeded) chunks2.push(chunk);
    });
    request.on("end", () => resolve(exceeded ? null : Buffer.concat(chunks2).toString("utf8")));
    request.on("error", reject);
  });
}

// src/bridge-server.ts
var TEST_NETWORK_INTERFACES_ENV_VAR = "OSCDESK_TEST_NETWORK_INTERFACES";
var TEST_LAN_SCAN_FILE_ENV_VAR = "OSCDESK_TEST_LAN_SCAN_FILE";
async function startBridgeServer(options) {
  let udp;
  let hub;
  let core;
  let surfaces;
  let pads;
  let projects;
  let desiredValuesStore;
  let sentLog;
  let catalog;
  let destinations;
  let locks;
  let blueprints;
  const logWarn = options.logWarn ?? console.warn;
  const logError = options.logError ?? console.error;
  const oscListenPort = options.config.bridge.oscListenPort;
  const wsPort = options.config.bridge.wsPort;
  try {
    const ownAddresses = localIpv4Addresses(createNetworkInterfacesProvider()());
    const unityAddresses = withLoopbackAlias(
      options.config.unity.host,
      await resolveUnityAddresses(options.config.unity.host, logWarn),
      ownAddresses
    );
    const secondaryAddresses = {};
    for (const target of options.config.unity.secondary) {
      secondaryAddresses[target.name] = withLoopbackAlias(target.host, await resolveUnityAddresses(target.host, logWarn), ownAddresses);
    }
    const adapter = createOscAdapter({
      transport: () => udp,
      handlers: () => ({
        delivered: (message) => core?.handleOscIn(message),
        alive: (message) => core?.handleOscIn(message),
        // 設計図(D-104)は core の手前で受ける。core は /sys/* を読み捨てるだけなので、先に取らないと届かない
        blueprint: (message) => catalog?.handleOscIn(message) === true,
        // 対象なし・処理失敗(HID-375)は送り先ブロックの点灯(HID-376)で使う。今は受けて捨てる(UI へ生の OSC として流さない)
        unbound: () => {
        },
        failed: () => {
        }
      })
    });
    udp = await startUdpTransport({
      host: options.config.bridge.oscListenHost,
      port: oscListenPort,
      onMessage: (message) => adapter.receive(message),
      onDecodeError: (error, from) => logWarn("(WARN, BRIDGE)", "OSC decode failed", from, error),
      onSocketError: (error) => logError("(ERROR, BRIDGE)", "UDP socket error", error)
    });
    hub = await startUiHub({
      host: options.config.bridge.wsHost,
      port: wsPort,
      onConnect: (clientId) => {
        core?.onUiConnected(clientId);
        sentLog?.publishBacklog(clientId);
        destinations?.publish(clientId);
        catalog?.publish(clientId);
        locks?.publish(clientId);
        blueprints?.publish(clientId);
      },
      onDisconnect: (clientId) => {
        locks?.releaseConnection(clientId);
        core?.onUiDisconnected(clientId);
      },
      onFrame: (frame, clientId) => {
        if (locks?.handleUiFrame(frame, clientId) === true) return;
        if (destinations?.handleUiFrame(frame, clientId) === true) return;
        if (catalog?.handleUiFrame(frame, clientId) === true) return;
        if (blueprints?.handleUiFrame(frame, clientId) === true) return;
        if (projects?.handleUiFrame(frame, clientId) === true) return;
        if (pads?.handleUiFrame(frame, clientId) === true) return;
        if (surfaces?.handleUiFrame(frame, clientId) === true) {
          if (frame.type === "surfaceRequest") {
            core?.publishDesired(clientId);
            core?.publishRuntimeOptions(clientId);
            core?.publishDesiredStatus(clientId);
          }
          return;
        }
        if (frame.type === "set" && frame.revision !== void 0 && frame.revision !== surfaces?.activeRevision()) {
          hub?.sendTo(clientId, { v: 1, type: "notice", level: "warn", code: "set-rejected", detail: `stale-surface: ${frame.param}` });
          return;
        }
        core?.handleUiFrame(frame, clientId);
      },
      onHttpRequest: (request, response) => surfaces?.handleHttp(request, response) ?? false,
      onHttpRejected: (method, origin, peer) => logWarn("(WARN, BRIDGE)", "Rejected browser-originated HTTP request", { method, origin: origin.slice(0, 200), peer }),
      onHandshakeRejected: (origin, peer) => logWarn("(WARN, BRIDGE)", "Rejected browser-originated WebSocket handshake", { origin: origin.slice(0, 200), peer }),
      onInvalidFrame: (clientId, reason, raw) => logWarn("(WARN, BRIDGE)", "Invalid UI frame", { clientId, reason, raw })
    });
    const valuesDir = options.config.surfaces.valuesDir ?? import_node_path12.default.join(options.config.surfaces.dir, DEFAULT_VALUES_DIR_NAME);
    desiredValuesStore = createDesiredValuesFileStore({
      dir: valuesDir,
      fs: nodeDesiredValuesFs,
      logWarn
    });
    locks = createLockManager({
      publish: (frame, target) => target === void 0 ? hub?.broadcast(frame) : hub?.sendTo(target, frame)
    });
    const activeLocks = locks;
    sentLog = createSentLog({
      publish: (frame, target) => target === void 0 ? hub?.broadcast(frame) : hub?.sendTo(target, frame)
    });
    core = createSurfaceCore({
      desiredValuesStore,
      onRespondersChanged: () => destinations?.publish(),
      onSent: (event) => sentLog?.record(event),
      config: options.config,
      unityAddresses,
      secondaryAddresses,
      adapterKinds: [adapter.kind],
      lockedBy: (refs, clientId, holder) => activeLocks.blockingOwner(refs, clientId, holder)?.label ?? null,
      // 生成の名前の割り当てと「記録に合わせる」は、全 PC の設計図を見る(HID-385)
      catalogPcs: () => catalog?.pcs() ?? [],
      sendFn: (host, port, address, ...args) => adapter.sendValue({ host, port }, address, args),
      sendBundleFn: (host, port, messages) => adapter.sendValues({ host, port }, messages.map((message) => ({
        address: message.address,
        args: [...message.args]
      }))),
      publish: (frame, target) => target === void 0 ? hub?.broadcast(frame) : hub?.sendTo(target, frame),
      logInfo: options.logInfo,
      logWarn: options.logWarn,
      logError: options.logError,
      createDiagnosticsEngine: (deps) => createDiagnosticsEngine({
        ...deps,
        interfacesProvider: createNetworkInterfacesProvider(),
        fs: nodeFs,
        logError
      })
    });
    const catalogCore = core;
    catalog = createCatalogManager({
      publish: (frame, target) => {
        if (target === void 0) hub?.broadcast(frame);
        else hub?.sendTo(target, frame);
        if (target === void 0) blueprints?.refresh();
      },
      requestFromTargets: () => catalogCore.requestCatalog(),
      // 起動の合図で生成の記録と保持値をその PC へ送り直し、削除通知で記録を外す(HID-385)
      onTargetStarted: (host) => catalogCore.onTargetStarted(host),
      onItemRemoved: (host, address) => catalogCore.onCatalogItemRemoved(host, address),
      onItemAdded: (host, address) => catalogCore.onCatalogItemAdded(host, address),
      logInfo: options.logInfo,
      logWarn: options.logWarn
    });
    surfaces = createSurfaceManager({
      store: createSurfaceStore({ dir: options.config.surfaces.dir }),
      onAdopt: (definition, name, imported) => {
        core?.setDefinition(definition, name, imported);
        blueprints?.refresh();
      },
      publish: (frame, target) => target === void 0 ? hub?.broadcast(frame) : hub?.sendTo(target, frame),
      logInfo: options.logInfo,
      logWarn: options.logWarn
    });
    const activeCatalog = catalog;
    const activeSurfaces = surfaces;
    blueprints = createBlueprintManager({
      pcs: () => activeCatalog.pcs(),
      active: () => activeSurfaces.active(),
      adoptBlueprint: (name, generated) => activeSurfaces.adoptBlueprint(name, generated),
      publish: (frame, target) => target === void 0 ? hub?.broadcast(frame) : hub?.sendTo(target, frame),
      logInfo: options.logInfo
    });
    const activeCore = core;
    destinations = createDestinations({
      configTargets: resolveUnityTargets(options.config.unity).map((target) => ({
        ...target,
        addresses: (target.primary ? unityAddresses : secondaryAddresses[target.name]) ?? []
      })),
      sendPort: options.config.unity.sendPort,
      interfaces: createNetworkInterfacesProvider(),
      prober: createLanProber(process.env),
      hostnameResolver: createHostnameResolver(process.env),
      localHostname: () => cleanLocalHostname(import_node_os.default.hostname()),
      store: createDestinationSelectionFile({
        file: options.config.destinations.file ?? import_node_path12.default.join(valuesDir, DEFAULT_DESTINATIONS_FILE_NAME),
        fs: nodeDestinationsFs,
        logWarn
      }),
      // 端末の別名(D-092)。既定は選択と同じフォルダの `.device-aliases.json`
      aliasStore: createDeviceAliasFile({
        file: options.config.destinations.aliasesFile ?? import_node_path12.default.join(valuesDir, DEFAULT_DEVICE_ALIASES_FILE_NAME),
        fs: nodeDestinationsFs,
        logWarn
      }),
      scanTimeoutMs: options.config.destinations.scanTimeoutMs,
      applyTargets: (targets) => activeCore.setTargets(targets),
      currentTargets: () => activeCore.currentTargets(),
      primaryHosts: () => activeCore.primaryHosts(),
      publish: (frame, target) => target === void 0 ? hub?.broadcast(frame) : hub?.sendTo(target, frame),
      logInfo: options.logInfo,
      logWarn: options.logWarn
    });
    const padsDir = options.config.surfaces.padsDir ?? import_node_path12.default.join(options.config.surfaces.dir, DEFAULT_PADS_DIR_NAME);
    const padCore = core;
    pads = createPadManager({
      // 大きすぎるパッドは保存も採用もしない(起動時の復元でも同じ検証を通るので、UI が受け切れないパッドで詰まない)
      store: createNamedJsonStore({ dir: padsDir, schema: OscPadStoredSchema }),
      activeStore: createPadActiveFile({ dir: padsDir, fs: nodePadActiveFs, logWarn }),
      fire: (address, args) => padCore.firePad(address, args),
      publish: (frame, target) => target === void 0 ? hub?.broadcast(frame) : hub?.sendTo(target, frame),
      logInfo: options.logInfo,
      logWarn: options.logWarn
    });
    projects = createProjectManager({
      surfaces,
      pads,
      heldValues: () => padCore.exportDesired(),
      publish: (frame, target) => target === void 0 ? hub?.broadcast(frame) : hub?.sendTo(target, frame),
      logInfo: options.logInfo,
      logWarn: options.logWarn
    });
    surfaces.start(options.config.surfaces.defaultName);
    destinations.start();
    pads.start();
    core.start();
    return {
      wsPort: hub.port,
      oscListenPort: udp.port,
      async close() {
        destinations?.close();
        catalog?.close();
        locks?.close();
        core?.stop();
        sentLog?.close();
        desiredValuesStore?.close();
        await Promise.all([hub?.close(), udp?.close()]);
      }
    };
  } catch (error) {
    destinations?.close();
    catalog?.close();
    locks?.close();
    core?.stop();
    sentLog?.close();
    desiredValuesStore?.close();
    await Promise.allSettled([hub?.close(), udp?.close()]);
    throw error;
  }
}
var nodeFs = import_node_fs4.default;
var nodeDesiredValuesFs = import_node_fs4.default;
var nodeDestinationsFs = import_node_fs4.default;
var DEFAULT_VALUES_DIR_NAME = ".values";
var DEFAULT_PADS_DIR_NAME = "pads";
var nodePadActiveFs = import_node_fs4.default;
async function resolveUnityAddresses(host, logWarn) {
  if (import_node_net2.default.isIP(host) !== 0) return [];
  try {
    const results = await (0, import_promises2.lookup)(host, { all: true });
    return results.map((result) => result.address);
  } catch (error) {
    logWarn("(WARN, BRIDGE)", `Failed to resolve unity.host "${host}".`, error);
    return [];
  }
}
function createNetworkInterfacesProvider() {
  const override = readNetworkInterfacesOverride(process.env);
  if (override !== null) return () => override;
  return () => Object.entries(import_node_os.default.networkInterfaces()).flatMap(
    ([name, entries]) => (entries ?? []).map((entry) => ({
      name,
      address: entry.address,
      netmask: entry.netmask,
      family: entry.family === "IPv4" ? "IPv4" : "IPv6",
      internal: entry.internal,
      mac: entry.mac
    }))
  );
}
function createHostnameResolver(env) {
  const file = env[TEST_LAN_SCAN_FILE_ENV_VAR];
  return file === void 0 || file.trim() === "" ? createSystemHostnameResolver() : NO_HOSTNAMES;
}
function cleanLocalHostname(name) {
  return name.trim() === "" ? null : name.trim();
}
function createLanProber(env) {
  const file = env[TEST_LAN_SCAN_FILE_ENV_VAR];
  if (file === void 0 || file.trim() === "") return createSystemLanProber();
  return {
    async probe(_subnets, signal) {
      const parsed = JSON.parse(await import_node_fs4.default.promises.readFile(file, { encoding: "utf8", signal }));
      const isEntry = (entry) => typeof entry === "string" ? isIpv4(entry) : typeof entry === "object" && entry !== null && typeof entry.host === "string" && isIpv4(entry.host) && normalizeMac(entry.mac) !== null;
      if (!Array.isArray(parsed) || !parsed.every(isEntry)) {
        throw new Error(`${TEST_LAN_SCAN_FILE_ENV_VAR} must point to a JSON array of IPv4 addresses or { host, mac } objects.`);
      }
      return parsed.map((entry) => typeof entry === "string" ? { host: entry, mac: null } : { host: entry.host, mac: normalizeMac(entry.mac) });
    }
  };
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
    name: typeof candidate.name === "string" && candidate.name.length > 0 ? candidate.name : `if${String(index)}`,
    address: candidate.address,
    netmask: candidate.netmask,
    family: candidate.family,
    internal: candidate.internal,
    ...typeof candidate.mac === "string" ? { mac: candidate.mac } : {}
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
