import { NextRequest, NextResponse } from "next/server";

const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
const queueKey = process.env.UPSTASH_REDIS_QUEUE_KEY ?? "news:preferences";

interface PreferencePayload {
  topics?: string[];
  source?: string;
}

export async function POST(request: NextRequest) {
  let body: PreferencePayload;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload" },
      { status: 400 },
    );
  }

  const topics = Array.isArray(body?.topics)
    ? body.topics
        .map((topic) => String(topic).trim())
        .filter((topic) => topic.length > 0)
    : [];

  if (!topics.length) {
    return NextResponse.json(
      { error: "At least one topic must be provided" },
      { status: 400 },
    );
  }

  if (!redisUrl || !redisToken) {
    return NextResponse.json(
      { error: "Upstash Redis is not configured" },
      { status: 500 },
    );
  }

  const payload = {
    topics,
    source: body.source ?? "web",
    timestamp: new Date().toISOString(),
  };

  const response = await fetch(
    `${redisUrl}/lpush/${encodeURIComponent(queueKey)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${redisToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([JSON.stringify(payload)]),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();

    return NextResponse.json(
      { error: "Failed to enqueue preferences", detail: errorText },
      { status: 502 },
    );
  }

  return NextResponse.json({ queued: true, queueKey });
}
