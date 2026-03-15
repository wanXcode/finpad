import { NextRequest, NextResponse } from "next/server";

const API_BACKEND = process.env.API_BACKEND || "http://127.0.0.1:8000";

export async function GET(req: NextRequest) {
  return proxy(req);
}
export async function POST(req: NextRequest) {
  return proxy(req);
}
export async function PUT(req: NextRequest) {
  return proxy(req);
}
export async function PATCH(req: NextRequest) {
  return proxy(req);
}
export async function DELETE(req: NextRequest) {
  return proxy(req);
}

async function proxy(req: NextRequest) {
  // Strip the /api/proxy prefix, keep /api/...
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/proxy/, "");
  const target = `${API_BACKEND}${path}${url.search}`;

  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    if (!["host", "connection", "transfer-encoding"].includes(k.toLowerCase())) {
      headers[k] = v;
    }
  });

  const body = req.method !== "GET" && req.method !== "HEAD" ? await req.text() : undefined;

  try {
    const res = await fetch(target, {
      method: req.method,
      headers,
      body,
    });

    const data = await res.text();
    return new NextResponse(data, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") || "application/json",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: "Backend unreachable" }, { status: 502 });
  }
}
