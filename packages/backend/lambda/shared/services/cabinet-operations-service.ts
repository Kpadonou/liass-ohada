import type {
  AccountingWork,
  AccountingWorkStatus,
  CreateAccountingWorkRequest,
  CreateCabinetDeadlineRequest,
  CabinetDeadline,
  CabinetDeadlineStatus,
  ListAccountingWorksRequest,
  ListCabinetDeadlinesRequest,
  UpdateAccountingWorkRequest,
  UpdateAccountingWorkStatusRequest,
  UpdateCabinetDeadlineRequest,
  UpdateCabinetDeadlineStatusRequest,
} from "@liass-ohada/shared";
import {
  AccountingWorkSchema,
  CabinetDeadlineSchema,
  CreateAccountingWorkRequestSchema,
  CreateCabinetDeadlineRequestSchema,
  ListAccountingWorksRequestSchema,
  ListAccountingWorksResponseSchema,
  ListCabinetDeadlinesRequestSchema,
  ListCabinetDeadlinesResponseSchema,
  UpdateAccountingWorkRequestSchema,
  UpdateAccountingWorkStatusRequestSchema,
  UpdateCabinetDeadlineRequestSchema,
  UpdateCabinetDeadlineStatusRequestSchema,
} from "@liass-ohada/shared";
import { randomUUID } from "crypto";
import { AppError } from "../app-error";
import { KeyFactory } from "../key-builder";
import {
  CabinetOperationsRepository,
  CabinetWorkRecord,
  CabinetDeadlineRecord,
} from "../repositories/cabinet-operations-repository";
import {
  CabinetDossierRecord,
  CabinetMemberRecord,
  CabinetTeamRepository,
} from "../repositories/cabinet-team-repository";
import { CabinetAuthorizationService } from "./cabinet-authorization-service";

interface CabinetContext {
  cabinetId?: string;
  orgId: string;
  userId: string;
  workspaceType?: "COMPANY" | "ACCOUNTING_FIRM";
}

const manageableRoles = new Set(["CABINET_ADMIN", "SUPERVISOR"]);
const assignableRoles = new Set(["CABINET_ADMIN", "SUPERVISOR", "COLLABORATOR"]);
const workTransitions: Record<AccountingWorkStatus, AccountingWorkStatus[]> = {
  TO_PLAN: ["TO_DO", "IN_PROGRESS", "CANCELLED"],
  TO_DO: ["IN_PROGRESS", "WAITING", "COMPLETED", "CANCELLED"],
  IN_PROGRESS: ["WAITING", "COMPLETED", "CANCELLED"],
  WAITING: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};
const deadlineTransitions: Record<CabinetDeadlineStatus, CabinetDeadlineStatus[]> = {
  PENDING: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

function currentDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

function assertAccountingFirmContext(context: CabinetContext): string {
  if (context.workspaceType !== "ACCOUNTING_FIRM" || !context.cabinetId) {
    throw new AppError(403, "ERROR_CABINET_WORKSPACE_REQUIRED");
  }
  return context.cabinetId;
}

function audit(event: string, payload: Record<string, unknown>) {
  console.info(`[CABINET_OPERATIONS_AUDIT] ${event}`, payload);
}

function workDto(work: CabinetWorkRecord | undefined): AccountingWork {
  if (!work) throw new AppError(404, "CABINET_WORK_NOT_FOUND");
  const {
    GSI1PK: _gsi1pk,
    GSI1SK: _gsi1sk,
    GSI2PK: _gsi2pk,
    GSI2SK: _gsi2sk,
    GSI3PK: _gsi3pk,
    GSI3SK: _gsi3sk,
    PK: _pk,
    SK: _sk,
    entityType: _entityType,
    ...dto
  } = work as CabinetWorkRecord & {
    PK?: string;
    SK?: string;
    entityType?: string;
  };
  return AccountingWorkSchema.parse(dto);
}

function deadlineDto(deadline: CabinetDeadlineRecord | undefined): CabinetDeadline {
  if (!deadline) throw new AppError(404, "CABINET_DEADLINE_NOT_FOUND");
  const {
    GSI1PK: _gsi1pk,
    GSI1SK: _gsi1sk,
    GSI2PK: _gsi2pk,
    GSI2SK: _gsi2sk,
    GSI3PK: _gsi3pk,
    GSI3SK: _gsi3sk,
    PK: _pk,
    SK: _sk,
    entityType: _entityType,
    ...dto
  } = deadline as CabinetDeadlineRecord & {
    PK?: string;
    SK?: string;
    entityType?: string;
  };
  return CabinetDeadlineSchema.parse(dto);
}

function workIndexPatch(work: AccountingWork): Partial<CabinetWorkRecord> {
  return {
    GSI1SK: KeyFactory.cabinetWorkGSI_SK(work.dueDate, work.workId),
    GSI2SK: KeyFactory.cabinetWorkGSI_SK(work.dueDate, work.workId),
    GSI3PK: work.responsibleUserId
      ? KeyFactory.cabinetResponsibleWorksGSI_PK(
          work.cabinetOrgId,
          work.responsibleUserId,
        )
      : undefined,
    GSI3SK: work.responsibleUserId
      ? KeyFactory.cabinetWorkGSI_SK(work.dueDate, work.workId)
      : undefined,
  };
}

function deadlineIndexPatch(
  deadline: CabinetDeadline,
): Partial<CabinetDeadlineRecord> {
  return {
    GSI1SK: KeyFactory.cabinetDeadlineGSI_SK(
      deadline.dueDate,
      deadline.deadlineId,
    ),
    GSI2SK: KeyFactory.cabinetDeadlineGSI_SK(
      deadline.dueDate,
      deadline.deadlineId,
    ),
    GSI3PK: deadline.responsibleUserId
      ? KeyFactory.cabinetResponsibleDeadlinesGSI_PK(
          deadline.cabinetOrgId,
          deadline.responsibleUserId,
        )
      : undefined,
    GSI3SK: deadline.responsibleUserId
      ? KeyFactory.cabinetDeadlineGSI_SK(
          deadline.dueDate,
          deadline.deadlineId,
        )
      : undefined,
  };
}

async function authorize(context: CabinetContext) {
  assertAccountingFirmContext(context);
  return CabinetAuthorizationService.requireActiveMembership({
    orgId: context.orgId,
    userId: context.userId,
    cabinetId: context.cabinetId,
    workspaceType: context.workspaceType,
  });
}

async function getActiveDossier(
  cabinetId: string,
  dossierOrgId: string,
): Promise<CabinetDossierRecord> {
  const [dossier] = await CabinetTeamRepository.getCurrentDossiers(cabinetId, [
    dossierOrgId,
  ]);
  if (
    !dossier ||
    dossier.cabinetId !== cabinetId ||
    dossier.relationship !== "CLIENT" ||
    dossier.status !== "ACTIVE"
  ) {
    throw new AppError(403, "CABINET_WORK_DOSSIER_FORBIDDEN");
  }
  return dossier;
}

async function assertDossierAccess(input: {
  cabinetOrgId: string;
  dossierOrgId: string;
  forbiddenCode?: string;
  member: CabinetMemberRecord;
}): Promise<void> {
  if (input.member.cabinetRole === "CABINET_ADMIN") return;
  const assignment = await CabinetTeamRepository.getAssignment({
    cabinetOrgId: input.cabinetOrgId,
    dossierOrgId: input.dossierOrgId,
    userId: input.member.userId,
  });
  if (!assignment) {
    throw new AppError(
      403,
      input.forbiddenCode ?? "CABINET_WORK_DOSSIER_FORBIDDEN",
    );
  }
}

async function assignedDossierSet(
  cabinetOrgId: string,
  member: CabinetMemberRecord,
): Promise<Set<string> | undefined> {
  if (member.cabinetRole === "CABINET_ADMIN") return undefined;
  const assignments = await CabinetTeamRepository.listMemberAssignments(
    cabinetOrgId,
    member.userId,
  );
  return new Set(assignments.map((assignment) => assignment.dossierOrgId));
}

async function validateAssignable(input: {
  cabinetOrgId: string;
  dossierOrgId: string;
  errorPrefix: "CABINET_WORK" | "CABINET_DEADLINE";
  userId?: string;
}): Promise<CabinetMemberRecord | undefined> {
  if (!input.userId) return undefined;
  const member = await CabinetTeamRepository.getMember(
    input.cabinetOrgId,
    input.userId,
  );
  if (
    !member ||
    member.status !== "ACTIVE" ||
    !member.cabinetRole ||
    !assignableRoles.has(member.cabinetRole)
  ) {
    const invalidCode =
      input.errorPrefix === "CABINET_DEADLINE"
        ? "CABINET_DEADLINE_RESPONSIBLE_INVALID"
        : "CABINET_WORK_ASSIGNEE_INVALID";
    throw new AppError(
      403,
      member?.cabinetRole === "READER"
        ? `${input.errorPrefix}_READER_NOT_ASSIGNABLE`
        : invalidCode,
    );
  }
  if (member.cabinetRole !== "CABINET_ADMIN") {
    const assignment = await CabinetTeamRepository.getAssignment({
      cabinetOrgId: input.cabinetOrgId,
      dossierOrgId: input.dossierOrgId,
      userId: input.userId,
    });
    if (!assignment) {
      throw new AppError(
        403,
        input.errorPrefix === "CABINET_DEADLINE"
          ? "CABINET_DEADLINE_RESPONSIBLE_INVALID"
          : "CABINET_WORK_ASSIGNEE_INVALID",
      );
    }
  }
  return member;
}

async function validateParticipants(input: {
  cabinetOrgId: string;
  dossierOrgId: string;
  participantUserIds: string[];
}): Promise<void> {
  for (const userId of input.participantUserIds) {
    await validateAssignable({
      cabinetOrgId: input.cabinetOrgId,
      dossierOrgId: input.dossierOrgId,
      errorPrefix: "CABINET_WORK",
      userId,
    });
  }
}

function assertWorkTransition(input: {
  actor: CabinetMemberRecord;
  current: AccountingWork;
  nextStatus: AccountingWorkStatus;
}) {
  if (!workTransitions[input.current.status].includes(input.nextStatus)) {
    throw new AppError(409, "CABINET_WORK_STATUS_TRANSITION_INVALID");
  }
  if (input.actor.cabinetRole === "READER") {
    throw new AppError(403, "CABINET_WORK_STATUS_UPDATE_FORBIDDEN");
  }
  if (input.actor.cabinetRole === "COLLABORATOR") {
    const assigned =
      input.current.responsibleUserId === input.actor.userId ||
      input.current.participantUserIds.includes(input.actor.userId);
    if (!assigned || input.nextStatus === "CANCELLED") {
      throw new AppError(
        403,
        input.nextStatus === "CANCELLED"
          ? "CABINET_WORK_CANCEL_FORBIDDEN"
          : "CABINET_WORK_STATUS_UPDATE_FORBIDDEN",
      );
    }
    if (!["IN_PROGRESS", "WAITING", "COMPLETED"].includes(input.nextStatus)) {
      throw new AppError(403, "CABINET_WORK_STATUS_UPDATE_FORBIDDEN");
    }
  }
}

function assertDeadlineTransition(input: {
  actor: CabinetMemberRecord;
  current: CabinetDeadline;
  nextStatus: CabinetDeadlineStatus;
}) {
  if (!deadlineTransitions[input.current.status].includes(input.nextStatus)) {
    throw new AppError(409, "CABINET_DEADLINE_STATUS_TRANSITION_INVALID");
  }
  if (input.actor.cabinetRole === "READER") {
    throw new AppError(403, "CABINET_DEADLINE_STATUS_UPDATE_FORBIDDEN");
  }
  if (input.actor.cabinetRole === "COLLABORATOR") {
    if (
      input.nextStatus !== "COMPLETED" ||
      input.current.responsibleUserId !== input.actor.userId
    ) {
      throw new AppError(403, "CABINET_DEADLINE_STATUS_UPDATE_FORBIDDEN");
    }
  }
}

export class CabinetOperationsService {
  static async createWork(
    context: CabinetContext,
    data: CreateAccountingWorkRequest,
  ) {
    const request = CreateAccountingWorkRequestSchema.parse(data);
    const authorized = await authorize(context);
    if (!manageableRoles.has(authorized.caller.cabinetRole ?? "")) {
      throw new AppError(403, "CABINET_WORK_STATUS_UPDATE_FORBIDDEN");
    }
    const cabinetId = assertAccountingFirmContext(context);
    const dossier = await getActiveDossier(cabinetId, request.dossierOrgId);
    await assertDossierAccess({
      cabinetOrgId: authorized.cabinetOrgId,
      dossierOrgId: request.dossierOrgId,
      member: authorized.caller,
    });
    await validateAssignable({
      cabinetOrgId: authorized.cabinetOrgId,
      dossierOrgId: request.dossierOrgId,
      errorPrefix: "CABINET_WORK",
      userId: request.responsibleUserId,
    });
    await validateParticipants({
      cabinetOrgId: authorized.cabinetOrgId,
      dossierOrgId: request.dossierOrgId,
      participantUserIds: request.participantUserIds,
    });
    const now = new Date().toISOString();
    const work = AccountingWorkSchema.parse({
      ...request,
      workId: `wrk-${randomUUID()}`,
      cabinetOrgId: authorized.cabinetOrgId,
      dossierName: dossier.displayName,
      status: "TO_DO",
      createdBy: context.userId,
      createdAt: now,
      updatedBy: context.userId,
      updatedAt: now,
    });
    await CabinetOperationsRepository.createWork(work);
    audit("WORK_CREATED", {
      actorUserId: context.userId,
      cabinetOrgId: work.cabinetOrgId,
      dossierOrgId: work.dossierOrgId,
      workId: work.workId,
      timestamp: now,
    });
    return { work };
  }

  static async getWork(context: CabinetContext, workId: string) {
    const authorized = await authorize(context);
    const work = await CabinetOperationsRepository.getWork(
      authorized.cabinetOrgId,
      workId,
    );
    if (!work) throw new AppError(404, "CABINET_WORK_NOT_FOUND");
    await assertDossierAccess({
      cabinetOrgId: authorized.cabinetOrgId,
      dossierOrgId: work.dossierOrgId,
      member: authorized.caller,
    });
    return { work: workDto(work) };
  }

  static async listWorks(
    context: CabinetContext,
    data: ListAccountingWorksRequest,
  ) {
    const request = ListAccountingWorksRequestSchema.parse(data);
    const authorized = await authorize(context);
    const dossierOrgIds = await assignedDossierSet(
      authorized.cabinetOrgId,
      authorized.caller,
    );
    if (request.dossierOrgId) {
      await assertDossierAccess({
        cabinetOrgId: authorized.cabinetOrgId,
        dossierOrgId: request.dossierOrgId,
        forbiddenCode: "CABINET_WORK_DOSSIER_FORBIDDEN",
        member: authorized.caller,
      });
    }
    const base = {
      cursor: request.cursor,
      dueFrom: request.dueFrom,
      dueTo: request.dueTo,
      limit: request.limit ?? 50,
      periodEnd: request.periodEnd,
      periodStart: request.periodStart,
      priority: request.priority,
      status: request.status,
      type: request.type,
      dossierOrgIds,
    };
    const page = request.responsibleUserId
      ? await CabinetOperationsRepository.listWorksByResponsibleUser({
          ...base,
          cabinetOrgId: authorized.cabinetOrgId,
          responsibleUserId: request.responsibleUserId,
        })
      : request.dossierOrgId
        ? await CabinetOperationsRepository.listWorksByDossier({
            ...base,
            cabinetOrgId: authorized.cabinetOrgId,
            dossierOrgId: request.dossierOrgId,
          })
        : await CabinetOperationsRepository.listWorksByCabinet({
            ...base,
            cabinetOrgId: authorized.cabinetOrgId,
          });
    return ListAccountingWorksResponseSchema.parse({
      works: page.items.map(workDto),
      nextCursor: page.nextCursor,
    });
  }

  static async updateWork(
    context: CabinetContext,
    data: UpdateAccountingWorkRequest,
  ) {
    const request = UpdateAccountingWorkRequestSchema.parse(data);
    const authorized = await authorize(context);
    if (!manageableRoles.has(authorized.caller.cabinetRole ?? "")) {
      throw new AppError(403, "CABINET_WORK_STATUS_UPDATE_FORBIDDEN");
    }
    const current = await CabinetOperationsRepository.getWork(
      authorized.cabinetOrgId,
      request.workId,
    );
    if (!current) throw new AppError(404, "CABINET_WORK_NOT_FOUND");
    if (["COMPLETED", "CANCELLED"].includes(current.status)) {
      throw new AppError(409, "CABINET_WORK_STATUS_TRANSITION_INVALID");
    }
    await assertDossierAccess({
      cabinetOrgId: authorized.cabinetOrgId,
      dossierOrgId: current.dossierOrgId,
      member: authorized.caller,
    });
    const merged = AccountingWorkSchema.parse({
      ...current,
      ...Object.fromEntries(
        Object.entries(request).filter(([key]) => key !== "workId"),
      ),
      description:
        request.description === null ? undefined : request.description ?? current.description,
      periodStart:
        request.periodStart === null ? undefined : request.periodStart ?? current.periodStart,
      periodEnd:
        request.periodEnd === null ? undefined : request.periodEnd ?? current.periodEnd,
      startDate:
        request.startDate === null ? undefined : request.startDate ?? current.startDate,
      dueDate: request.dueDate === null ? undefined : request.dueDate ?? current.dueDate,
      responsibleUserId:
        request.responsibleUserId === null
          ? undefined
          : request.responsibleUserId ?? current.responsibleUserId,
      participantUserIds: request.participantUserIds ?? current.participantUserIds,
      updatedBy: context.userId,
      updatedAt: new Date().toISOString(),
    });
    await validateAssignable({
      cabinetOrgId: authorized.cabinetOrgId,
      dossierOrgId: current.dossierOrgId,
      errorPrefix: "CABINET_WORK",
      userId: merged.responsibleUserId,
    });
    await validateParticipants({
      cabinetOrgId: authorized.cabinetOrgId,
      dossierOrgId: current.dossierOrgId,
      participantUserIds: merged.participantUserIds,
    });
    const patch: Partial<CabinetWorkRecord> = {
      type: merged.type,
      title: merged.title,
      description: merged.description,
      periodStart: merged.periodStart,
      periodEnd: merged.periodEnd,
      startDate: merged.startDate,
      dueDate: merged.dueDate,
      priority: merged.priority,
      responsibleUserId: merged.responsibleUserId,
      participantUserIds: merged.participantUserIds,
      updatedBy: merged.updatedBy,
      updatedAt: merged.updatedAt,
      ...workIndexPatch(merged),
    };
    const work = await CabinetOperationsRepository.updateWork({
      cabinetOrgId: authorized.cabinetOrgId,
      workId: request.workId,
      patch,
    });
    audit("WORK_UPDATED", {
      actorUserId: context.userId,
      cabinetOrgId: authorized.cabinetOrgId,
      dossierOrgId: current.dossierOrgId,
      workId: request.workId,
      timestamp: merged.updatedAt,
    });
    return { work: workDto(work) };
  }

  static async updateWorkStatus(
    context: CabinetContext,
    data: UpdateAccountingWorkStatusRequest,
  ) {
    const request = UpdateAccountingWorkStatusRequestSchema.parse(data);
    const authorized = await authorize(context);
    const current = await CabinetOperationsRepository.getWork(
      authorized.cabinetOrgId,
      request.workId,
    );
    if (!current) throw new AppError(404, "CABINET_WORK_NOT_FOUND");
    await assertDossierAccess({
      cabinetOrgId: authorized.cabinetOrgId,
      dossierOrgId: current.dossierOrgId,
      member: authorized.caller,
    });
    assertWorkTransition({
      actor: authorized.caller,
      current,
      nextStatus: request.status,
    });
    if (request.currentStatus && request.currentStatus !== current.status) {
      throw new AppError(409, "CABINET_WORK_STATUS_TRANSITION_INVALID");
    }
    const now = new Date().toISOString();
    const patch: Partial<CabinetWorkRecord> = {
      status: request.status,
      updatedAt: now,
      updatedBy: context.userId,
      completedAt: request.status === "COMPLETED" ? now : current.completedAt,
      completedBy:
        request.status === "COMPLETED" ? context.userId : current.completedBy,
      cancelledAt: request.status === "CANCELLED" ? now : current.cancelledAt,
      cancelledBy:
        request.status === "CANCELLED" ? context.userId : current.cancelledBy,
    };
    try {
      const work = await CabinetOperationsRepository.updateWork({
        cabinetOrgId: authorized.cabinetOrgId,
        expectedStatus: current.status,
        patch,
        workId: request.workId,
      });
      audit("WORK_STATUS_UPDATED", {
        actorUserId: context.userId,
        cabinetOrgId: authorized.cabinetOrgId,
        dossierOrgId: current.dossierOrgId,
        previousStatus: current.status,
        newStatus: request.status,
        timestamp: now,
        workId: request.workId,
      });
      return { work: workDto(work) };
    } catch (error) {
      if (CabinetOperationsRepository.isConditionalFailure(error)) {
        throw new AppError(409, "CABINET_WORK_STATUS_TRANSITION_INVALID");
      }
      throw error;
    }
  }

  static async createDeadline(
    context: CabinetContext,
    data: CreateCabinetDeadlineRequest,
  ) {
    const request = CreateCabinetDeadlineRequestSchema.parse(data);
    const authorized = await authorize(context);
    if (!manageableRoles.has(authorized.caller.cabinetRole ?? "")) {
      throw new AppError(403, "CABINET_DEADLINE_STATUS_UPDATE_FORBIDDEN");
    }
    const cabinetId = assertAccountingFirmContext(context);
    const dossier = await getActiveDossier(cabinetId, request.dossierOrgId);
    await assertDossierAccess({
      cabinetOrgId: authorized.cabinetOrgId,
      dossierOrgId: request.dossierOrgId,
      forbiddenCode: "CABINET_DEADLINE_DOSSIER_FORBIDDEN",
      member: authorized.caller,
    });
    await validateAssignable({
      cabinetOrgId: authorized.cabinetOrgId,
      dossierOrgId: request.dossierOrgId,
      errorPrefix: "CABINET_DEADLINE",
      userId: request.responsibleUserId,
    });
    if (request.linkedWorkId) {
      const linkedWork = await CabinetOperationsRepository.getWork(
        authorized.cabinetOrgId,
        request.linkedWorkId,
      );
      if (!linkedWork) {
        throw new AppError(404, "CABINET_DEADLINE_LINKED_WORK_NOT_FOUND");
      }
      if (linkedWork.dossierOrgId !== request.dossierOrgId) {
        throw new AppError(409, "CABINET_DEADLINE_LINKED_WORK_DOSSIER_MISMATCH");
      }
    }
    const now = new Date().toISOString();
    const deadline = CabinetDeadlineSchema.parse({
      ...request,
      deadlineId: `ddl-${randomUUID()}`,
      cabinetOrgId: authorized.cabinetOrgId,
      dossierName: dossier.displayName,
      status: "PENDING",
      createdBy: context.userId,
      createdAt: now,
      updatedBy: context.userId,
      updatedAt: now,
    });
    await CabinetOperationsRepository.createDeadline(deadline);
    audit("DEADLINE_CREATED", {
      actorUserId: context.userId,
      cabinetOrgId: deadline.cabinetOrgId,
      deadlineId: deadline.deadlineId,
      dossierOrgId: deadline.dossierOrgId,
      timestamp: now,
    });
    return { deadline };
  }

  static async getDeadline(context: CabinetContext, deadlineId: string) {
    const authorized = await authorize(context);
    const deadline = await CabinetOperationsRepository.getDeadline(
      authorized.cabinetOrgId,
      deadlineId,
    );
    if (!deadline) throw new AppError(404, "CABINET_DEADLINE_NOT_FOUND");
    await assertDossierAccess({
      cabinetOrgId: authorized.cabinetOrgId,
      dossierOrgId: deadline.dossierOrgId,
      forbiddenCode: "CABINET_DEADLINE_DOSSIER_FORBIDDEN",
      member: authorized.caller,
    });
    return { deadline: deadlineDto(deadline) };
  }

  static async listDeadlines(
    context: CabinetContext,
    data: ListCabinetDeadlinesRequest,
  ) {
    const request = ListCabinetDeadlinesRequestSchema.parse(data);
    const authorized = await authorize(context);
    const dossierOrgIds = await assignedDossierSet(
      authorized.cabinetOrgId,
      authorized.caller,
    );
    if (request.dossierOrgId) {
      await assertDossierAccess({
        cabinetOrgId: authorized.cabinetOrgId,
        dossierOrgId: request.dossierOrgId,
        forbiddenCode: "CABINET_DEADLINE_DOSSIER_FORBIDDEN",
        member: authorized.caller,
      });
    }
    const dueTo = request.overdue
      ? request.dueTo ?? currentDateOnly()
      : request.dueTo;
    const base = {
      cursor: request.cursor,
      dueFrom: request.dueFrom,
      dueTo,
      limit: request.limit ?? 50,
      overdue: request.overdue,
      priority: request.priority,
      status: request.status,
      today: currentDateOnly(),
      type: request.type,
      dossierOrgIds,
    };
    const page = request.responsibleUserId
      ? await CabinetOperationsRepository.listDeadlinesByResponsibleUser({
          ...base,
          cabinetOrgId: authorized.cabinetOrgId,
          responsibleUserId: request.responsibleUserId,
        })
      : request.dossierOrgId
        ? await CabinetOperationsRepository.listDeadlinesByDossier({
            ...base,
            cabinetOrgId: authorized.cabinetOrgId,
            dossierOrgId: request.dossierOrgId,
          })
        : await CabinetOperationsRepository.listDeadlinesByCabinet({
            ...base,
            cabinetOrgId: authorized.cabinetOrgId,
          });
    return ListCabinetDeadlinesResponseSchema.parse({
      deadlines: page.items.map(deadlineDto),
      nextCursor: page.nextCursor,
    });
  }

  static async updateDeadline(
    context: CabinetContext,
    data: UpdateCabinetDeadlineRequest,
  ) {
    const request = UpdateCabinetDeadlineRequestSchema.parse(data);
    const authorized = await authorize(context);
    if (!manageableRoles.has(authorized.caller.cabinetRole ?? "")) {
      throw new AppError(403, "CABINET_DEADLINE_STATUS_UPDATE_FORBIDDEN");
    }
    const current = await CabinetOperationsRepository.getDeadline(
      authorized.cabinetOrgId,
      request.deadlineId,
    );
    if (!current) throw new AppError(404, "CABINET_DEADLINE_NOT_FOUND");
    if (["COMPLETED", "CANCELLED"].includes(current.status)) {
      throw new AppError(409, "CABINET_DEADLINE_STATUS_TRANSITION_INVALID");
    }
    await assertDossierAccess({
      cabinetOrgId: authorized.cabinetOrgId,
      dossierOrgId: current.dossierOrgId,
      forbiddenCode: "CABINET_DEADLINE_DOSSIER_FORBIDDEN",
      member: authorized.caller,
    });
    const merged = CabinetDeadlineSchema.parse({
      ...current,
      ...Object.fromEntries(
        Object.entries(request).filter(([key]) => key !== "deadlineId"),
      ),
      description:
        request.description === null ? undefined : request.description ?? current.description,
      responsibleUserId:
        request.responsibleUserId === null
          ? undefined
          : request.responsibleUserId ?? current.responsibleUserId,
      linkedWorkId:
        request.linkedWorkId === null
          ? undefined
          : request.linkedWorkId ?? current.linkedWorkId,
      updatedBy: context.userId,
      updatedAt: new Date().toISOString(),
    });
    await validateAssignable({
      cabinetOrgId: authorized.cabinetOrgId,
      dossierOrgId: current.dossierOrgId,
      errorPrefix: "CABINET_DEADLINE",
      userId: merged.responsibleUserId,
    });
    if (merged.linkedWorkId) {
      const linkedWork = await CabinetOperationsRepository.getWork(
        authorized.cabinetOrgId,
        merged.linkedWorkId,
      );
      if (!linkedWork) {
        throw new AppError(404, "CABINET_DEADLINE_LINKED_WORK_NOT_FOUND");
      }
      if (linkedWork.dossierOrgId !== current.dossierOrgId) {
        throw new AppError(409, "CABINET_DEADLINE_LINKED_WORK_DOSSIER_MISMATCH");
      }
    }
    const deadline = await CabinetOperationsRepository.updateDeadline({
      cabinetOrgId: authorized.cabinetOrgId,
      deadlineId: request.deadlineId,
      patch: {
        type: merged.type,
        title: merged.title,
        description: merged.description,
        dueDate: merged.dueDate,
        priority: merged.priority,
        responsibleUserId: merged.responsibleUserId,
        linkedWorkId: merged.linkedWorkId,
        updatedBy: merged.updatedBy,
        updatedAt: merged.updatedAt,
        ...deadlineIndexPatch(merged),
      },
    });
    audit("DEADLINE_UPDATED", {
      actorUserId: context.userId,
      cabinetOrgId: authorized.cabinetOrgId,
      deadlineId: request.deadlineId,
      dossierOrgId: current.dossierOrgId,
      timestamp: merged.updatedAt,
    });
    return { deadline: deadlineDto(deadline) };
  }

  static async updateDeadlineStatus(
    context: CabinetContext,
    data: UpdateCabinetDeadlineStatusRequest,
  ) {
    const request = UpdateCabinetDeadlineStatusRequestSchema.parse(data);
    const authorized = await authorize(context);
    const current = await CabinetOperationsRepository.getDeadline(
      authorized.cabinetOrgId,
      request.deadlineId,
    );
    if (!current) throw new AppError(404, "CABINET_DEADLINE_NOT_FOUND");
    await assertDossierAccess({
      cabinetOrgId: authorized.cabinetOrgId,
      dossierOrgId: current.dossierOrgId,
      forbiddenCode: "CABINET_DEADLINE_DOSSIER_FORBIDDEN",
      member: authorized.caller,
    });
    assertDeadlineTransition({
      actor: authorized.caller,
      current,
      nextStatus: request.status,
    });
    if (request.currentStatus && request.currentStatus !== current.status) {
      throw new AppError(409, "CABINET_DEADLINE_STATUS_TRANSITION_INVALID");
    }
    const now = new Date().toISOString();
    const patch: Partial<CabinetDeadlineRecord> = {
      status: request.status,
      updatedAt: now,
      updatedBy: context.userId,
      completedAt: request.status === "COMPLETED" ? now : current.completedAt,
      completedBy:
        request.status === "COMPLETED" ? context.userId : current.completedBy,
      cancelledAt: request.status === "CANCELLED" ? now : current.cancelledAt,
      cancelledBy:
        request.status === "CANCELLED" ? context.userId : current.cancelledBy,
    };
    try {
      const deadline = await CabinetOperationsRepository.updateDeadline({
        cabinetOrgId: authorized.cabinetOrgId,
        deadlineId: request.deadlineId,
        expectedStatus: current.status,
        patch,
      });
      audit("DEADLINE_STATUS_UPDATED", {
        actorUserId: context.userId,
        cabinetOrgId: authorized.cabinetOrgId,
        deadlineId: request.deadlineId,
        dossierOrgId: current.dossierOrgId,
        newStatus: request.status,
        previousStatus: current.status,
        timestamp: now,
      });
      return { deadline: deadlineDto(deadline) };
    } catch (error) {
      if (CabinetOperationsRepository.isConditionalFailure(error)) {
        throw new AppError(409, "CABINET_DEADLINE_STATUS_TRANSITION_INVALID");
      }
      throw error;
    }
  }
}
