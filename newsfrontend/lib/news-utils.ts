export function formatTimestamp(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function describeError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Something went wrong. Please try again.";
}

export async function parseErrorResponse(response: Response) {
  try {
    const data = await response.json();
    if (data?.error) {
      return typeof data.error === "string"
        ? data.error
        : JSON.stringify(data.error);
    }
    if (data?.detail) {
      return typeof data.detail === "string"
        ? data.detail
        : JSON.stringify(data.detail);
    }
  } catch {
    // Ignore JSON parse failure.
  }

  try {
    const text = await response.text();
    if (text) {
      return text;
    }
  } catch {
    // Ignore text parse failure.
  }

  return response.statusText || "Unexpected error";
}
