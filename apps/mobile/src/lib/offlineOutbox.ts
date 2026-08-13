import AsyncStorage from "@react-native-async-storage/async-storage";
import { api, APIError, type AttendanceAction } from "./api";

const STORAGE_KEY = "bg-gold.attendance.outbox.v1";

export type AttendanceScope = {
  organizationId: string;
  membershipId: string;
};

export type AttendancePayload = {
  type: AttendanceAction;
  shiftId?: string;
  sectionId?: string;
  reason?: string;
  evidence: {
    location?: unknown;
    attachmentId?: string;
    [key: string]: unknown;
  };
};

type QueuedAttachment = { uri: string; mimeType?: string };

export type OutboxItem = AttendanceScope & {
  idempotencyKey: string;
  payload: AttendancePayload;
  attachment?: QueuedAttachment;
  queuedAt: string;
  attempts: number;
  status: "PENDING" | "NEEDS_REVIEW";
  lastError?: string;
};

let operation = Promise.resolve();

export async function submitAttendanceResilient(
  token: string,
  scope: AttendanceScope,
  idempotencyKey: string,
  payload: AttendancePayload,
  attachment?: QueuedAttachment,
): Promise<{ queued: boolean }> {
  try {
    const ready = await attachSelfie(token, payload, attachment);
    await api.action(token, idempotencyKey, ready);
    return { queued: false };
  } catch (reason) {
    if (!isRetryable(reason)) throw reason;
    await enqueue({
      ...scope,
      idempotencyKey,
      payload,
      attachment,
      queuedAt: new Date().toISOString(),
      attempts: 0,
      status: "PENDING",
    });
    return { queued: true };
  }
}

export async function flushAttendanceOutbox(
  token: string,
  scope: AttendanceScope,
): Promise<{ sent: number; pending: number; needsReview: number }> {
  return serialize(async () => {
    const items = await readOutbox();
    let sent = 0;
    let networkUnavailable = false;
    const next: OutboxItem[] = [];
    for (const item of items) {
      if (
        item.organizationId !== scope.organizationId ||
        item.membershipId !== scope.membershipId ||
        item.status === "NEEDS_REVIEW" ||
        networkUnavailable
      ) {
        next.push(item);
        continue;
      }
      try {
        const ready = await attachSelfie(token, item.payload, item.attachment);
        await api.action(token, item.idempotencyKey, ready);
        sent += 1;
      } catch (reason) {
        const updated = { ...item, attempts: item.attempts + 1 };
        if (reason instanceof APIError && reason.status < 500) {
          updated.status = "NEEDS_REVIEW";
          updated.lastError = reason.message;
        } else {
          networkUnavailable = true;
          updated.lastError =
            reason instanceof Error ? reason.message : "Jaringan belum tersedia.";
        }
        next.push(updated);
      }
    }
    await writeOutbox(next);
    const scoped = next.filter(
      (item) =>
        item.organizationId === scope.organizationId &&
        item.membershipId === scope.membershipId,
    );
    return {
      sent,
      pending: scoped.filter((item) => item.status === "PENDING").length,
      needsReview: scoped.filter((item) => item.status === "NEEDS_REVIEW").length,
    };
  });
}

export async function attendanceOutbox(scope: AttendanceScope) {
  const items = await readOutbox();
  return items.filter(
    (item) =>
      item.organizationId === scope.organizationId &&
      item.membershipId === scope.membershipId,
  );
}

async function enqueue(item: OutboxItem) {
  await serialize(async () => {
    const items = await readOutbox();
    if (!items.some((existing) => existing.idempotencyKey === item.idempotencyKey)) {
      items.push(item);
      await writeOutbox(items);
    }
  });
}

async function attachSelfie(
  token: string,
  payload: AttendancePayload,
  attachment?: QueuedAttachment,
): Promise<AttendancePayload> {
  if (!attachment) return payload;
  const uploaded = await api.selfie(token, attachment.uri, attachment.mimeType);
  return {
    ...payload,
    evidence: { ...payload.evidence, attachmentId: uploaded.id },
  };
}

function isRetryable(reason: unknown) {
  return !(reason instanceof APIError) || reason.status >= 500;
}

async function readOutbox(): Promise<OutboxItem[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? (value as OutboxItem[]) : [];
  } catch {
    return [];
  }
}

async function writeOutbox(items: OutboxItem[]) {
  if (items.length === 0) {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } else {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }
}

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const result = operation.then(work, work);
  operation = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
