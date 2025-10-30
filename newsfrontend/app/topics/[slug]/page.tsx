import { notFound } from "next/navigation";
import { slugToTopic, topicToSlug } from "@/lib/topics";
import TopicClient from "./topic-client";

interface TopicPageProps {
  params: {
    slug: string | string[] | undefined;
  };
  searchParams?:
    | Record<string, string | string[] | undefined>
    | Promise<Record<string, string | string[] | undefined>>;
}

function toDisplayLabel(value?: string | null) {
  const normalised = value?.trim().replace(/\s+/g, "-") ?? "";
  if (!normalised) {
    return "";
  }

  return normalised
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function firstString(value?: string | string[] | null) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : "";
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string") {
        const trimmed = entry.trim();
        if (trimmed.length > 0) {
          return trimmed;
        }
      }
    }
  }

  return "";
}

export default async function TopicPage({ params, searchParams }: TopicPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const labelValue = firstString(resolvedSearchParams?.label);
  const slugValue = firstString(params?.slug);

  const canonicalFromLabel = labelValue
    ? slugToTopic(topicToSlug(labelValue))
    : null;
  const canonicalFromSlug = slugValue ? slugToTopic(slugValue) : null;

  const requestTopic =
    canonicalFromLabel ??
    canonicalFromSlug ??
    labelValue ??
    toDisplayLabel(slugValue) ??
    slugValue;

  if (!requestTopic) {
    notFound();
  }

  const topicLabel =
    canonicalFromLabel ??
    labelValue ??
    canonicalFromSlug ??
    toDisplayLabel(slugValue) ??
    requestTopic;

  const fallbackSlug = topicToSlug(requestTopic) || topicToSlug(topicLabel) || slugValue || "topic";

  return (
    <TopicClient
      topicLabel={topicLabel}
      requestTopic={requestTopic}
      key={fallbackSlug}
    />
  );
}
