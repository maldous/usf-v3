type UserIdentityAndTenantMembershipStatus = 'invited' | 'active' | 'disabled';
type UserIdentityAndTenantMembershipRole = 'admin' | 'member' | 'viewer';

export const UserIdentityAndTenantMembershipFailureKind = [
  'INVALID_BODY',
  'CONFLICT',
  'ALREADY_INVITED',
  'NOT_FOUND',
  'LAST_ADMIN_GUARD_INVITE',
  'LAST_ADMIN_GUARD_DEMOTE',
  'LAST_ADMIN_GUARD_REMOVE',
  'INVALID_TRANSITION',
  'PROVIDER_FAILURE',
] as const;
export type UserIdentityAndTenantMembershipFailureKind = typeof UserIdentityAndTenantMembershipFailureKind[number];

export const UserIdentityAndTenantMembershipSuccessKind = ['OK', 'CREATED'] as const;
export type UserIdentityAndTenantMembershipSuccessKind = typeof UserIdentityAndTenantMembershipSuccessKind[number];

export type UserIdentityAndTenantMembershipOutcomeKind =
  | UserIdentityAndTenantMembershipSuccessKind
  | UserIdentityAndTenantMembershipFailureKind;

export const UserIdentityAndTenantMembershipAuditEventKind = [
  'INVITE',
  'ROLE_CHANGE',
  'USERNAME_STATUS_CHANGE',
  'RESEND_INVITE',
  'REMOVE',
] as const;
export type UserIdentityAndTenantMembershipAuditEventKind = typeof UserIdentityAndTenantMembershipAuditEventKind[number];

export const UserIdentityAndTenantMembershipReadiness = ['READY', 'DEGRADED', 'NOT_READY'] as const;
export type UserIdentityAndTenantMembershipReadiness = typeof UserIdentityAndTenantMembershipReadiness[number];

export interface UserIdentityAndTenantMembershipStateRef {
  readonly organisationId: string;
  readonly userId: string;
}

export interface UserIdentityAndTenantMembershipAuditEvent {
  readonly kind: UserIdentityAndTenantMembershipAuditEventKind;
  readonly timestamp: string;
  readonly stateRef: UserIdentityAndTenantMembershipStateRef;
  readonly details: unknown;
}

export interface UserIdentityAndTenantMembershipError {
  readonly kind: UserIdentityAndTenantMembershipFailureKind;
  readonly message: string;
  readonly statusCode: 400 | 404 | 409 | 422;
}

export interface UserIdentityAndTenantMembershipSuccess<T> {
  readonly kind: UserIdentityAndTenantMembershipSuccessKind;
  readonly value: T;
  readonly statusCode: 201 | 204;
}

export type UserIdentityAndTenantMembershipResult<T> =
  | UserIdentityAndTenantMembershipSuccess<T>
  | UserIdentityAndTenantMembershipError;

export interface UserIdentityAndTenantMembership {
  readonly userId: string;
  readonly organisationId: string;
  readonly role: UserIdentityAndTenantMembershipRole;
  readonly username: string | null;
  readonly status: UserIdentityAndTenantMembershipStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastLoginAt: string | null;
  readonly inviter: string | null;
}

export interface UserIdentityAndTenantMembershipPendingInvitation {
  readonly email: string;
  readonly organisationId: string;
  readonly role: UserIdentityAndTenantMembershipRole;
  readonly invitedAt: string;
  readonly inviter: string;
  readonly token: string;
}

export interface UserIdentityAndTenantMembershipState {
  readonly members: readonly UserIdentityAndTenantMembership[];
  readonly pendingInvitations: readonly UserIdentityAndTenantMembershipPendingInvitation[];
  readonly adminCount: number;
  readonly readiness: UserIdentityAndTenantMembershipReadiness;
}

export const initialState: UserIdentityAndTenantMembershipState = {
  members: [],
  pendingInvitations: [],
  adminCount: 0,
  readiness: 'NOT_READY',
};

export interface UserIdentityAndTenantMembershipContext {
  readonly organisationId: string;
  readonly currentUserId: string;
  readonly currentUserRole: UserIdentityAndTenantMembershipRole;
  readonly permissions: readonly string[];
}

export interface UserIdentityAndTenantMembershipInviteInput {
  readonly email: string;
  readonly role: UserIdentityAndTenantMembershipRole;
}

export interface UserIdentityAndTenantMembershipUpdateRoleInput {
  readonly userId: string;
  readonly role: UserIdentityAndTenantMembershipRole;
}

export interface UserIdentityAndTenantMembershipUpdateUsernameInput {
  readonly userId: string;
  readonly username: string;
}

export interface UserIdentityAndTenantMembershipUpdateStatusInput {
  readonly userId: string;
  readonly status: UserIdentityAndTenantMembershipStatus;
}

export interface UserIdentityAndTenantMembershipRemoveInput {
  readonly userId: string;
}

export interface UserIdentityAndTenantMembershipResendInviteInput {
  readonly email: string;
}

function isValidEmail(email: string): boolean {
  const re = /^[a-z0-9!#$%&'*+\/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+\/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
  return re.test(email);
}

function toLowerEmail(email: string): string {
  return email.toLowerCase();
}

function isValidUsername(username: string): boolean {
  return /^[a-z0-9_-]{3,32}$/i.test(username);
}

function isSystemAdminRole(role: UserIdentityAndTenantMembershipRole): boolean {
  return role === 'admin' && false;
}

function countAdmins(members: readonly UserIdentityAndTenantMembership[]): number {
  return members.filter((m) => m.role === 'admin' && m.status === 'active').length;
}

function findMember(
  members: readonly UserIdentityAndTenantMembership[],
  userId: string,
): UserIdentityAndTenantMembership | null {
  return members.find((m) => m.userId === userId) ?? null;
}

function findPendingInvitation(
  pendingInvitations: readonly UserIdentityAndTenantMembershipPendingInvitation[],
  email: string,
): UserIdentityAndTenantMembershipPendingInvitation | null {
  return pendingInvitations.find((pi) => pi.email === toLowerEmail(email)) ?? null;
}

function isLastAdmin(
  members: readonly UserIdentityAndTenantMembership[],
  userId: string,
): boolean {
  const admins = members.filter((m) => m.role === 'admin' && m.status === 'active');
  if (admins.length <= 1) {
    const target = findMember(members, userId);
    return target !== null && target.role === 'admin' && target.status === 'active';
  }
  return false;
}

function canTransitionStatus(
  current: UserIdentityAndTenantMembershipStatus,
  next: UserIdentityAndTenantMembershipStatus,
): boolean {
  switch (current) {
    case 'invited':
      return next === 'active' || next === 'disabled';
    case 'active':
      return next === 'active' || next === 'disabled';
    case 'disabled':
      return next === 'active';
    default:
      return false;
  }
}

function makeError(
  kind: UserIdentityAndTenantMembershipFailureKind,
  message: string,
): UserIdentityAndTenantMembershipError {
  const statusMap: Record<UserIdentityAndTenantMembershipFailureKind, 400 | 404 | 409 | 422> = {
    INVALID_BODY: 400,
    CONFLICT: 409,
    ALREADY_INVITED: 409,
    NOT_FOUND: 404,
    LAST_ADMIN_GUARD_INVITE: 409,
    LAST_ADMIN_GUARD_DEMOTE: 409,
    LAST_ADMIN_GUARD_REMOVE: 409,
    INVALID_TRANSITION: 422,
    PROVIDER_FAILURE: 422,
  };
  return {
    kind,
    message,
    statusCode: statusMap[kind],
  };
}

function makeSuccess<T>(
  kind: UserIdentityAndTenantMembershipSuccessKind,
  value: T,
): UserIdentityAndTenantMembershipSuccess<T> {
  const statusMap: Record<UserIdentityAndTenantMembershipSuccessKind, 201 | 204> = {
    OK: 204,
    CREATED: 201,
  };
  return {
    kind,
    value,
    statusCode: statusMap[kind],
  };
}

function validateInviteInput(
  input: unknown,
): UserIdentityAndTenantMembershipInviteInput | UserIdentityAndTenantMembershipError {
  if (input === null || typeof input !== 'object') {
    return makeError('INVALID_BODY', 'Invite input must be an object');
  }
  const record = input as Record<string, unknown>;
  const email = record.email;
  const role = record.role;
  if (typeof email !== 'string' || !isValidEmail(email)) {
    return makeError('INVALID_BODY', 'Invalid email format');
  }
  if (typeof role !== 'string' || !['admin', 'member', 'viewer'].includes(role)) {
    return makeError('INVALID_BODY', 'Invalid role');
  }
  if (isSystemAdminRole(role as UserIdentityAndTenantMembershipRole)) {
    return makeError('INVALID_BODY', 'System admin role is not allowed for tenant membership');
  }
  return {
    email: toLowerEmail(email),
    role: role as UserIdentityAndTenantMembershipRole,
  };
}

function validateUpdateRoleInput(
  input: unknown,
): UserIdentityAndTenantMembershipUpdateRoleInput | UserIdentityAndTenantMembershipError {
  if (input === null || typeof input !== 'object') {
    return makeError('INVALID_BODY', 'Update role input must be an object');
  }
  const record = input as Record<string, unknown>;
  const userId = record.userId;
  const role = record.role;
  if (typeof userId !== 'string') {
    return makeError('INVALID_BODY', 'Invalid userId');
  }
  if (typeof role !== 'string' || !['admin', 'member', 'viewer'].includes(role)) {
    return makeError('INVALID_BODY', 'Invalid role');
  }
  if (isSystemAdminRole(role as UserIdentityAndTenantMembershipRole)) {
    return makeError('INVALID_BODY', 'System admin role is not allowed for tenant membership');
  }
  return {
    userId,
    role: role as UserIdentityAndTenantMembershipRole,
  };
}

function validateUpdateUsernameInput(
  input: unknown,
): UserIdentityAndTenantMembershipUpdateUsernameInput | UserIdentityAndTenantMembershipError {
  if (input === null || typeof input !== 'object') {
    return makeError('INVALID_BODY', 'Update username input must be an object');
  }
  const record = input as Record<string, unknown>;
  const userId = record.userId;
  const username = record.username;
  if (typeof userId !== 'string') {
    return makeError('INVALID_BODY', 'Invalid userId');
  }
  if (typeof username !== 'string' || !isValidUsername(username)) {
    return makeError('INVALID_BODY', 'Invalid username format');
  }
  return {
    userId,
    username,
  };
}

function validateUpdateStatusInput(
  input: unknown,
): UserIdentityAndTenantMembershipUpdateStatusInput | UserIdentityAndTenantMembershipError {
  if (input === null || typeof input !== 'object') {
    return makeError('INVALID_BODY', 'Update status input must be an object');
  }
  const record = input as Record<string, unknown>;
  const userId = record.userId;
  const status = record.status;
  if (typeof userId !== 'string') {
    return makeError('INVALID_BODY', 'Invalid userId');
  }
  if (typeof status !== 'string' || !['invited', 'active', 'disabled'].includes(status)) {
    return makeError('INVALID_BODY', 'Invalid status');
  }
  return {
    userId,
    status: status as UserIdentityAndTenantMembershipStatus,
  };
}

function validateRemoveInput(
  input: unknown,
): UserIdentityAndTenantMembershipRemoveInput | UserIdentityAndTenantMembershipError {
  if (input === null || typeof input !== 'object') {
    return makeError('INVALID_BODY', 'Remove input must be an object');
  }
  const record = input as Record<string, unknown>;
  const userId = record.userId;
  if (typeof userId !== 'string') {
    return makeError('INVALID_BODY', 'Invalid userId');
  }
  return { userId };
}

function validateResendInviteInput(
  input: unknown,
): UserIdentityAndTenantMembershipResendInviteInput | UserIdentityAndTenantMembershipError {
  if (input === null || typeof input !== 'object') {
    return makeError('INVALID_BODY', 'Resend invite input must be an object');
  }
  const record = input as Record<string, unknown>;
  const email = record.email;
  if (typeof email !== 'string' || !isValidEmail(email)) {
    return makeError('INVALID_BODY', 'Invalid email format');
  }
  return { email: toLowerEmail(email) };
}

function hasPermission(
  context: UserIdentityAndTenantMembershipContext,
  requiredPermission: string,
): boolean {
  return context.permissions.includes(requiredPermission);
}

function checkReadiness(
  state: UserIdentityAndTenantMembershipState,
): UserIdentityAndTenantMembershipReadiness {
  if (state.readiness === 'READY') {
    return 'READY';
  }
  return state.readiness;
}

function emitAudit(
  kind: UserIdentityAndTenantMembershipAuditEventKind,
  stateRef: UserIdentityAndTenantMembershipStateRef,
  details: unknown,
  auditFn: (event: UserIdentityAndTenantMembershipAuditEvent) => UserIdentityAndTenantMembershipError | null,
): UserIdentityAndTenantMembershipError | null {
  const event: UserIdentityAndTenantMembershipAuditEvent = {
    kind,
    timestamp: new Date().toISOString(),
    stateRef,
    details,
  };
  try {
    return auditFn(event);
  } catch {
    return makeError('PROVIDER_FAILURE', 'Audit emission failed');
  }
}

export function listMembers(
  state: UserIdentityAndTenantMembershipState,
  context: UserIdentityAndTenantMembershipContext,
): UserIdentityAndTenantMembershipResult<readonly UserIdentityAndTenantMembership[]> {
  if (!hasPermission(context, 'member:read')) {
    return makeError('INVALID_BODY', 'Permission denied');
  }
  const members = state.members.filter((m) => m.organisationId === context.organisationId);
  return makeSuccess('OK', members);
}

export function listPendingInvitations(
  state: UserIdentityAndTenantMembershipState,
  context: UserIdentityAndTenantMembershipContext,
): UserIdentityAndTenantMembershipResult<readonly UserIdentityAndTenantMembershipPendingInvitation[]> {
  if (!hasPermission(context, 'member:read')) {
    return makeError('INVALID_BODY', 'Permission denied');
  }
  const pending = state.pendingInvitations.filter((pi) => pi.organisationId === context.organisationId);
  return makeSuccess('OK', pending);
}

export function inviteMember(
  state: UserIdentityAndTenantMembershipState,
  context: UserIdentityAndTenantMembershipContext,
  input: unknown,
  auditFn: (event: UserIdentityAndTenantMembershipAuditEvent) => UserIdentityAndTenantMembershipError | null,
): UserIdentityAndTenantMembershipResult<UserIdentityAndTenantMembership | UserIdentityAndTenantMembershipPendingInvitation> {
  if (!hasPermission(context, 'member:invite')) {
    return makeError('INVALID_BODY', 'Permission denied');
  }
  if (checkReadiness(state) !== 'READY') {
    return makeError('PROVIDER_FAILURE', 'Service not ready');
  }

  const validatedInput = validateInviteInput(input);
  if ('kind' in validatedInput) {
    return validatedInput;
  }

  const existingMember = state.members.find(
    (m) => m.organisationId === context.organisationId && m.userId === validatedInput.email,
  );
  const existingPending = findPendingInvitation(state.pendingInvitations, validatedInput.email);

  if (existingPending !== null) {
    return makeError('ALREADY_INVITED', 'User already invited');
  }

  if (existingMember !== undefined) {
    if (isLastAdmin(state.members, existingMember.userId)) {
      return makeError('LAST_ADMIN_GUARD_INVITE', 'Cannot invite last admin');
    }
    const stateRef: UserIdentityAndTenantMembershipStateRef = {
      organisationId: context.organisationId,
      userId: existingMember.userId,
    };
    const auditError = emitAudit('INVITE', stateRef, validatedInput, auditFn);
    if (auditError !== null) {
      return auditError;
    }
    const updatedMembers = state.members.map((m) =>
      m.userId === existingMember.userId && m.organisationId === context.organisationId
        ? { ...m, role: validatedInput.role, updatedAt: new Date().toISOString() }
        : m,
    );
    const newState: UserIdentityAndTenantMembershipState = {
      ...state,
      members: updatedMembers,
      adminCount: countAdmins(updatedMembers),
    };
    return makeSuccess('OK', newState.members.find((m) => m.userId === existingMember.userId && m.organisationId === context.organisationId)!);
  }

  const stateRef: UserIdentityAndTenantMembershipStateRef = {
    organisationId: context.organisationId,
    userId: validatedInput.email,
  };
  const auditError = emitAudit('INVITE', stateRef, validatedInput, auditFn);
  if (auditError !== null) {
    return auditError;
  }

  const now = new Date().toISOString();
  const pendingInvitation: UserIdentityAndTenantMembershipPendingInvitation = {
    email: validatedInput.email,
    organisationId: context.organisationId,
    role: validatedInput.role,
    invitedAt: now,
    inviter: context.currentUserId,
    token: Math.random().toString(36).substring(2),
  };
  const newState: UserIdentityAndTenantMembershipState = {
    ...state,
    pendingInvitations: [...state.pendingInvitations, pendingInvitation],
  };
  return makeSuccess('CREATED', pendingInvitation);
}

export function updateMemberRole(
  state: UserIdentityAndTenantMembershipState,
  context: UserIdentityAndTenantMembershipContext,
  input: unknown,
  auditFn: (event: UserIdentityAndTenantMembershipAuditEvent) => UserIdentityAndTenantMembershipError | null,
): UserIdentityAndTenantMembershipResult<UserIdentityAndTenantMembership> {
  if (!hasPermission(context, 'member:update-role')) {
    return makeError('INVALID_BODY', 'Permission denied');
  }
  if (checkReadiness(state) !== 'READY') {
    return makeError('PROVIDER_FAILURE', 'Service not ready');
  }

  const validatedInput = validateUpdateRoleInput(input);
  if ('kind' in validatedInput) {
    return validatedInput;
  }

  const member = findMember(state.members, validatedInput.userId);
  if (member === null || member.organisationId !== context.organisationId) {
    return makeError('NOT_FOUND', 'Member not found');
  }

  if (isLastAdmin(state.members, validatedInput.userId) && validatedInput.role !== 'admin') {
    return makeError('LAST_ADMIN_GUARD_DEMOTE', 'Cannot demote last admin');
  }

  const stateRef: UserIdentityAndTenantMembershipStateRef = {
    organisationId: context.organisationId,
    userId: validatedInput.userId,
  };
  const auditError = emitAudit('ROLE_CHANGE', stateRef, validatedInput, auditFn);
  if (auditError !== null) {
    return auditError;
  }

  const updatedMembers = state.members.map((m) =>
    m.userId === validatedInput.userId && m.organisationId === context.organisationId
      ? { ...m, role: validatedInput.role, updatedAt: new Date().toISOString() }
      : m,
  );
  const newState: UserIdentityAndTenantMembershipState = {
    ...state,
    members: updatedMembers,
    adminCount: countAdmins(updatedMembers),
  };
  return makeSuccess('OK', newState.members.find((m) => m.userId === validatedInput.userId && m.organisationId === context.organisationId)!);
}

export function updateMemberUsername(
  state: UserIdentityAndTenantMembershipState,
  context: UserIdentityAndTenantMembershipContext,
  input: unknown,
  auditFn: (event: UserIdentityAndTenantMembershipAuditEvent) => UserIdentityAndTenantMembershipError | null,
): UserIdentityAndTenantMembershipResult<UserIdentityAndTenantMembership> {
  if (!hasPermission(context, 'member:update-role')) {
    return makeError('INVALID_BODY', 'Permission denied');
  }
  if (checkReadiness(state) !== 'READY') {
    return makeError('PROVIDER_FAILURE', 'Service not ready');
  }

  const validatedInput = validateUpdateUsernameInput(input);
  if ('kind' in validatedInput) {
    return validatedInput;
  }

  const member = findMember(state.members, validatedInput.userId);
  if (member === null || member.organisationId !== context.organisationId) {
    return makeError('NOT_FOUND', 'Member not found');
  }

  const stateRef: UserIdentityAndTenantMembershipStateRef = {
    organisationId: context.organisationId,
    userId: validatedInput.userId,
  };
  const auditError = emitAudit('USERNAME_STATUS_CHANGE', stateRef, validatedInput, auditFn);
  if (auditError !== null) {
    return auditError;
  }

  const updatedMembers = state.members.map((m) =>
    m.userId === validatedInput.userId && m.organisationId === context.organisationId
      ? { ...m, username: validatedInput.username, updatedAt: new Date().toISOString() }
      : m,
  );
  const newState: UserIdentityAndTenantMembershipState = {
    ...state,
    members: updatedMembers,
  };
  return makeSuccess('OK', newState.members.find((m) => m.userId === validatedInput.userId && m.organisationId === context.organisationId)!);
}

export function updateMemberStatus(
  state: UserIdentityAndTenantMembershipState,
  context: UserIdentityAndTenantMembershipContext,
  input: unknown,
  auditFn: (event: UserIdentityAndTenantMembershipAuditEvent) => UserIdentityAndTenantMembershipError | null,
): UserIdentityAndTenantMembershipResult<UserIdentityAndTenantMembership> {
  if (!hasPermission(context, 'member:update-role')) {
    return makeError('INVALID_BODY', 'Permission denied');
  }
  if (checkReadiness(state) !== 'READY') {
    return makeError('PROVIDER_FAILURE', 'Service not ready');
  }

  const validatedInput = validateUpdateStatusInput(input);
  if ('kind' in validatedInput) {
    return validatedInput;
  }

  const member = findMember(state.members, validatedInput.userId);
  if (member === null || member.organisationId !== context.organisationId) {
    return makeError('NOT_FOUND', 'Member not found');
  }

  if (!canTransitionStatus(member.status, validatedInput.status)) {
    return makeError('INVALID_TRANSITION', 'Invalid status transition');
  }

  if (isLastAdmin(state.members, validatedInput.userId) && validatedInput.status === 'disabled') {
    return makeError('LAST_ADMIN_GUARD_REMOVE', 'Cannot disable last admin');
  }

  const stateRef: UserIdentityAndTenantMembershipStateRef = {
    organisationId: context.organisationId,
    userId: validatedInput.userId,
  };
  const auditError = emitAudit('USERNAME_STATUS_CHANGE', stateRef, validatedInput, auditFn);
  if (auditError !== null) {
    return auditError;
  }

  const updatedMembers = state.members.map((m) =>
    m.userId === validatedInput.userId && m.organisationId === context.organisationId
      ? { ...m, status: validatedInput.status, updatedAt: new Date().toISOString() }
      : m,
  );
  const newState: UserIdentityAndTenantMembershipState = {
    ...state,
    members: updatedMembers,
    adminCount: countAdmins(updatedMembers),
  };
  return makeSuccess('OK', newState.members.find((m) => m.userId === validatedInput.userId && m.organisationId === context.organisationId)!);
}

export function removeMember(
  state: UserIdentityAndTenantMembershipState,
  context: UserIdentityAndTenantMembershipContext,
  input: unknown,
  auditFn: (event: UserIdentityAndTenantMembershipAuditEvent) => UserIdentityAndTenantMembershipError | null,
): UserIdentityAndTenantMembershipResult<void> {
  if (!hasPermission(context, 'member:delete')) {
    return makeError('INVALID_BODY', 'Permission denied');
  }
  if (checkReadiness(state) !== 'READY') {
    return makeError('PROVIDER_FAILURE', 'Service not ready');
  }

  const validatedInput = validateRemoveInput(input);
  if ('kind' in validatedInput) {
    return validatedInput;
  }

  const member = findMember(state.members, validatedInput.userId);
  if (member === null || member.organisationId !== context.organisationId) {
    return makeError('NOT_FOUND', 'Member not found');
  }

  if (isLastAdmin(state.members, validatedInput.userId)) {
    return makeError('LAST_ADMIN_GUARD_REMOVE', 'Cannot remove last admin');
  }

  const stateRef: UserIdentityAndTenantMembershipStateRef = {
    organisationId: context.organisationId,
    userId: validatedInput.userId,
  };
  const auditError = emitAudit('REMOVE', stateRef, validatedInput, auditFn);
  if (auditError !== null) {
    return auditError;
  }

  const updatedMembers = state.members.filter(
    (m) => !(m.userId === validatedInput.userId && m.organisationId === context.organisationId),
  );
  const newState: UserIdentityAndTenantMembershipState = {
    ...state,
    members: updatedMembers,
    adminCount: countAdmins(updatedMembers),
  };
  return makeSuccess('OK', undefined);
}

export function resendInvite(
  state: UserIdentityAndTenantMembershipState,
  context: UserIdentityAndTenantMembershipContext,
  input: unknown,
  auditFn: (event: UserIdentityAndTenantMembershipAuditEvent) => UserIdentityAndTenantMembershipError | null,
): UserIdentityAndTenantMembershipResult<UserIdentityAndTenantMembershipPendingInvitation> {
  if (!hasPermission(context, 'member:invite')) {
    return makeError('INVALID_BODY', 'Permission denied');
  }
  if (checkReadiness(state) !== 'READY') {
    return makeError('PROVIDER_FAILURE', 'Service not ready');
  }

  const validatedInput = validateResendInviteInput(input);
  if ('kind' in validatedInput) {
    return validatedInput;
  }

  const pendingInvitation = findPendingInvitation(state.pendingInvitations, validatedInput.email);
  if (pendingInvitation === null || pendingInvitation.organisationId !== context.organisationId) {
    return makeError('NOT_FOUND', 'Pending invitation not found');
  }

  const stateRef: UserIdentityAndTenantMembershipStateRef = {
    organisationId: context.organisationId,
    userId: pendingInvitation.email,
  };
  const auditError = emitAudit('RESEND_INVITE', stateRef, validatedInput, auditFn);
  if (auditError !== null) {
    return auditError;
  }

  const updatedPendingInvitations = state.pendingInvitations.map((pi) =>
    pi.email === pendingInvitation.email && pi.organisationId === context.organisationId
      ? { ...pi, invitedAt: new Date().toISOString() }
      : pi,
  );
  const newState: UserIdentityAndTenantMembershipState = {
    ...state,
    pendingInvitations: updatedPendingInvitations,
  };
  return makeSuccess('OK', newState.pendingInvitations.find((pi) => pi.email === pendingInvitation.email && pi.organisationId === context.organisationId)!);
}

export function readExternalIdentities(
  state: UserIdentityAndTenantMembershipState,
  context: UserIdentityAndTenantMembershipContext,
  userId: string,
): UserIdentityAndTenantMembershipResult<{ readonly userId: string; readonly externalIdentities: readonly string[] }> {
  if (!hasPermission(context, 'member:read')) {
    return makeError('INVALID_BODY', 'Permission denied');
  }
  const member = findMember(state.members, userId);
  if (member === null || member.organisationId !== context.organisationId) {
    return makeError('NOT_FOUND', 'Member not found');
  }
  return makeSuccess('OK', { userId, externalIdentities: [] });
}