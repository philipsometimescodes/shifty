import { Router } from "express";
import { z } from "zod";

import { requireAdmin } from "../auth.js";
import { prisma } from "../db.js";
import { sendEmail } from "../email.js";
import { isDateWithinRange, isValidTimeRange, minutesBetweenTimes, parseDateOnly, reservedCount, serializeShift } from "../utils.js";

const eventSchema = z.object({
  name: z.string().trim().min(2).max(120),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

const shiftTypeSchema = z.object({
  eventId: z.string().min(1),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(600),
  defaultLengthMinutes: z.number().int().min(15).max(24 * 60)
});

const shiftSchema = z.object({
  eventId: z.string().min(1),
  shiftTypeId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  isPublic: z.boolean(),
  capacity: z.number().int().min(1).max(500)
});

const applicationStatusSchema = z.enum(["PENDING", "APPROVED", "REJECTED"]);

const statusSchema = z.object({
  status: applicationStatusSchema
});

const emailSentSchema = z.object({
  emailSent: z.boolean()
});

const manualApplicationSchema = z.object({
  eventId: z.string().min(1),
  shiftId: z.string().min(1),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(320),
  status: applicationStatusSchema,
  emailSent: z.boolean()
});

const eventEmailTemplateSchema = z.object({
  subjectTemplate: z.string().trim().min(1).max(200),
  bodyTemplate: z.string().trim().min(1).max(5000)
});

const shiftImportPayloadSchema = z.object({
  eventId: z.string().min(1),
  csvText: z.string().min(1),
  replaceExisting: z.boolean().optional().default(true)
});

type ImportedShiftRow = {
  shiftTypeName: string;
  shiftTypeDescription: string;
  defaultLengthMinutes: number;
  date: string;
  startTime: string;
  endTime: string;
  capacity: number;
  isPublic: boolean;
};

function normalizeCsvColumnName(value: string) {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function detectCsvDelimiter(value: string) {
  const semicolonCount = (value.match(/;/g) ?? []).length;
  const commaCount = (value.match(/,/g) ?? []).length;
  return semicolonCount > commaCount ? ";" : ",";
}

function parseCsvRows(csvText: string) {
  const normalizedText = csvText.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const firstLine = normalizedText.split("\n").find((line) => line.trim().length > 0) ?? "";
  const delimiter = detectCsvDelimiter(firstLine);
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let insideQuotes = false;

  for (let index = 0; index < normalizedText.length; index += 1) {
    const character = normalizedText[index];
    const nextCharacter = normalizedText[index + 1];

    if (character === '"') {
      if (insideQuotes && nextCharacter === '"') {
        currentCell += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }

      continue;
    }

    if (!insideQuotes && character === delimiter) {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }

    if (!insideQuotes && character === "\n") {
      currentRow.push(currentCell);

      if (currentRow.some((cell) => cell.trim().length > 0)) {
        rows.push(currentRow);
      }

      currentRow = [];
      currentCell = "";
      continue;
    }

    currentCell += character;
  }

  if (insideQuotes) {
    throw new Error("Die CSV-Datei enthaelt ein nicht geschlossenes Anfuehrungszeichen.");
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);

    if (currentRow.some((cell) => cell.trim().length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

function getCsvValue(record: Map<string, string>, columnNames: string[]) {
  for (const columnName of columnNames) {
    const normalizedColumnName = normalizeCsvColumnName(columnName);
    const value = record.get(normalizedColumnName);

    if (value !== undefined) {
      return value.trim();
    }
  }

  return "";
}

function parseCsvBoolean(value: string, rowNumber: number) {
  const normalized = value.trim().toLowerCase();

  if (["true", "1", "yes", "ja", "public", "oeffentlich", "oeffentlich"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "nein", "internal", "intern"].includes(normalized)) {
    return false;
  }

  throw new Error(`Zeile ${rowNumber}: isPublic muss true/false oder public/internal sein.`);
}

function parseCsvPositiveInteger(value: string, rowNumber: number, fieldName: string) {
  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`Zeile ${rowNumber}: ${fieldName} muss eine positive ganze Zahl sein.`);
  }

  return parsedValue;
}

function parseImportedShiftRows(csvText: string) {
  const rows = parseCsvRows(csvText);

  if (rows.length < 2) {
    throw new Error("Die CSV-Datei muss eine Kopfzeile und mindestens eine Datensatz-Zeile enthalten.");
  }

  const [headerRow, ...dataRows] = rows;
  const normalizedHeaders = headerRow.map((header) => normalizeCsvColumnName(header));
  const requiredHeaders = ["shifttypename", "date", "starttime", "endtime", "capacity", "ispublic"];

  for (const header of requiredHeaders) {
    if (!normalizedHeaders.includes(header)) {
      throw new Error("Die CSV-Datei braucht diese Spalten: shiftTypeName, date, startTime, endTime, capacity, isPublic.");
    }
  }

  const importedRows: ImportedShiftRow[] = [];

  dataRows.forEach((row, index) => {
    const rowNumber = index + 2;
    const paddedRow = [...row];

    while (paddedRow.length < normalizedHeaders.length) {
      paddedRow.push("");
    }

    const record = new Map(normalizedHeaders.map((header, columnIndex) => [header, paddedRow[columnIndex] ?? ""]));
    const shiftTypeName = getCsvValue(record, ["shiftTypeName", "shiftType", "schichttyp"]);
    const date = getCsvValue(record, ["date", "datum"]);
    const startTime = getCsvValue(record, ["startTime", "start", "beginn"]);
    const endTime = getCsvValue(record, ["endTime", "ende"]);
    const capacityValue = getCsvValue(record, ["capacity", "plaetze"]);
    const isPublicValue = getCsvValue(record, ["isPublic", "visibility", "sichtbarkeit"]);
    const shiftTypeDescription = getCsvValue(record, ["shiftTypeDescription", "description", "beschreibung"]);
    const defaultLengthValue = getCsvValue(record, ["defaultLengthMinutes", "standarddauer", "standarddauerinminuten"]);

    if (!shiftTypeName || !date || !startTime || !endTime || !capacityValue || !isPublicValue) {
      throw new Error(`Zeile ${rowNumber}: Pflichtfelder duerfen nicht leer sein.`);
    }

    const inferredLengthMinutes = minutesBetweenTimes(startTime, endTime);

    importedRows.push({
      shiftTypeName,
      shiftTypeDescription,
      defaultLengthMinutes: defaultLengthValue
        ? parseCsvPositiveInteger(defaultLengthValue, rowNumber, "defaultLengthMinutes")
        : (inferredLengthMinutes ?? 180),
      date,
      startTime,
      endTime,
      capacity: parseCsvPositiveInteger(capacityValue, rowNumber, "capacity"),
      isPublic: parseCsvBoolean(isPublicValue, rowNumber)
    });
  });

  if (!importedRows.length) {
    throw new Error("Die CSV-Datei enthaelt keine importierbaren Schichten.");
  }

  return importedRows;
}

export const adminRouter = Router();

adminRouter.use(requireAdmin);

adminRouter.get("/dashboard", async (_req, res) => {
  const event = await prisma.event.findFirst({
    orderBy: { createdAt: "desc" },
    include: {
      shiftTypes: {
        orderBy: { name: "asc" },
        include: {
          _count: {
            select: { shifts: true }
          }
        }
      },
      shifts: {
        orderBy: [{ date: "asc" }, { startTime: "asc" }],
        include: {
          shiftType: {
            select: {
              id: true,
              eventId: true,
              name: true,
              description: true,
              defaultLengthMinutes: true
            }
          },
          applications: {
            select: { id: true, name: true, email: true, status: true, emailSent: true, createdAt: true }
          }
        }
      }
    }
  });

  if (!event) {
    res.json({ event: null, shiftTypes: [], shifts: [], applications: [] });
    return;
  }

  const shifts = event.shifts.map((shift) =>
    serializeShift(shift, { startDate: event.startDate, endDate: event.endDate })
  );

  const applications = shifts.flatMap((shift) =>
    shift.applications.map((application) => ({
      ...application,
      shiftId: shift.id,
      shiftTypeName: shift.shiftType.name,
      shiftDate: shift.date,
      shiftStartTime: shift.startTime,
      shiftEndTime: shift.endTime,
      isPublic: shift.isPublic
    }))
  );

  res.json({
    event: {
      id: event.id,
      name: event.name,
      startDate: event.startDate.toISOString().slice(0, 10),
      endDate: event.endDate.toISOString().slice(0, 10),
      adminEmailSubjectTemplate: event.adminEmailSubjectTemplate,
      adminEmailBodyTemplate: event.adminEmailBodyTemplate,
      outOfRangeShiftCount: shifts.filter((shift) => !shift.insideEventRange).length
    },
    shiftTypes: event.shiftTypes.map((shiftType) => ({
      id: shiftType.id,
      eventId: shiftType.eventId,
      name: shiftType.name,
      description: shiftType.description,
      defaultLengthMinutes: shiftType.defaultLengthMinutes,
      shiftCount: shiftType._count.shifts
    })),
    shifts,
    applications
  });
});

adminRouter.post("/event", async (req, res) => {
  const parsed = eventSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid event payload" });
    return;
  }

  const startDate = parseDateOnly(parsed.data.startDate);
  const endDate = parseDateOnly(parsed.data.endDate);

  if (startDate.getTime() > endDate.getTime()) {
    res.status(400).json({ error: "Event end date must be on or after the start date" });
    return;
  }

  const existingEvent = await prisma.event.findFirst();

  if (existingEvent) {
    res.status(409).json({ error: "Only one event is supported right now" });
    return;
  }

  const event = await prisma.event.create({
    data: {
      name: parsed.data.name,
      startDate,
      endDate
    }
  });

  res.status(201).json({
    id: event.id,
    name: event.name,
    startDate: event.startDate.toISOString().slice(0, 10),
    endDate: event.endDate.toISOString().slice(0, 10)
  });
});

adminRouter.patch("/event/:id", async (req, res) => {
  const parsed = eventSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid event payload" });
    return;
  }

  const startDate = parseDateOnly(parsed.data.startDate);
  const endDate = parseDateOnly(parsed.data.endDate);

  if (startDate.getTime() > endDate.getTime()) {
    res.status(400).json({ error: "Event end date must be on or after the start date" });
    return;
  }

  const event = await prisma.event.update({
    where: { id: req.params.id },
    data: { name: parsed.data.name, startDate, endDate }
  });

  res.json({
    id: event.id,
    name: event.name,
    startDate: event.startDate.toISOString().slice(0, 10),
    endDate: event.endDate.toISOString().slice(0, 10)
  });
});

adminRouter.patch("/event/:id/email-template", async (req, res) => {
  const parsed = eventEmailTemplateSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid email template payload" });
    return;
  }

  const event = await prisma.event.update({
    where: { id: req.params.id },
    data: {
      adminEmailSubjectTemplate: parsed.data.subjectTemplate,
      adminEmailBodyTemplate: parsed.data.bodyTemplate
    }
  });

  res.json({
    id: event.id,
    adminEmailSubjectTemplate: event.adminEmailSubjectTemplate,
    adminEmailBodyTemplate: event.adminEmailBodyTemplate
  });
});

adminRouter.post("/shift-types", async (req, res) => {
  const parsed = shiftTypeSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid shift type payload" });
    return;
  }

  const event = await prisma.event.findUnique({ where: { id: parsed.data.eventId } });

  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  const shiftType = await prisma.shiftType.create({
    data: {
      eventId: parsed.data.eventId,
      name: parsed.data.name,
      description: parsed.data.description,
      defaultLengthMinutes: parsed.data.defaultLengthMinutes
    }
  });

  res.status(201).json(shiftType);
});

adminRouter.patch("/shift-types/:id", async (req, res) => {
  const parsed = shiftTypeSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid shift type payload" });
    return;
  }

  const shiftType = await prisma.shiftType.update({
    where: { id: req.params.id },
    data: {
      name: parsed.data.name,
      description: parsed.data.description,
      defaultLengthMinutes: parsed.data.defaultLengthMinutes
    }
  });

  res.json(shiftType);
});

adminRouter.delete("/shift-types/:id", async (req, res) => {
  const shiftType = await prisma.shiftType.findUnique({
    where: { id: req.params.id },
    include: {
      _count: {
        select: { shifts: true }
      }
    }
  });

  if (!shiftType) {
    res.status(404).json({ error: "Shift type not found" });
    return;
  }

  if (shiftType._count.shifts > 0) {
    res.status(409).json({ error: "Shift types that are already used by shifts cannot be deleted" });
    return;
  }

  await prisma.shiftType.delete({ where: { id: shiftType.id } });
  res.status(204).send();
});

adminRouter.post("/shifts", async (req, res) => {
  const parsed = shiftSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid shift payload" });
    return;
  }

  const event = await prisma.event.findUnique({ where: { id: parsed.data.eventId } });

  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  const shiftType = await prisma.shiftType.findUnique({ where: { id: parsed.data.shiftTypeId } });

  if (!shiftType || shiftType.eventId !== parsed.data.eventId) {
    res.status(404).json({ error: "Shift type not found" });
    return;
  }

  const shiftDate = parseDateOnly(parsed.data.date);

  if (!isDateWithinRange(shiftDate, event.startDate, event.endDate)) {
    res.status(400).json({ error: "Shift date must be inside the event date range" });
    return;
  }

  if (!isValidTimeRange(parsed.data.startTime, parsed.data.endTime)) {
    res.status(400).json({ error: "Shift end time must be after the start time" });
    return;
  }

  const shift = await prisma.shift.create({
    data: {
      eventId: parsed.data.eventId,
      shiftTypeId: parsed.data.shiftTypeId,
      date: shiftDate,
      startTime: parsed.data.startTime,
      endTime: parsed.data.endTime,
      isPublic: parsed.data.isPublic,
      capacity: parsed.data.capacity
    },
    include: {
      shiftType: {
        select: {
          id: true,
          eventId: true,
          name: true,
          description: true,
          defaultLengthMinutes: true
        }
      },
      applications: {
        select: { id: true, name: true, email: true, status: true, emailSent: true, createdAt: true }
      }
    }
  });

  res.status(201).json(serializeShift(shift, { startDate: event.startDate, endDate: event.endDate }));
});

adminRouter.post("/shifts/import", async (req, res) => {
  const parsedPayload = shiftImportPayloadSchema.safeParse(req.body);

  if (!parsedPayload.success) {
    res.status(400).json({ error: "Invalid shift import payload" });
    return;
  }

  const event = await prisma.event.findUnique({ where: { id: parsedPayload.data.eventId } });

  if (!event) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  let importedRows: ImportedShiftRow[];

  try {
    importedRows = parseImportedShiftRows(parsedPayload.data.csvText);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "CSV konnte nicht gelesen werden." });
    return;
  }

  for (const [index, row] of importedRows.entries()) {
    const rowNumber = index + 2;
    const shiftDate = parseDateOnly(row.date);

    if (!isDateWithinRange(shiftDate, event.startDate, event.endDate)) {
      res.status(400).json({ error: `Zeile ${rowNumber}: Datum liegt ausserhalb des Event-Zeitraums.` });
      return;
    }

    if (!isValidTimeRange(row.startTime, row.endTime)) {
      res.status(400).json({ error: `Zeile ${rowNumber}: Endzeit muss sich von der Startzeit unterscheiden.` });
      return;
    }
  }

  const shiftTypeDefinitions = new Map<string, { description: string; defaultLengthMinutes: number }>();

  for (const row of importedRows) {
    const existingDefinition = shiftTypeDefinitions.get(row.shiftTypeName);

    if (!existingDefinition) {
      shiftTypeDefinitions.set(row.shiftTypeName, {
        description: row.shiftTypeDescription,
        defaultLengthMinutes: row.defaultLengthMinutes
      });
      continue;
    }

    shiftTypeDefinitions.set(row.shiftTypeName, {
      description: row.shiftTypeDescription || existingDefinition.description,
      defaultLengthMinutes: row.defaultLengthMinutes || existingDefinition.defaultLengthMinutes
    });
  }

  const desiredShiftTypeNames = [...shiftTypeDefinitions.keys()];
  let upsertedShiftTypeCount = 0;

  await prisma.$transaction(async (transaction) => {
    if (parsedPayload.data.replaceExisting) {
      await transaction.application.deleteMany({
        where: { eventId: event.id }
      });

      await transaction.shift.deleteMany({
        where: { eventId: event.id }
      });

      await transaction.shiftType.deleteMany({
        where: {
          eventId: event.id,
          name: {
            notIn: desiredShiftTypeNames
          }
        }
      });
    }

    const existingShiftTypes = await transaction.shiftType.findMany({
      where: {
        eventId: event.id,
        name: {
          in: desiredShiftTypeNames
        }
      }
    });
    const existingShiftTypeIdsByName = new Map(existingShiftTypes.map((shiftType) => [shiftType.name, shiftType.id]));

    for (const [shiftTypeName, definition] of shiftTypeDefinitions) {
      const existingShiftTypeId = existingShiftTypeIdsByName.get(shiftTypeName);

      if (existingShiftTypeId) {
        await transaction.shiftType.update({
          where: { id: existingShiftTypeId },
          data: {
            description: definition.description,
            defaultLengthMinutes: definition.defaultLengthMinutes
          }
        });
      } else {
        await transaction.shiftType.create({
          data: {
            eventId: event.id,
            name: shiftTypeName,
            description: definition.description,
            defaultLengthMinutes: definition.defaultLengthMinutes
          }
        });
      }

      upsertedShiftTypeCount += 1;
    }

    const shiftTypes = await transaction.shiftType.findMany({
      where: { eventId: event.id }
    });
    const shiftTypeIdsByName = new Map(shiftTypes.map((shiftType) => [shiftType.name, shiftType.id]));

    await transaction.shift.createMany({
      data: importedRows.map((row) => {
        const shiftTypeId = shiftTypeIdsByName.get(row.shiftTypeName);

        if (!shiftTypeId) {
          throw new Error(`Schichttyp ${row.shiftTypeName} konnte nicht angelegt werden.`);
        }

        return {
          eventId: event.id,
          shiftTypeId,
          date: parseDateOnly(row.date),
          startTime: row.startTime,
          endTime: row.endTime,
          isPublic: row.isPublic,
          capacity: row.capacity,
          archived: false
        };
      })
    });
  });

  res.json({
    importedShiftCount: importedRows.length,
    upsertedShiftTypeCount,
    replaceExisting: parsedPayload.data.replaceExisting
  });
});

adminRouter.patch("/shifts/:id", async (req, res) => {
  const parsed = shiftSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid shift payload" });
    return;
  }

  const shift = await prisma.shift.findUnique({
    where: { id: req.params.id },
    include: {
      event: true,
      applications: {
        select: { status: true }
      }
    }
  });

  if (!shift || shift.eventId !== parsed.data.eventId) {
    res.status(404).json({ error: "Shift not found" });
    return;
  }

  const shiftType = await prisma.shiftType.findUnique({ where: { id: parsed.data.shiftTypeId } });

  if (!shiftType || shiftType.eventId !== parsed.data.eventId) {
    res.status(404).json({ error: "Shift type not found" });
    return;
  }

  const shiftDate = parseDateOnly(parsed.data.date);

  if (!isDateWithinRange(shiftDate, shift.event.startDate, shift.event.endDate)) {
    res.status(400).json({ error: "Shift date must be inside the event date range" });
    return;
  }

  if (!isValidTimeRange(parsed.data.startTime, parsed.data.endTime)) {
    res.status(400).json({ error: "Shift end time must be after the start time" });
    return;
  }

  const reserved = reservedCount(shift.applications);

  if (parsed.data.capacity < reserved) {
    res.status(400).json({ error: "Capacity cannot be lower than current reserved applications" });
    return;
  }

  const updatedShift = await prisma.shift.update({
    where: { id: shift.id },
    data: {
      shiftTypeId: parsed.data.shiftTypeId,
      date: shiftDate,
      startTime: parsed.data.startTime,
      endTime: parsed.data.endTime,
      isPublic: parsed.data.isPublic,
      capacity: parsed.data.capacity
    },
    include: {
      shiftType: {
        select: {
          id: true,
          eventId: true,
          name: true,
          description: true,
          defaultLengthMinutes: true
        }
      },
      applications: {
        select: { id: true, name: true, email: true, status: true, emailSent: true, createdAt: true }
      }
    }
  });

  res.json(serializeShift(updatedShift, { startDate: shift.event.startDate, endDate: shift.event.endDate }));
});

adminRouter.post("/applications/manual", async (req, res) => {
  const parsed = manualApplicationSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid manual application payload" });
    return;
  }

  const email = parsed.data.email.toLowerCase();
  const shift = await prisma.shift.findUnique({
    where: { id: parsed.data.shiftId },
    include: {
      event: true,
      applications: {
        select: { status: true }
      }
    }
  });

  if (!shift || shift.eventId !== parsed.data.eventId) {
    res.status(404).json({ error: "Shift not found" });
    return;
  }

  if (shift.archived) {
    res.status(409).json({ error: "Archivierten Schichten koennen keine Personen zugewiesen werden." });
    return;
  }

  const existingApplication = await prisma.application.findUnique({
    where: {
      eventId_email: {
        eventId: shift.eventId,
        email
      }
    }
  });

  if (existingApplication) {
    res.status(409).json({ error: "Diese E-Mail-Adresse hat bereits eine Bewerbung in diesem Event." });
    return;
  }

  if (parsed.data.status !== "REJECTED") {
    const reserved = reservedCount(shift.applications);

    if (reserved >= shift.capacity) {
      res.status(409).json({ error: "Diese Schicht ist bereits voll." });
      return;
    }
  }

  const application = await prisma.application.create({
    data: {
      eventId: shift.eventId,
      shiftId: shift.id,
      name: parsed.data.name,
      email,
      status: parsed.data.status,
      emailSent: parsed.data.emailSent
    }
  });

  res.status(201).json({
    id: application.id,
    status: application.status,
    emailSent: application.emailSent
  });
});

adminRouter.post("/shifts/:id/archive", async (req, res) => {
  const shift = await prisma.shift.update({
    where: { id: req.params.id },
    data: { archived: true },
    include: {
      event: true,
      shiftType: {
        select: {
          id: true,
          eventId: true,
          name: true,
          description: true,
          defaultLengthMinutes: true
        }
      },
      applications: {
        select: { id: true, name: true, email: true, status: true, emailSent: true, createdAt: true }
      }
    }
  });

  res.json(serializeShift(shift, { startDate: shift.event.startDate, endDate: shift.event.endDate }));
});

adminRouter.post("/shifts/:id/unarchive", async (req, res) => {
  const shift = await prisma.shift.update({
    where: { id: req.params.id },
    data: { archived: false },
    include: {
      event: true,
      shiftType: {
        select: {
          id: true,
          eventId: true,
          name: true,
          description: true,
          defaultLengthMinutes: true
        }
      },
      applications: {
        select: { id: true, name: true, email: true, status: true, emailSent: true, createdAt: true }
      }
    }
  });

  res.json(serializeShift(shift, { startDate: shift.event.startDate, endDate: shift.event.endDate }));
});

adminRouter.patch("/applications/:id/status", async (req, res) => {
  const parsed = statusSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid status payload" });
    return;
  }

  const application = await prisma.application.findUnique({
    where: { id: req.params.id },
    include: {
      shift: {
        include: {
          shiftType: {
            select: { name: true }
          },
          applications: {
            select: { id: true, status: true }
          }
        }
      }
    }
  });

  if (!application) {
    res.status(404).json({ error: "Application not found" });
    return;
  }

  const nextStatus = parsed.data.status;
  const currentStatus = application.status;

  if (currentStatus === "REJECTED" && nextStatus !== "REJECTED") {
    const reserved = application.shift.applications.filter((item) => item.status !== "REJECTED").length;

    if (reserved >= application.shift.capacity) {
      res.status(409).json({ error: "No remaining capacity for this shift" });
      return;
    }
  }

  const updated = await prisma.application.update({
    where: { id: application.id },
    data: { status: nextStatus }
  });

  if (nextStatus === "APPROVED" && currentStatus !== "APPROVED") {
    await sendEmail({
      to: application.email,
      subject: "Shifty application approved",
      body: `Hi ${application.name},\n\nYour application for ${application.shift.shiftType.name} on ${application.shift.date.toISOString().slice(0, 10)} from ${application.shift.startTime} to ${application.shift.endTime} has been approved.\n\nShifty`
    });
  }

  res.json({ id: updated.id, status: updated.status });
});

adminRouter.patch("/applications/:id/email-sent", async (req, res) => {
  const parsed = emailSentSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid email sent payload" });
    return;
  }

  const updated = await prisma.application.update({
    where: { id: req.params.id },
    data: { emailSent: parsed.data.emailSent }
  });

  res.json({ id: updated.id, emailSent: updated.emailSent });
});