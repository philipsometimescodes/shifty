import type { Application, Shift, ShiftType } from "@prisma/client";

export function parseDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    throw new Error("Expected a date in YYYY-MM-DD format");
  }

  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12, 0, 0));
}

export function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function isDateWithinRange(date: Date, startDate: Date, endDate: Date) {
  const normalized = date.getTime();
  return normalized >= startDate.getTime() && normalized <= endDate.getTime();
}

export function timeToMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);

  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 23 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
}

export function isValidTimeRange(startTime: string, endTime: string) {
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);

  if (startMinutes === null || endMinutes === null) {
    return false;
  }

  return endMinutes !== startMinutes;
}

export function minutesBetweenTimes(startTime: string, endTime: string) {
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);

  if (startMinutes === null || endMinutes === null || endMinutes === startMinutes) {
    return null;
  }

  return endMinutes > startMinutes ? endMinutes - startMinutes : 1440 - startMinutes + endMinutes;
}

export function reservedCount(applications: Pick<Application, "status">[]) {
  return applications.filter((application) => application.status !== "REJECTED").length;
}

export function serializeShift(
  shift: Shift & {
    shiftType: Pick<ShiftType, "id" | "eventId" | "name" | "description" | "defaultLengthMinutes">;
    applications: Pick<Application, "id" | "name" | "email" | "status" | "emailSent" | "createdAt">[];
  },
  eventRange?: { startDate: Date; endDate: Date }
) {
  const reserved = reservedCount(shift.applications);
  const durationMinutes = minutesBetweenTimes(shift.startTime, shift.endTime);

  return {
    id: shift.id,
    eventId: shift.eventId,
    shiftType: {
      id: shift.shiftType.id,
      eventId: shift.shiftType.eventId,
      name: shift.shiftType.name,
      description: shift.shiftType.description,
      defaultLengthMinutes: shift.shiftType.defaultLengthMinutes
    },
    date: toDateKey(shift.date),
    startTime: shift.startTime,
    endTime: shift.endTime,
    durationMinutes,
    capacity: shift.capacity,
    archived: shift.archived,
    isPublic: shift.isPublic,
    insideEventRange: eventRange ? isDateWithinRange(shift.date, eventRange.startDate, eventRange.endDate) : true,
    reservedCount: reserved,
    availableSpaces: Math.max(0, shift.capacity - reserved),
    applications: shift.applications.map((application) => ({
      id: application.id,
      name: application.name,
      email: application.email,
      status: application.status,
      emailSent: application.emailSent,
      createdAt: application.createdAt.toISOString()
    }))
  };
}