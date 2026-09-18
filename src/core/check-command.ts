/** The deterministic command grammar shared by graph admission and confinement. */
export type CheckCommandContractDetail =
  | "ARGUMENT_COUNT_INVALID"
  | "EMPTY_ARGUMENT"
  | "COMMAND_PREFIX_INVALID"
  | "NAME_PATTERN_INVALID"
  | "TEST_COUNT_INVALID"
  | "DUPLICATE_TEST_PATH"
  | "PERMISSION_ARGUMENT_FORBIDDEN"
  | "TEST_PATH_INVALID";

export type CheckCommandContractInvalid = Readonly<{
  status: "invalid";
  reasonCode: "CHECK_COMMAND_CONTRACT_INVALID";
  detail: CheckCommandContractDetail;
  invalidPaths?: readonly string[];
}>;

export type CheckCommandInspection =
  | Readonly<{ status: "valid"; testPaths: readonly string[] }>
  | CheckCommandContractInvalid;

function invalid(detail: CheckCommandContractDetail, invalidPaths?: readonly string[]): CheckCommandContractInvalid {
  return Object.freeze({
    status: "invalid",
    reasonCode: "CHECK_COMMAND_CONTRACT_INVALID",
    detail,
    ...(invalidPaths === undefined ? {} : { invalidPaths: Object.freeze([...invalidPaths]) }),
  });
}

/** Syntax only: no filesystem, process, host-feature, or execution-authority reads. */
export function inspectCheckCommand(command: readonly string[]): CheckCommandInspection {
  if (command.length < 4 || command.length > 12) return invalid("ARGUMENT_COUNT_INVALID");
  if (command.some((argument) => argument.length === 0)) return invalid("EMPTY_ARGUMENT");
  if (command[0] !== "node" || command[1] !== "--test" || command[2] !== "--test-isolation=none") {
    return invalid("COMMAND_PREFIX_INVALID");
  }
  const optionalNamePattern = command[3]?.startsWith("--test-name-pattern=") === true ? command[3] : undefined;
  if (optionalNamePattern !== undefined && !/^--test-name-pattern=[A-Za-z0-9._-]+$/u.test(optionalNamePattern)) {
    return invalid("NAME_PATTERN_INVALID");
  }
  const tests = command.slice(optionalNamePattern === undefined ? 3 : 4);
  if (tests.length < 1 || tests.length > 8) return invalid("TEST_COUNT_INVALID");
  if (new Set(tests).size !== tests.length) return invalid("DUPLICATE_TEST_PATH");
  const invalidPaths = tests.filter((path) => !path.endsWith(".test.ts") || path.split("/").some((segment) =>
    segment.length === 0 || segment === "." || segment === ".." || !/^[A-Za-z0-9._-]+$/u.test(segment)));
  if (invalidPaths.length !== 0) {
    // The fixed grammar already excludes permission flags. Classify rejected
    // flags syntactically, without depending on this host's Node feature set.
    const permissionArgument = invalidPaths.some((argument) => {
      if (!argument.startsWith("--")) return false;
      const normalized = argument.split("=", 1)[0]!.replaceAll("_", "-");
      return normalized === "--permission" || normalized === "--no-permission"
        || normalized.startsWith("--allow-") || normalized.startsWith("--no-allow-");
    });
    return invalid(permissionArgument ? "PERMISSION_ARGUMENT_FORBIDDEN" : "TEST_PATH_INVALID", invalidPaths);
  }
  return Object.freeze({ status: "valid", testPaths: Object.freeze(tests) });
}
