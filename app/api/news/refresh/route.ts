import { NextResponse } from "next/server";

const backendBaseUrl =
  process.env.NEWS_API_BASE_URL ?? "http://localhost:8080";

export async function GET() {
  try {
    const response = await fetch(`${backendBaseUrl}/fetch-news`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();

      return NextResponse.json(
        { error: "Failed to refresh news", detail: errorText },
        { status: response.status },
      );
    }

    const data = await response.json();

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: "Unable to reach news backend", detail: String(error) },
      { status: 502 },
    );
  }
}
