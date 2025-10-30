export const TOPICS = [
  "Technology",
  "Climate",
  "Economy",
  "Health",
  "Diplomacy",
  "Culture",
] as const;

export type TopicName = (typeof TOPICS)[number];

export const DEFAULT_TOPIC_SELECTION: TopicName[] = [...TOPICS].slice(0, 3);

export function topicToSlug(topic?: string | null) {
  if (!topic) {
    return "";
  }

  return topic.toString().trim().toLowerCase().replace(/\s+/g, "-");
}

export function slugToTopic(slug?: string | null) {
  if (!slug) {
    return null;
  }

  const normalised = slug.toString().trim().toLowerCase();
  if (!normalised) {
    return null;
  }

  return TOPICS.find((topic) => topicToSlug(topic) === normalised) ?? null;
}
