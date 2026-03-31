import { Router } from "express";
import { z } from "zod";

import { prisma } from "../db.js";
import { sendEmail } from "../email.js";
import { isDateWithinRange, reservedCount, serializeShift } from "../utils.js";

const applicationSchema = z.object({
  shiftId: z.string().min(1),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(320)
});

export const publicRouter = Router();

publicRouter.get("/event", async (_req, res) => {
  const event = await prisma.event.findFirst({
    orderBy: { createdAt: "desc" },
    include: {
      shifts: {
        where: { archived: false, isPublic: true },
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
    res.json({ event: null, shifts: [] });
    return;
  }

  const publicShifts = event.shifts
    .map((shift) => serializeShift(shift, { startDate: event.startDate, endDate: event.endDate }))
    .filter((shift) => shift.insideEventRange);

  res.json({
    event: {
      id: event.id,
      name: event.name,
      startDate: event.startDate.toISOString().slice(0, 10),
      endDate: event.endDate.toISOString().slice(0, 10)
    },
    shifts: publicShifts
  });
});

publicRouter.post("/applications", async (req, res) => {
  const parsed = applicationSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid application payload" });
    return;
  }

  const email = parsed.data.email.toLowerCase();
  const shift = await prisma.shift.findUnique({
    where: { id: parsed.data.shiftId },
    include: {
      event: true,
      shiftType: {
        select: {
          name: true,
          description: true,
          defaultLengthMinutes: true
        }
      },
      applications: {
        select: { status: true }
      }
    }
  });

  if (!shift || shift.archived || !shift.isPublic || !isDateWithinRange(shift.date, shift.event.startDate, shift.event.endDate)) {
    res.status(404).json({ error: "Shift not available" });
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
    res.status(409).json({ error: "This email already has an application in the current event" });
    return;
  }

  const reserved = reservedCount(shift.applications);

  if (reserved >= shift.capacity) {
    res.status(409).json({ error: "This shift is already full" });
    return;
  }

  const application = await prisma.application.create({
    data: {
      eventId: shift.eventId,
      shiftId: shift.id,
      name: parsed.data.name,
      email,
      status: "PENDING",
      emailSent: false
    }
  });

  await sendEmail({
    to: email,
    subject: "Shifty application received",
    body: `Hi ${parsed.data.name},\n\nYour application for ${shift.shiftType.name} on ${shift.date.toISOString().slice(0, 10)} from ${shift.startTime} to ${shift.endTime} is now pending review.\n\nShifty`
  });

  res.status(201).json({ id: application.id, status: application.status });
});