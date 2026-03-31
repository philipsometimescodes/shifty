import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFilePath);
const defaultOutputPath = path.resolve(currentDirectory, "../../../client/public/current-shifts.csv");

dotenv.config({ path: path.resolve(currentDirectory, "../../.env") });

const prisma = new PrismaClient();

function escapeCsvCell(value: string | number | boolean) {
  const text = `${value}`;

  if (!/[",\n]/.test(text)) {
    return text;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

async function main() {
  const outputPath = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : defaultOutputPath;
  const event = await prisma.event.findFirst({
    orderBy: { createdAt: "asc" },
    include: {
      shifts: {
        where: { archived: false },
        orderBy: [{ date: "asc" }, { startTime: "asc" }, { shiftType: { name: "asc" } }],
        include: {
          shiftType: true
        }
      }
    }
  });

  if (!event) {
    throw new Error("Kein Event gefunden.");
  }

  const header = [
    "shiftTypeName",
    "shiftTypeDescription",
    "defaultLengthMinutes",
    "date",
    "startTime",
    "endTime",
    "capacity",
    "isPublic"
  ];
  const lines = [header.join(",")];

  for (const shift of event.shifts) {
    lines.push(
      [
        shift.shiftType.name,
        shift.shiftType.description,
        shift.shiftType.defaultLengthMinutes,
        shift.date.toISOString().slice(0, 10),
        shift.startTime,
        shift.endTime,
        shift.capacity,
        shift.isPublic
      ]
        .map((value) => escapeCsvCell(value))
        .join(",")
    );
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        outputPath,
        shiftCount: event.shifts.length
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