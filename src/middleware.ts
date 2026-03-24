import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { SESSION_COOKIE } from "@/lib/session";

function getSecret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    return new TextEncoder().encode("fallback-not-secure-only-dev");
  }
  return new TextEncoder().encode(s);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth/login") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api")) {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    if (!token) {
      return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    }
    try {
      const secret = getSecret();
      const { payload } = await jwtVerify(token, secret);
      if (payload.sub !== "planner" || payload.typ !== "planner") {
        return NextResponse.json({ error: "Ungültige Session." }, { status: 401 });
      }
    } catch {
      return NextResponse.json({ error: "Ungültige Session." }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/dienstplan") || pathname.startsWith("/abrechnung")) {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    if (!token) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    try {
      const secret = getSecret();
      await jwtVerify(token, secret);
    } catch {
      return NextResponse.redirect(new URL("/login", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dienstplan/:path*",
    "/mitarbeiter/:path*",
    "/feiertage/:path*",
    "/abrechnung/:path*",
    "/api/:path*",
  ],
};
