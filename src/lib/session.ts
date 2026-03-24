import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "dienstplan_session";

function getSecret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error("SESSION_SECRET fehlt oder ist zu kurz (min. 16 Zeichen).");
  }
  return new TextEncoder().encode(s);
}

export type SessionPayload = {
  sub: string;
  typ: "planner";
};

export function sessionCookieOptions(): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  };
}

export async function createSessionToken(): Promise<string> {
  const secret = getSecret();
  return new SignJWT({ typ: "planner" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("planner")
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}

export async function verifySessionToken(
  token: string
): Promise<SessionPayload | null> {
  try {
    const secret = getSecret();
    const { payload } = await jwtVerify(token, secret);
    if (payload.sub !== "planner" || payload.typ !== "planner") return null;
    return { sub: payload.sub as string, typ: "planner" };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const t = jar.get(SESSION_COOKIE)?.value;
  if (!t) return null;
  return verifySessionToken(t);
}
