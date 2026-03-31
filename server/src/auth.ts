import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

import { config } from "./config.js";

export const adminCookieName = "shifty_admin";

type AdminToken = {
  email: string;
  role: "admin";
};

export function signAdminToken(email: string) {
  return jwt.sign({ email, role: "admin" } satisfies AdminToken, config.jwtSecret, {
    expiresIn: "7d"
  });
}

export function readAdminToken(req: Request) {
  const token = req.cookies[adminCookieName];

  if (!token) {
    return null;
  }

  try {
    return jwt.verify(token, config.jwtSecret) as AdminToken;
  } catch {
    return null;
  }
}

export function setAdminCookie(res: Response, token: string) {
  res.cookie(adminCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

export function clearAdminCookie(res: Response) {
  res.clearCookie(adminCookieName, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  });
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const session = readAdminToken(req);

  if (!session) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  req.admin = session;
  next();
}

declare global {
  namespace Express {
    interface Request {
      admin?: AdminToken;
    }
  }
}