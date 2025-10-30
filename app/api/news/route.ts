import { NextRequest, NextResponse } from "next/server";
import type { TopicNewsResponse } from "@/types/news";

const backendBaseUrl =
  process.env.NEWS_API_BASE_URL ?? "http://localhost:8080";

interface TopicRequestPayload {
  topics?: string[];
}

export async function POST(request: NextRequest) {
  let body: TopicRequestPayload;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload" },
      { status: 400 },
    );
  }

  const topics = Array.isArray(body?.topics)
    ? body.topics.map((topic) => String(topic).trim()).filter(Boolean)
    : [];

  if (!topics.length) {
    return NextResponse.json(
      { error: "At least one topic must be provided" },
      { status: 400 },
    );
  }

  try {
    const response = await fetch(`${backendBaseUrl}/get-news-by-topic`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ topics }),
    });

    if (!response.ok) {
      const errorText = await response.text();

      return NextResponse.json(
        { error: "Failed to fetch news", detail: errorText },
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
