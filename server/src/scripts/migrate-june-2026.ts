import { PrismaClient } from "@prisma/client";

import { parseDateOnly } from "../utils.js";

const prisma = new PrismaClient();

const targetEventName = "Festival 2026";
const targetStartDate = parseDateOnly("2026-06-08");

const shiftTypeTranslations = [
  {
    names: ["Toilets", "Toiletten"],
    name: "Toiletten",
    description: "Halte den Toilettenbereich sauber, aufgefuellt und ansprechbar fuer Besucherinnen und Besucher."
  },
  {
    names: ["Info Tent", "Infostand"],
    name: "Infostand",
    description: "Beantworte Fragen, teile Programmhinweise und hilf Gaesten bei der Orientierung auf dem Gelaende."
  },
  {
    names: ["Parking", "Parkplatz"],
    name: "Parkplatz",
    description: "Koordiniere ankommende Fahrzeuge, weise Plaetze zu und halte Zufahrten frei."
  },
  {
    names: ["Medics", "Sanitaetsdienst"],
    name: "Sanitaetsdienst",
    description: "Stelle waehrend des Festivalbetriebs eine verlaessliche sanitaetsdienstliche Erstversorgung sicher."
  },
  {
    names: ["Bar Support", "Barhilfe"],
    name: "Barhilfe",
    description: "Unterstuetze Ausschank, Nachschub und die Organisation hinter der Bar."
  },
  {
    names: ["Bar Shift", "Barschicht"],
    name: "Barschicht",
    description: "Uebernimm eine konkrete Schicht im Barbereich waehrend des abendlichen Getraenkeservices."
  }
];

function translateShiftType(name: string) {
  const exactMatch = shiftTypeTranslations.find((entry) => entry.names.includes(name));

  if (exactMatch) {
    return exactMatch;
  }

  if (name.startsWith("Bar Shift ")) {
    return {
      names: [name],
      name: name.replace(/^Bar Shift\b/, "Barschicht"),
      description: "Uebernimm eine konkrete Schicht im Barbereich waehrend des abendlichen Getraenkeservices."
    };
  }

  return undefined;
}

function canonicalShiftTypeName(name: string) {
  return translateShiftType(name)?.name ?? name;
}

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

async function main() {
  const event = await prisma.event.findFirst({
    orderBy: { createdAt: "asc" },
    include: {
      shiftTypes: {
        orderBy: { name: "asc" }
      },
      shifts: {
        orderBy: [{ date: "asc" }, { startTime: "asc" }],
        include: {
          applications: true,
          shiftType: true
        }
      }
    }
  });

  if (!event) {
    console.log("Kein Event gefunden. Keine Migration erforderlich.");
    return;
  }

  const dateOffsetMs = targetStartDate.getTime() - event.startDate.getTime();
  const targetEndDate = new Date(event.endDate.getTime() + dateOffsetMs);
  const shiftTypes = event.shiftTypes;
  const shiftUsageByTypeId = new Map(
    shiftTypes.map((shiftType) => {
      const relatedShifts = event.shifts.filter((shift) => shift.shiftTypeId === shiftType.id);
      const applicationCount = relatedShifts.reduce((count, shift) => count + shift.applications.length, 0);
      return [shiftType.id, { shiftCount: relatedShifts.length, applicationCount }];
    })
  );
  const primaryShiftTypeIdByCanonicalName = new Map<string, string>();

  function shouldPreferShiftType(candidateId: string, currentId: string, canonicalName: string) {
    const candidate = shiftTypes.find((shiftType) => shiftType.id === candidateId);
    const current = shiftTypes.find((shiftType) => shiftType.id === currentId);

    if (!candidate || !current) {
      return false;
    }

    const candidateUsage = shiftUsageByTypeId.get(candidate.id) ?? { shiftCount: 0, applicationCount: 0 };
    const currentUsage = shiftUsageByTypeId.get(current.id) ?? { shiftCount: 0, applicationCount: 0 };
    const candidateMatchesCanonical = candidate.name === canonicalName;
    const currentMatchesCanonical = current.name === canonicalName;

    if (candidateMatchesCanonical !== currentMatchesCanonical) {
      return candidateMatchesCanonical;
    }

    if (candidateUsage.applicationCount !== currentUsage.applicationCount) {
      return candidateUsage.applicationCount > currentUsage.applicationCount;
    }

    if (candidateUsage.shiftCount !== currentUsage.shiftCount) {
      return candidateUsage.shiftCount > currentUsage.shiftCount;
    }

    return candidate.id.localeCompare(current.id) < 0;
  }

  for (const shiftType of shiftTypes) {
    const canonicalName = canonicalShiftTypeName(shiftType.name);
    const currentPrimaryId = primaryShiftTypeIdByCanonicalName.get(canonicalName);

    if (!currentPrimaryId || shouldPreferShiftType(shiftType.id, currentPrimaryId, canonicalName)) {
      primaryShiftTypeIdByCanonicalName.set(canonicalName, shiftType.id);
    }
  }

  const nextShiftTypeIdById = new Map(
    shiftTypes.map((shiftType) => [shiftType.id, primaryShiftTypeIdByCanonicalName.get(canonicalShiftTypeName(shiftType.name)) ?? shiftType.id])
  );
  const shiftedShifts = event.shifts.map((shift) => ({
    ...shift,
    nextShiftTypeId: nextShiftTypeIdById.get(shift.shiftTypeId) ?? shift.shiftTypeId,
    nextDate: new Date(shift.date.getTime() + dateOffsetMs)
  }));
  const duplicateGroups = new Map<string, typeof shiftedShifts>();

  for (const shift of shiftedShifts) {
    const duplicateKey = [
      shift.nextShiftTypeId,
      toDateKey(shift.nextDate),
      shift.startTime,
      shift.endTime,
      shift.capacity,
      shift.isPublic,
      shift.archived
    ].join(":");
    const existingGroup = duplicateGroups.get(duplicateKey);

    if (existingGroup) {
      existingGroup.push(shift);
    } else {
      duplicateGroups.set(duplicateKey, [shift]);
    }
  }

  const redundantShiftIds = new Map<string, string>();
  const retainedShiftIds = new Set<string>();

  for (const group of duplicateGroups.values()) {
    const keptShift = [...group].sort((left, right) => {
      if (right.applications.length !== left.applications.length) {
        return right.applications.length - left.applications.length;
      }

      return left.id.localeCompare(right.id);
    })[0];

    retainedShiftIds.add(keptShift.id);

    for (const shift of group) {
      if (shift.id !== keptShift.id) {
        redundantShiftIds.set(shift.id, keptShift.id);
      }
    }
  }

  await prisma.$transaction(async (transaction) => {
    await transaction.event.update({
      where: { id: event.id },
      data: {
        name: targetEventName,
        startDate: targetStartDate,
        endDate: targetEndDate
      }
    });

    for (const shiftType of shiftTypes) {
      const translation = translateShiftType(shiftType.name);

      if (translation && primaryShiftTypeIdByCanonicalName.get(translation.name) === shiftType.id) {
        await transaction.shiftType.update({
          where: { id: shiftType.id },
          data: {
            name: translation.name,
            description: translation.description
          }
        });
      }
    }

    for (const shift of shiftedShifts) {
      if (!retainedShiftIds.has(shift.id)) {
        continue;
      }

      await transaction.shift.update({
        where: { id: shift.id },
        data: {
          shiftTypeId: shift.nextShiftTypeId,
          date: shift.nextDate
        }
      });
    }

    for (const [redundantShiftId, retainedShiftId] of redundantShiftIds) {
      await transaction.application.updateMany({
        where: { shiftId: redundantShiftId },
        data: { shiftId: retainedShiftId }
      });

      await transaction.shift.delete({
        where: { id: redundantShiftId }
      });
    }

    const redundantShiftTypeIds = shiftTypes
      .filter((shiftType) => nextShiftTypeIdById.get(shiftType.id) !== shiftType.id)
      .map((shiftType) => shiftType.id);

    if (redundantShiftTypeIds.length) {
      await transaction.shiftType.deleteMany({
        where: {
          id: {
            in: redundantShiftTypeIds
          }
        }
      });
    }
  });

  const updatedEvent = await prisma.event.findUnique({
    where: { id: event.id },
    include: {
      shiftTypes: {
        orderBy: { name: "asc" }
      },
      shifts: {
        orderBy: [{ date: "asc" }, { startTime: "asc" }],
        include: {
          shiftType: true
        }
      }
    }
  });

  console.log(
    JSON.stringify(
      {
        event: updatedEvent && {
          id: updatedEvent.id,
          name: updatedEvent.name,
          startDate: updatedEvent.startDate.toISOString().slice(0, 10),
          endDate: updatedEvent.endDate.toISOString().slice(0, 10)
        },
        shiftTypes: updatedEvent?.shiftTypes.map((shiftType) => ({
          name: shiftType.name,
          description: shiftType.description
        })),
        shifts: updatedEvent?.shifts.map((shift) => ({
          date: shift.date.toISOString().slice(0, 10),
          startTime: shift.startTime,
          endTime: shift.endTime,
          shiftTypeName: shift.shiftType.name
        }))
      },
      null,
      2
    )
  );
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}