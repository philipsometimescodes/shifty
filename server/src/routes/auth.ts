import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { clearAdminCookie, readAdminToken, setAdminCookie, signAdminToken } from "../auth.js";
import { config } from "../config.js";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export const authRouter = Router();

function safeCompareSecret(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  const maxLength = Math.max(leftBuffer.length, rightBuffer.length, 1);
  const paddedLeft = Buffer.alloc(maxLength);
  const paddedRight = Buffer.alloc(maxLength);

  leftBuffer.copy(paddedLeft);
  rightBuffer.copy(paddedRight);

  const same = timingSafeEqual(paddedLeft, paddedRight);
  return same && leftBuffer.length === rightBuffer.length;
}

authRouter.post("/login", (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid login payload" });
    return;
  }

  const email = parsed.data.email.toLowerCase();

  if (email !== config.adminEmail || !safeCompareSecret(parsed.data.password, config.adminPassword)) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  setAdminCookie(res, signAdminToken(email));
  res.json({ authenticated: true, email });
});

authRouter.post("/logout", (_req, res) => {
  clearAdminCookie(res);
  res.status(204).send();
});

authRouter.get("/session", (req, res) => {
  const session = readAdminToken(req);

  if (!session) {
    res.json({ authenticated: false });
    return;
  }

  res.json({ authenticated: true, email: session.email });
});