import { prisma } from "./db.js";
import { parseDateOnly } from "./utils.js";

const defaultFestivalName = "Festival 2026";
const defaultFestivalStartDate = "2026-06-08";
const defaultFestivalEndDate = "2026-06-17";

const defaultShiftTypes = [
  {
    name: "Toiletten",
    description: "Halte den Toilettenbereich sauber, aufgefuellt und ansprechbar fuer Besucherinnen und Besucher.",
    defaultLengthMinutes: 180
  },
  {
    name: "Infostand",
    description: "Beantworte Fragen, teile Programmhinweise und hilf Gaesten bei der Orientierung auf dem Gelaende.",
    defaultLengthMinutes: 240
  },
  {
    name: "Parkplatz",
    description: "Koordiniere ankommende Fahrzeuge, weise Plaetze zu und halte Zufahrten frei.",
    defaultLengthMinutes: 240
  },
  {
    name: "Sanitaetsdienst",
    description: "Stelle waehrend des Festivalbetriebs eine verlaessliche sanitaetsdienstliche Erstversorgung sicher.",
    defaultLengthMinutes: 360
  },
  {
    name: "Barhilfe",
    description: "Unterstuetze Ausschank, Nachschub und die Organisation hinter der Bar.",
    defaultLengthMinutes: 240
  }
];

const defaultShiftTypeAliases = [
  {
    canonicalName: "Toiletten",
    aliases: ["Toiletten", "Toilets"]
  },
  {
    canonicalName: "Infostand",
    aliases: ["Infostand", "Info Tent"]
  },
  {
    canonicalName: "Parkplatz",
    aliases: ["Parkplatz", "Parking"]
  },
  {
    canonicalName: "Sanitaetsdienst",
    aliases: ["Sanitaetsdienst", "Medics"]
  },
  {
    canonicalName: "Barhilfe",
    aliases: ["Barhilfe", "Bar Support"]
  },
  {
    canonicalName: "Barschicht",
    aliases: ["Barschicht", "Bar Shift"]
  }
];

const defaultSampleShifts = [
  {
    shiftTypeName: "Infostand",
    dayOffset: 0,
    startTime: "10:00",
    endTime: "14:00",
    isPublic: true,
    capacity: 4
  },
  {
    shiftTypeName: "Parkplatz",
    dayOffset: 1,
    startTime: "08:00",
    endTime: "12:00",
    isPublic: true,
    capacity: 6
  },
  {
    shiftTypeName: "Toiletten",
    dayOffset: 2,
    startTime: "12:00",
    endTime: "15:00",
    isPublic: false,
    capacity: 3
  },
  {
    shiftTypeName: "Barhilfe",
    dayOffset: 3,
    startTime: "18:00",
    endTime: "22:00",
    isPublic: true,
    capacity: 5
  },
  {
    shiftTypeName: "Sanitaetsdienst",
    dayOffset: 4,
    startTime: "16:00",
    endTime: "22:00",
    isPublic: false,
    capacity: 2
  }
];

function dateWithOffsetWithinEvent(startDate: Date, endDate: Date, dayOffset: number) {
  const date = new Date(startDate);
  const maxOffset = Math.max(0, Math.floor((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)));
  date.setUTCDate(date.getUTCDate() + Math.min(dayOffset, maxOffset));
  return date;
}

function normalizeShiftTypeName(name: string) {
  const lowerName = name.toLowerCase();
  const aliasEntry = defaultShiftTypeAliases.find((entry) => entry.aliases.some((alias) => alias.toLowerCase() === lowerName));
  return (aliasEntry?.canonicalName ?? name).toLowerCase();
}

export async function ensureDefaultFestivalSetup() {
  const existingEvent = await prisma.event.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true }
  });

  if (existingEvent) {
    return;
  }

  const createdEvent = await prisma.event.create({
    data: {
      name: defaultFestivalName,
      startDate: parseDateOnly(defaultFestivalStartDate),
      endDate: parseDateOnly(defaultFestivalEndDate),
      shiftTypes: {
        create: defaultShiftTypes
      }
    },
    include: {
      shiftTypes: {
        select: { id: true, name: true }
      }
    }
  });

  const shiftTypeIdsByName = new Map(createdEvent.shiftTypes.map((shiftType) => [normalizeShiftTypeName(shiftType.name), shiftType.id]));
  const sampleShifts = defaultSampleShifts.flatMap((sampleShift) => {
    const shiftTypeId = shiftTypeIdsByName.get(normalizeShiftTypeName(sampleShift.shiftTypeName));

    if (!shiftTypeId) {
      return [];
    }

    return [{
      eventId: createdEvent.id,
      shiftTypeId,
      date: dateWithOffsetWithinEvent(createdEvent.startDate, createdEvent.endDate, sampleShift.dayOffset),
      startTime: sampleShift.startTime,
      endTime: sampleShift.endTime,
      isPublic: sampleShift.isPublic,
      capacity: sampleShift.capacity
    }];
  });

  if (sampleShifts.length) {
    await prisma.shift.createMany({
      data: sampleShifts
    });
  }

  console.log(`Seeded default festival ${defaultFestivalStartDate} to ${defaultFestivalEndDate}.`);
  console.log(`Seeded ${sampleShifts.length} sample shift${sampleShifts.length === 1 ? "" : "s"}.`);
}