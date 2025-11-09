import { NextRequest, NextResponse } from "next/server";
import type { TopicNewsResponse } from "@/types/news";

const backendBaseUrl =
  process.env.NEWS_API_BASE_URL ?? "http://localhost:8080";

async function forwardNewsByQuery(query: string) {
  try {
    const response = await fetch(`${backendBaseUrl}/news-by-query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      const errorText = await response.text();

      return NextResponse.json(
        { error: "Failed to fetch news for query", detail: errorText },
        { status: response.status },
      );
    }

    const data = (await response.json()) as TopicNewsResponse;

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: "Unable to reach news backend", detail: String(error) },
      { status: 502 },
    );
  }
}

function sanitizeQuery(value: string | null) {
  return (value ?? "").trim();
}

async function extractQueryFromBody(request: NextRequest) {
  try {
    const payload = await request.json();
    if (typeof payload?.query === "string") {
      return payload.query.trim();
    }
  } catch {
    // Ignore body parse errors
  }

  return "";
}

export async function GET(request: NextRequest) {
  const query = sanitizeQuery(request.nextUrl.searchParams.get("query"));

  if (!query) {
    return NextResponse.json(
      { error: "query parameter is required" },
      { status: 400 },
    );
  }

  return forwardNewsByQuery(query);
}

export async function POST(request: NextRequest) {
  const query = sanitizeQuery(await extractQueryFromBody(request));

  if (!query) {
    return NextResponse.json(
      { error: "query parameter is required" },
      { status: 400 },
    );
  }

  return forwardNewsByQuery(query);
}
