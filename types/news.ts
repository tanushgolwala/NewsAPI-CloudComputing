export interface Article {
  id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  is_activated: boolean;
  title: string;
  description: string;
  link: string;
  image_url: string | null;
  author: string | null;
  tags: string | null;
  hash_val: string | null;
  s3_url: string | null;
  bias: number | null;
}

export type TopicKey = string;

export type TopicNewsMap = Record<TopicKey, Article[]>;

export interface TopicNewsResponse {
  topics: TopicNewsMap;
}

export interface PreferenceQueueResponse {
  queued: boolean;
  queueKey: string;
}
