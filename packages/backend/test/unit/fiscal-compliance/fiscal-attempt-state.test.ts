import {
  FiscalAttemptState,
  FiscalAttemptEvent,
  reserveFiscalAttempt,
  transitionFiscalAttempt,
  obligationIdentity,
  fiscalReconciliationRead,
} from "@/lambda/domains/fiscal-compliance/core/fiscal-attempt-state";
const digest = "a".repeat(64);
const identity = {
  orgId: "org",
  environment: "TEST" as const,
  sourceDomain: "test-source",
  sourceDocumentType: "INVOICE",
  sourceDocumentId: "invoice",
  jurisdiction: "BJ",
  obligation: "NORMALIZE",
};
const initial = () =>
  reserveFiscalAttempt({
    identity,
    attemptId: "attempt",
    provider: "BENIN_E_MECEF",
    sourceDigest: digest,
    requestDigest: digest,
    expectedTotal: 2000,
  });
const reserve = (
  operation: "CREATE" | "CONFIRM" | "CANCEL",
  commandId: string = operation,
): Extract<FiscalAttemptEvent, { kind: "RESERVE_MUTATION" }> => ({
  kind: "RESERVE_MUTATION",
  operation,
  commandId,
  intentDigest: digest,
});
const step = (s: FiscalAttemptState, e: FiscalAttemptEvent) =>
  transitionFiscalAttempt(s, identity, s.version, e).state;
const created = () =>
  step(step(initial(), reserve("CREATE")), {
    kind: "CREATED",
    commandId: "CREATE",
    uid: "uid",
    total: 2000,
  });
const security = {
  dateTime: "test-date",
  qrCode: "test-qr",
  codeMECeFDGI: "test-code",
  counters: "1/1",
  nim: "test-device",
};
const rejects = (fn: () => unknown, code: string) => {
  try {
    fn();
    throw new Error("expected rejection");
  } catch (e) {
    expect(e).toMatchObject({ code });
  }
};
test("first reservation is pure, scoped and serializable", () => {
  const s = initial();
  expect(s).toMatchObject({ status: "RESERVED", version: 1, commands: [] });
  expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  expect(s.obligationId).toBe(obligationIdentity(identity));
});
test("effect identity excludes provider and revision", () => {
  const s = initial();
  const other = reserveFiscalAttempt({
    identity,
    attemptId: "other",
    provider: "other",
    sourceDigest: "b".repeat(64),
    requestDigest: "c".repeat(64),
    expectedTotal: 1,
  });
  expect(other.obligationId).toBe(s.obligationId);
});
test("reservation advances version without mutating input", () => {
  const s = initial(),
    next = step(s, reserve("CREATE"));
  expect(next.status).toBe("CREATE_IN_FLIGHT");
  expect(next.version).toBe(2);
  expect(s.status).toBe("RESERVED");
});
test("stale competing creation proposal fails version precondition", () => {
  const s = step(initial(), reserve("CREATE"));
  rejects(
    () =>
      transitionFiscalAttempt(s, identity, 1, reserve("CREATE", "different")),
    "VERSION_CONFLICT",
  );
  rejects(() => step(s, reserve("CREATE", "different")), "TRANSITION_DENIED");
});
test("same command is replay only, including after unknown", () => {
  const s = step(step(initial(), reserve("CREATE")), {
    kind: "UNKNOWN",
    commandId: "CREATE",
  });
  expect(transitionFiscalAttempt(s, identity, 1, reserve("CREATE"))).toEqual({
    state: s,
    replay: true,
  });
});
test("changed command intent or operation conflicts", () => {
  const s = step(initial(), reserve("CREATE"));
  rejects(
    () => step(s, { ...reserve("CREATE"), intentDigest: "b".repeat(64) }),
    "INTENT_CONFLICT",
  );
  rejects(() => step(s, reserve("CONFIRM", "CREATE")), "INTENT_CONFLICT");
});
test("successful creation retains UID and total through restart then confirmation", () => {
  const s = JSON.parse(JSON.stringify(created())) as FiscalAttemptState;
  const confirmed = step(step(s, reserve("CONFIRM")), {
    kind: "CONFIRMED",
    commandId: "CONFIRM",
    security,
  });
  expect(confirmed).toMatchObject({
    status: "CONFIRMED",
    uid: "uid",
    security,
  });
});
test.each(["CONFIRM", "CANCEL"] as const)(
  "competing mutations blocked while %s in flight",
  (op) => {
    const s = step(created(), reserve(op));
    for (const next of ["CONFIRM", "CANCEL"] as const)
      rejects(() => step(s, reserve(next, "competitor")), "TRANSITION_DENIED");
  },
);
test("explicit cancellation stores security and prevents confirmation", () => {
  const s = step(step(created(), reserve("CANCEL")), {
    kind: "CANCELLED",
    commandId: "CANCEL",
    security,
  });
  expect(s.status).toBe("CANCELLED");
  rejects(() => step(s, reserve("CONFIRM")), "TRANSITION_DENIED");
});
test.each(["CREATE", "CONFIRM", "CANCEL"] as const)(
  "timeout and interrupted %s stay blocked",
  (op) => {
    const flight = step(op === "CREATE" ? initial() : created(), reserve(op));
    for (const event of [
      { kind: "UNKNOWN", commandId: op },
      { kind: "RECOVER_INTERRUPTED" },
    ] as FiscalAttemptEvent[]) {
      const s = step(JSON.parse(JSON.stringify(flight)), event);
      expect(s).toMatchObject({
        status: "UNKNOWN_OUTCOME",
        uncertainOperation: op,
      });
      rejects(() => step(s, reserve("CREATE", "new")), "TRANSITION_DENIED");
      rejects(() => step(s, reserve("CONFIRM", "new")), "TRANSITION_DENIED");
    }
  },
);
test("definite rejection is distinct and has no automatic retry transition", () => {
  const s = step(step(initial(), reserve("CREATE")), {
    kind: "DEFINITE_FAILURE",
    commandId: "CREATE",
  });
  expect(s).toMatchObject({ status: "FAILED", failedOperation: "CREATE" });
  rejects(() => step(s, reserve("CREATE", "new")), "TRANSITION_DENIED");
});
test("known UID read-only reconciliation leaves unknown unchanged", () => {
  const s = step(step(created(), reserve("CONFIRM")), {
    kind: "RECOVER_INTERRUPTED",
  });
  expect(fiscalReconciliationRead(s, identity)).toEqual({
    operation: "GET_INVOICE",
    provider: "BENIN_E_MECEF",
    uid: "uid",
  });
  expect(s.status).toBe("UNKNOWN_OUTCOME");
});
test("unknown UID requires separate manual reconciliation", () =>
  rejects(() => fiscalReconciliationRead(initial(), identity), "UID_REQUIRED"));
test.each(["orgId", "sourceDomain", "sourceDocumentId", "obligation"] as const)(
  "different %s cannot access attempt",
  (field) => {
    const scope = { ...identity, [field]: "other" };
    rejects(
      () => transitionFiscalAttempt(initial(), scope, 1, reserve("CREATE")),
      "SCOPE_DENIED",
    );
    rejects(() => fiscalReconciliationRead(created(), scope), "SCOPE_DENIED");
  },
);
test("PRODUCTION rejects", () =>
  rejects(
    () =>
      reserveFiscalAttempt({
        identity: { ...identity, environment: "PRODUCTION" },
        attemptId: "a",
        provider: "p",
        sourceDigest: digest,
        requestDigest: digest,
        expectedTotal: 1,
      } as never),
    "INVALID_INPUT",
  ));
test("mismatched provider total retains UID but blocks confirmation", () => {
  const s = step(step(initial(), reserve("CREATE")), {
    kind: "CREATED",
    commandId: "CREATE",
    uid: "uid",
    total: 1999,
  });
  expect(s.uid).toBe("uid");
  rejects(() => step(s, reserve("CONFIRM")), "TRANSITION_DENIED");
});
test("wrong command completion denied", () =>
  rejects(
    () =>
      step(step(initial(), reserve("CREATE")), {
        kind: "CREATED",
        commandId: "other",
        uid: "uid",
        total: 2000,
      }),
    "TRANSITION_DENIED",
  ));
test("credentials and raw errors cannot enter event/state or error output", () => {
  const secret = "sensitive-bearer-or-body";
  try {
    step(initial(), {
      ...reserve("CREATE"),
      credential: secret,
      errorBody: secret,
    } as never);
    throw Error("expected rejection");
  } catch (e) {
    expect(e).toMatchObject({ code: "INVALID_INPUT" });
    expect(JSON.stringify(e)).not.toContain(secret);
    expect(String(e)).not.toContain(secret);
  }
  rejects(
    () => reserveFiscalAttempt({ ...initial(), credential: secret } as never),
    "INVALID_INPUT",
  );
});
