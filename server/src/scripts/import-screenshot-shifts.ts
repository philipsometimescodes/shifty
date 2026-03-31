import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFilePath);

dotenv.config({ path: path.resolve(currentDirectory, "../../.env") });

const prisma = new PrismaClient();

const eventDateRange = {
  startDate: "2026-06-08",
  endDate: "2026-06-16"
} as const;

const dayDates = {
  mondaySetup: "2026-06-08",
  tuesdaySetup: "2026-06-09",
  wednesdaySetup: "2026-06-10",
  thursdaySetup: "2026-06-11",
  friday: "2026-06-12",
  saturday: "2026-06-13",
  sunday: "2026-06-14",
  mondayWrap: "2026-06-15",
  tuesdayWrap: "2026-06-16"
} as const;

const desiredShiftTypes = [
  {
    name: "Bar Saal",
    description: "Innere Barbesetzung im Saalbereich.",
    defaultLengthMinutes: 120
  },
  {
    name: "Bar Cafete",
    description: "Barbesetzung im Cafete-Bereich.",
    defaultLengthMinutes: 120
  },
  {
    name: "Parkplätze",
    description: "Einweisung und Koordination auf den Parkflaechen.",
    defaultLengthMinutes: 180
  },
  {
    name: "Sanitäre Anlagen",
    description: "Betreuung und Nachschub fuer die sanitären Anlagen.",
    defaultLengthMinutes: 180
  },
  {
    name: "Infostand",
    description: "Anlaufstelle fuer Fragen, Infos und Orientierung auf dem Gelaende.",
    defaultLengthMinutes: 180
  },
  {
    name: "Springer:innen",
    description: "Flexible Unterstuetzung dort, wo kurzfristig Hilfe gebraucht wird.",
    defaultLengthMinutes: 240
  },
  {
    name: "Medis",
    description: "Medizinische Erstversorgung und Bereitschaft waehrend des Festivals.",
    defaultLengthMinutes: 240
  },
  {
    name: "Kirnhalden",
    description: "Schicht am Standort Kirnhalden.",
    defaultLengthMinutes: 480
  }
];

type DesiredShift = {
  shiftTypeName: string;
  date: string;
  startTime: string;
  endTime: string;
  capacity: number;
  isPublic: boolean;
};

const desiredShifts: DesiredShift[] = [];

function addShift(shiftTypeName: string, date: string, startTime: string, endTime: string, capacity: number, isPublic = false) {
  if (capacity <= 0) {
    return;
  }

  desiredShifts.push({ shiftTypeName, date, startTime, endTime, capacity, isPublic });
}

function addInfostandShift(date: string, startTime: string, endTime: string, totalCapacity: number, externalCapacity: number) {
  const internalCapacity = totalCapacity - externalCapacity;

  if (internalCapacity > 0) {
    addShift("Infostand", date, startTime, endTime, internalCapacity, false);
  }

  if (externalCapacity > 0) {
    addShift("Infostand", date, startTime, endTime, externalCapacity, true);
  }
}

function seedBarShifts() {
  addShift("Bar Saal", dayDates.friday, "17:00", "20:00", 2);
  addShift("Bar Saal", dayDates.friday, "20:00", "22:00", 2);
  addShift("Bar Saal", dayDates.friday, "22:00", "00:00", 2);
  addShift("Bar Saal", dayDates.saturday, "00:00", "02:00", 2);
  addShift("Bar Saal", dayDates.saturday, "02:00", "04:00", 2);

  addShift("Bar Cafete", dayDates.friday, "20:00", "22:00", 2);
  addShift("Bar Cafete", dayDates.friday, "22:00", "00:00", 2);
  addShift("Bar Cafete", dayDates.saturday, "00:00", "02:00", 2);
  addShift("Bar Cafete", dayDates.saturday, "02:00", "04:00", 2);

  addShift("Bar Cafete", dayDates.saturday, "10:00", "12:00", 2);
  addShift("Bar Cafete", dayDates.saturday, "12:00", "14:00", 2);
  addShift("Bar Saal", dayDates.saturday, "14:00", "16:00", 2);
  addShift("Bar Cafete", dayDates.saturday, "14:00", "16:00", 2);
  addShift("Bar Saal", dayDates.saturday, "16:00", "18:00", 2);
  addShift("Bar Cafete", dayDates.saturday, "16:00", "18:00", 2);
  addShift("Bar Saal", dayDates.saturday, "18:00", "20:00", 2);
  addShift("Bar Cafete", dayDates.saturday, "18:00", "20:00", 2);
  addShift("Bar Saal", dayDates.saturday, "20:00", "22:00", 2);
  addShift("Bar Cafete", dayDates.saturday, "20:00", "22:00", 2);
  addShift("Bar Saal", dayDates.saturday, "22:00", "00:00", 2);
  addShift("Bar Cafete", dayDates.saturday, "22:00", "00:00", 2);
  addShift("Bar Saal", dayDates.sunday, "00:00", "02:00", 2);
  addShift("Bar Cafete", dayDates.sunday, "00:00", "02:00", 2);
  addShift("Bar Saal", dayDates.sunday, "02:00", "04:00", 2);
  addShift("Bar Cafete", dayDates.sunday, "02:00", "04:00", 2);

  addShift("Bar Cafete", dayDates.sunday, "10:00", "12:00", 2);
  addShift("Bar Cafete", dayDates.sunday, "12:00", "14:00", 2);
  addShift("Bar Cafete", dayDates.sunday, "14:00", "16:00", 2);
  addShift("Bar Cafete", dayDates.sunday, "16:00", "18:00", 2);
}

function seedParkingShifts() {
  addShift("Parkplätze", dayDates.friday, "16:00", "19:00", 6);
  addShift("Parkplätze", dayDates.friday, "19:00", "22:00", 6);
  addShift("Parkplätze", dayDates.friday, "22:00", "01:00", 2);

  addShift("Parkplätze", dayDates.saturday, "10:00", "13:00", 2);
  addShift("Parkplätze", dayDates.saturday, "13:00", "16:00", 2);
  addShift("Parkplätze", dayDates.saturday, "16:00", "19:00", 2);
  addShift("Parkplätze", dayDates.saturday, "19:00", "22:00", 2);
  addShift("Parkplätze", dayDates.saturday, "22:00", "01:00", 2);
}

function seedSanitaryShifts() {
  addShift("Sanitäre Anlagen", dayDates.friday, "16:00", "19:00", 2);
  addShift("Sanitäre Anlagen", dayDates.friday, "19:00", "22:00", 2);
  addShift("Sanitäre Anlagen", dayDates.friday, "22:00", "01:00", 2);
  addShift("Sanitäre Anlagen", dayDates.saturday, "01:00", "04:00", 3);

  addShift("Sanitäre Anlagen", dayDates.saturday, "10:00", "13:00", 3);
  addShift("Sanitäre Anlagen", dayDates.saturday, "13:00", "16:00", 2);
  addShift("Sanitäre Anlagen", dayDates.saturday, "16:00", "19:00", 2);
  addShift("Sanitäre Anlagen", dayDates.saturday, "19:00", "22:00", 2);
  addShift("Sanitäre Anlagen", dayDates.saturday, "22:00", "01:00", 2);
  addShift("Sanitäre Anlagen", dayDates.sunday, "01:00", "04:00", 3);
  addShift("Sanitäre Anlagen", dayDates.sunday, "10:00", "13:00", 3);
}

function seedInfoDeskShifts() {
  addInfostandShift(dayDates.friday, "16:00", "19:00", 3, 1);
  addInfostandShift(dayDates.friday, "19:00", "22:00", 3, 1);
  addInfostandShift(dayDates.friday, "22:00", "01:00", 2, 1);
  addInfostandShift(dayDates.saturday, "01:00", "04:00", 2, 1);

  addInfostandShift(dayDates.saturday, "10:00", "13:00", 2, 1);
  addInfostandShift(dayDates.saturday, "13:00", "16:00", 2, 1);
  addInfostandShift(dayDates.saturday, "16:00", "19:00", 2, 1);
  addInfostandShift(dayDates.saturday, "19:00", "22:00", 2, 1);
  addInfostandShift(dayDates.saturday, "22:00", "01:00", 2, 0);
  addInfostandShift(dayDates.sunday, "01:00", "04:00", 2, 0);

  addInfostandShift(dayDates.sunday, "10:00", "12:00", 2, 1);
  addInfostandShift(dayDates.sunday, "12:00", "14:00", 2, 1);
}

function seedFloaterShifts() {
  addShift("Springer:innen", dayDates.friday, "16:00", "20:00", 2);
  addShift("Springer:innen", dayDates.friday, "20:00", "00:00", 2);
  addShift("Springer:innen", dayDates.saturday, "00:00", "04:00", 2);

  addShift("Springer:innen", dayDates.saturday, "08:00", "12:00", 2);
  addShift("Springer:innen", dayDates.saturday, "12:00", "16:00", 2);
  addShift("Springer:innen", dayDates.saturday, "16:00", "20:00", 2);
  addShift("Springer:innen", dayDates.saturday, "20:00", "00:00", 2);
  addShift("Springer:innen", dayDates.sunday, "00:00", "04:00", 2);
}

function seedMedicShifts() {
  addShift("Medis", dayDates.friday, "16:00", "20:00", 2);
  addShift("Medis", dayDates.friday, "20:00", "00:00", 2);
  addShift("Medis", dayDates.saturday, "00:00", "04:00", 2);

  addShift("Medis", dayDates.saturday, "08:00", "12:00", 2);
  addShift("Medis", dayDates.saturday, "16:00", "20:00", 2);
  addShift("Medis", dayDates.saturday, "20:00", "00:00", 2);
  addShift("Medis", dayDates.sunday, "00:00", "04:00", 2);
}

function seedKirnhaldenShifts() {
  addShift("Kirnhalden", dayDates.mondaySetup, "09:00", "17:00", 10, false);
  addShift("Kirnhalden", dayDates.tuesdaySetup, "09:00", "17:00", 10, false);
  addShift("Kirnhalden", dayDates.wednesdaySetup, "09:00", "17:00", 10, false);
  addShift("Kirnhalden", dayDates.thursdaySetup, "09:00", "17:00", 20, false);
  addShift("Kirnhalden", dayDates.friday, "09:00", "17:00", 20, false);
  addShift("Kirnhalden", dayDates.mondayWrap, "09:00", "17:00", 10, false);
  addShift("Kirnhalden", dayDates.tuesdayWrap, "09:00", "17:00", 10, false);
}

seedBarShifts();
seedParkingShifts();
seedSanitaryShifts();
seedInfoDeskShifts();
seedFloaterShifts();
seedMedicShifts();
seedKirnhaldenShifts();

async function main() {
  const event = await prisma.event.findFirst({
    orderBy: { createdAt: "asc" }
  });

  if (!event) {
    throw new Error("Kein Event gefunden.");
  }

  await prisma.$transaction(async (transaction) => {
    await transaction.event.update({
      where: { id: event.id },
      data: {
        startDate: new Date(`${eventDateRange.startDate}T12:00:00.000Z`),
        endDate: new Date(`${eventDateRange.endDate}T12:00:00.000Z`)
      }
    });

    await transaction.application.deleteMany({
      where: { eventId: event.id }
    });

    await transaction.shift.deleteMany({
      where: { eventId: event.id }
    });

    const desiredNames = desiredShiftTypes.map((shiftType) => shiftType.name);

    await transaction.shiftType.deleteMany({
      where: {
        eventId: event.id,
        name: {
          notIn: desiredNames
        }
      }
    });

    for (const shiftType of desiredShiftTypes) {
      const existingShiftType = await transaction.shiftType.findFirst({
        where: {
          eventId: event.id,
          name: shiftType.name
        }
      });

      if (existingShiftType) {
        await transaction.shiftType.update({
          where: { id: existingShiftType.id },
          data: {
            description: shiftType.description,
            defaultLengthMinutes: shiftType.defaultLengthMinutes
          }
        });
      } else {
        await transaction.shiftType.create({
          data: {
            eventId: event.id,
            name: shiftType.name,
            description: shiftType.description,
            defaultLengthMinutes: shiftType.defaultLengthMinutes
          }
        });
      }
    }

    const shiftTypes = await transaction.shiftType.findMany({
      where: { eventId: event.id }
    });
    const shiftTypeIdsByName = new Map(shiftTypes.map((shiftType) => [shiftType.name, shiftType.id]));

    await transaction.shift.createMany({
      data: desiredShifts.map((shift) => {
        const shiftTypeId = shiftTypeIdsByName.get(shift.shiftTypeName);

        if (!shiftTypeId) {
          throw new Error(`Schichttyp ${shift.shiftTypeName} wurde nicht gefunden.`);
        }

        return {
          eventId: event.id,
          shiftTypeId,
          date: new Date(`${shift.date}T12:00:00.000Z`),
          startTime: shift.startTime,
          endTime: shift.endTime,
          isPublic: shift.isPublic,
          capacity: shift.capacity,
          archived: false
        };
      })
    });
  });

  const summary = await prisma.event.findUnique({
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
        event: summary && {
          id: summary.id,
          name: summary.name,
          startDate: summary.startDate.toISOString().slice(0, 10),
          endDate: summary.endDate.toISOString().slice(0, 10)
        },
        shiftTypes: summary?.shiftTypes.map((shiftType) => shiftType.name),
        shiftCount: summary?.shifts.length,
        publicShiftCount: summary?.shifts.filter((shift) => shift.isPublic).length,
        shifts: summary?.shifts.map((shift) => ({
          date: shift.date.toISOString().slice(0, 10),
          startTime: shift.startTime,
          endTime: shift.endTime,
          capacity: shift.capacity,
          isPublic: shift.isPublic,
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