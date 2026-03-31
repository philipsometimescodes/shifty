import { Router } from "express";
import { z } from "zod";

import { clearAdminCookie, readAdminToken, setAdminCookie, signAdminToken } from "../auth.js";
import { config } from "../config.js";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export const authRouter = Router();

authRouter.post("/login", (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid login payload" });
    return;
  }

  const email = parsed.data.email.toLowerCase();

  if (email !== config.adminEmail || parsed.data.password !== config.adminPassword) {
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