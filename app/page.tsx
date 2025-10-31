"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  describeError,
  formatTimestamp,
  parseErrorResponse,
} from "@/lib/news-utils";
import {
  DEFAULT_TOPIC_SELECTION,
  TOPICS,
  topicToSlug,
} from "@/lib/topics";
import type { TopicNewsMap } from "@/types/news";

const MAX_HISTORY_ITEMS = 5;
const HISTORY_STORAGE_KEY = "news-interest-history";
const LAST_TOPICS_STORAGE_KEY = "news-last-topics";

interface InterestSnapshot {
  timestamp: string;
  topics: string[];
  added: string[];
  removed: string[];
}

interface InterestDiff {
  added: string[];
  removed: string[];
  unchanged: string[];
}

function calculateDiff(current: string[], previous: string[]): InterestDiff {
  const currentSet = new Set(current);
  const previousSet = new Set(previous);

  const added = current.filter((topic) => !previousSet.has(topic));
  const removed = previous.filter((topic) => !currentSet.has(topic));
  const unchanged = current.filter((topic) => previousSet.has(topic));

  return { added, removed, unchanged };
}

function haveSameMembers(a: string[], b: string[]) {
  if (a.length !== b.length) {
    return false;
  }

  const setA = new Set(a);
  const setB = new Set(b);

  if (setA.size !== setB.size) {
    return false;
  }

  for (const item of setA) {
    if (!setB.has(item)) {
      return false;
    }
  }

  return true;
}

export default function Home() {
  const [selectedTopics, setSelectedTopics] =
    useState<string[]>(DEFAULT_TOPIC_SELECTION);
  const [previousTopics, setPreviousTopics] =
    useState<string[]>(DEFAULT_TOPIC_SELECTION);
  const [newsByTopic, setNewsByTopic] = useState<TopicNewsMap>({});
  const [interestHistory, setInterestHistory] = useState<InterestSnapshot[]>(
    [],
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRankingBiases, setIsRankingBiases] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [selectedAction, setSelectedAction] = useState<string>("refresh");
  const hasHydrated = useRef(false);

  const diffPreview = useMemo(
    () => calculateDiff(selectedTopics, previousTopics),
    [previousTopics, selectedTopics],
  );
  const actionOptions = useMemo(
    () => [
      { value: "refresh", label: "Refresh latest sources" },
      { value: "rank", label: "Rank biases" },
    ],
    [],
  );
  const isActionInFlight = isRefreshing || isRankingBiases || isLoading;

  const persistHistory = useCallback((history: InterestSnapshot[]) => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      HISTORY_STORAGE_KEY,
      JSON.stringify(history.slice(0, MAX_HISTORY_ITEMS)),
    );
  }, []);

  const persistLastTopics = useCallback((topics: string[]) => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      LAST_TOPICS_STORAGE_KEY,
      JSON.stringify(topics),
    );
  }, []);

  const loadNews = useCallback(
    async (
      topics: string[],
      options?: { enqueue?: boolean; baselineTopics?: string[] },
    ) => {
      const shouldEnqueue = options?.enqueue ?? true;
      const baseline = options?.baselineTopics ?? previousTopics;

      const trimmed = topics.map((topic) => topic.trim()).filter(Boolean);

      if (!trimmed.length) {
        setErrorMessage("Pick at least one topic to explore news.");
        return;
      }

      setIsLoading(true);
      setErrorMessage(null);

      try {
        if (shouldEnqueue) {
          const queueResponse = await fetch("/api/preferences", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              topics: trimmed,
              source: "news-intelligence-hub",
            }),
          });

          if (!queueResponse.ok) {
            throw new Error(await parseErrorResponse(queueResponse));
          }
        }

        const newsResponse = await fetch("/api/news", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            topics: trimmed,
          }),
        });

        if (!newsResponse.ok) {
          throw new Error(await parseErrorResponse(newsResponse));
        }

        const payload = (await newsResponse.json()) as {
          topics?: TopicNewsMap;
        };

        const topicsMap = payload.topics ?? {};
        const diff = calculateDiff(trimmed, baseline);

        setPreviousTopics((prev) =>
          haveSameMembers(prev, trimmed) ? prev : trimmed,
        );

        if (!haveSameMembers(baseline, trimmed)) {
          persistLastTopics(trimmed);
        }

        const totalArticles = Object.values(topicsMap).reduce(
          (total, group) => total + (Array.isArray(group) ? group.length : 0),
          0,
        );

        if (totalArticles === 0) {
          setNewsByTopic({});
          setErrorMessage(
            "No stored stories were returned for these topics yet. Try again later.",
          );
          setActionMessage(null);
          return;
        }

        setNewsByTopic(topicsMap);

        const snapshot: InterestSnapshot = {
          timestamp: new Date().toISOString(),
          topics: trimmed,
          added: diff.added,
          removed: diff.removed,
        };

        setInterestHistory((prev) => {
          const shouldLog =
            diff.added.length > 0 ||
            diff.removed.length > 0 ||
            prev.length === 0;

          if (!shouldLog) {
            return prev;
          }

          const nextHistory = [snapshot, ...prev].slice(0, MAX_HISTORY_ITEMS);
          persistHistory(nextHistory);
          return nextHistory;
        });

        const activeTopics = Object.keys(topicsMap).filter(
          (topic) => (topicsMap[topic]?.length ?? 0) > 0,
        );

        setActionMessage(
          totalArticles
            ? `Loaded ${totalArticles} articles across ${activeTopics.length} topic${activeTopics.length === 1 ? "" : "s"}.`
            : "No stored articles were returned for these topics yet. Try refreshing the sources.",
        );
      } catch (error) {
        setErrorMessage(describeError(error));
      } finally {
        setIsLoading(false);
      }
    },
    [persistHistory, persistLastTopics, previousTopics],
  );

  const topicCards = useMemo(() => {
    const mergedTopics = Array.from(
      new Set([...selectedTopics, ...Object.keys(newsByTopic)]),
    ).filter((topic): topic is string => Boolean(topic && topic.trim()));

    return mergedTopics.map((topic) => {
      const articles = newsByTopic[topic] ?? [];
      const mostRecent =
        articles?.[0] ??
        null;

      return {
        topic,
        count: Array.isArray(articles) ? articles.length : 0,
        latestTitle: mostRecent?.title ?? null,
        updatedAt: mostRecent?.updated_at ?? mostRecent?.created_at ?? null,
      };
    });
  }, [newsByTopic, selectedTopics]);

  useEffect(() => {
    if (hasHydrated.current) {
      return;
    }

    hasHydrated.current = true;

    if (typeof window === "undefined") {
      return;
    }

    try {
      const storedHistory = window.localStorage.getItem(HISTORY_STORAGE_KEY);
      if (storedHistory) {
        const parsed = JSON.parse(storedHistory) as InterestSnapshot[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setInterestHistory(parsed.slice(0, MAX_HISTORY_ITEMS));
        }
      }
    } catch {
      // Ignore corrupted history.
    }

    try {
      const storedTopics = window.localStorage.getItem(
        LAST_TOPICS_STORAGE_KEY,
      );

      if (storedTopics) {
        const parsed = JSON.parse(storedTopics);

        if (Array.isArray(parsed) && parsed.length > 0) {
          const sanitized = parsed
            .map((topic) => String(topic).trim())
            .filter(Boolean);

          if (!sanitized.length) {
            return;
          }

          setSelectedTopics(sanitized);
          setPreviousTopics((prev) =>
            haveSameMembers(prev, sanitized) ? prev : sanitized,
          );
          loadNews(sanitized, {
            enqueue: false,
            baselineTopics: sanitized,
          }).catch(() => {
            /* handled in loadNews */
          });
        }
      }
    } catch {
      // Ignore corrupted topic cache.
    }
  }, [loadNews]);

  const handleTopicToggle = (topic: string) => {
    setSelectedTopics((current) => {
      if (current.includes(topic)) {
        return current.filter((item) => item !== topic);
      }

      return [...current, topic];
    });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await loadNews(selectedTopics);
  };

  const handleRefreshSources = async () => {
    if (isRefreshing) {
      return;
    }

    setIsRefreshing(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/news/refresh");
      if (!response.ok) {
        throw new Error(await parseErrorResponse(response));
      }

      setActionMessage("Fetched the latest stories. Reloading your feed...");
      await loadNews(selectedTopics, { enqueue: false });
    } catch (error) {
      setErrorMessage(describeError(error));
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleRankBiases = async () => {
    if (isRankingBiases) {
      return;
    }

    setIsRankingBiases(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/news/rank-biases");
      if (!response.ok) {
        throw new Error(await parseErrorResponse(response));
      }

      setActionMessage("Bias scores updated. Refreshing your personalised view...");
      await loadNews(selectedTopics, { enqueue: false });
    } catch (error) {
      setErrorMessage(describeError(error));
    } finally {
      setIsRankingBiases(false);
    }
  };

  const handleActionRun = async () => {
    if (selectedAction === "refresh") {
      await handleRefreshSources();
      return;
    }

    if (selectedAction === "rank") {
      await handleRankBiases();
    }
  };

  const articlesReturned = useMemo(() => {
    return Object.values(newsByTopic).reduce(
      (total, group) => total + (Array.isArray(group) ? group.length : 0),
      0,
    );
  }, [newsByTopic]);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#1f2937,_#0f172a_60%)] text-slate-100">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-12 md:px-10 lg:px-16">
        <header className="space-y-4 rounded-3xl bg-white/[0.03] p-8 backdrop-blur-sm md:p-12">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 py-1 text-xs uppercase tracking-[0.3em] text-slate-300">
            Curate. Queue. Discover.
          </span>
          <h1 className="text-3xl font-semibold leading-tight text-white sm:text-4xl lg:text-5xl">
            Craft your bias-aware news briefing in seconds.
          </h1>
          <p className="max-w-3xl text-base text-slate-300 sm:text-lg">
            Choose the topics that matter, queue preferences to Redis on
            Upstash, and explore personalised headlines aggregated from your
            backend. Track how your interests evolve over time and surface fresh
            insights on demand.
          </p>
          <div className="flex flex-col gap-4 pt-2 sm:flex-row sm:items-center">
            <div className="flex flex-wrap items-center gap-3">
              <label
                htmlFor="action-selector"
                className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-300"
              >
                Quick actions
              </label>
              <select
                id="action-selector"
                value={selectedAction}
                onChange={(event) => setSelectedAction(event.target.value)}
                disabled={isActionInFlight}
                className="rounded-full border border-white/20 bg-white/[0.08] px-4 py-2 text-sm font-medium text-white shadow-inner focus:border-white focus:outline-none disabled:cursor-not-allowed disabled:border-white/10 disabled:text-slate-300"
              >
                {actionOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={handleActionRun}
              disabled={isActionInFlight}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-indigo-500 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-indigo-500/60"
            >
              {isActionInFlight ? "Working…" : "Run selected action"}
            </button>
          </div>
        </header>

        <div className="grid gap-8 lg:grid-cols-[340px,1fr]">
          <form
            onSubmit={handleSubmit}
            className="flex h-full flex-col gap-6 rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-xl shadow-black/20 backdrop-blur md:p-8"
          >
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-white">
                Choose your focus areas
              </h2>
              <p className="text-sm text-slate-300">
                Your selections are queued to Upstash and used to fetch stored
                stories from the news service.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {TOPICS.map((topic) => {
                const isSelected = selectedTopics.includes(topic);

                return (
                  <label
                    key={topic}
                    className={`flex cursor-pointer items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm font-medium transition ${
                      isSelected
                        ? "border-emerald-400/80 bg-emerald-500/10 text-emerald-200"
                        : "border-white/10 bg-white/[0.02] text-slate-200 hover:border-white/30"
                    }`}
                  >
                    <span>{topic}</span>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleTopicToggle(topic)}
                      className="h-4 w-4 rounded border-white/30 bg-transparent text-emerald-400 focus:ring-emerald-300"
                    />
                  </label>
                );
              })}
            </div>

            <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-300">
                Interest preview
              </p>
              <div className="flex flex-wrap gap-2 text-xs">
                <div className="flex flex-wrap gap-2">
                  {diffPreview.added.length ? (
                    diffPreview.added.map((topic, index) => (
                      <span
                        key={`added-${topic}-${index}`}
                        className="rounded-full bg-emerald-500/10 px-3 py-1 text-emerald-300"
                      >
                        + {topic}
                      </span>
                    ))
                  ) : (
                    <span className="rounded-full bg-white/[0.04] px-3 py-1 text-slate-300">
                      No new topics
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {diffPreview.removed.length ? (
                    diffPreview.removed.map((topic, index) => (
                      <span
                        key={`removed-${topic}-${index}`}
                        className="rounded-full bg-rose-500/10 px-3 py-1 text-rose-300"
                      >
                        – {topic}
                      </span>
                    ))
                  ) : (
                    <span className="rounded-full bg-white/[0.04] px-3 py-1 text-slate-300">
                      No removals
                    </span>
                  )}
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading || selectedTopics.length === 0}
              className="mt-auto inline-flex items-center justify-center gap-2 rounded-full bg-emerald-500 px-6 py-3 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-emerald-500/60"
            >
              {isLoading ? "Syncing preferences…" : "Explore personalised news"}
            </button>
          </form>

          <div className="flex flex-col gap-6">
            {(errorMessage || actionMessage) && (
              <div
                className={`rounded-2xl border p-4 text-sm shadow-lg ${
                  errorMessage
                    ? "border-rose-400/40 bg-rose-500/10 text-rose-100"
                    : "border-emerald-400/40 bg-emerald-500/10 text-emerald-100"
                }`}
              >
                {errorMessage ?? actionMessage}
              </div>
            )}

            <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 shadow-xl shadow-black/20 md:p-8">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-2xl font-semibold text-white">
                    Personalised headlines
                  </h2>
                  <p className="text-sm text-slate-300">
                    {articlesReturned
                      ? `Showing ${articlesReturned} articles for ${Object.keys(newsByTopic).length} topic${Object.keys(newsByTopic).length === 1 ? "" : "s"}.`
                      : "Launch a sync to pull the latest stories for your chosen topics."}
                  </p>
                </div>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {topicCards.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-6 py-12 text-center text-sm text-slate-300">
                    Pick topics and sync to populate your personalised briefings.
                  </div>
                ) : (
                  topicCards.map((card) => {
                    const slug = topicToSlug(card.topic);
                    if (!slug) {
                      return null;
                    }
                    const articlesLabel =
                      card.count === 1
                        ? "1 stored story"
                        : `${card.count} stored stories`;

                    return (
                      <div
                        key={card.topic}
                        className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.02] p-5 shadow-lg shadow-black/10"
                      >
                        <div className="space-y-2">
                          <h3 className="text-xl font-semibold text-white">
                            {card.topic}
                          </h3>
                          <p className="text-xs uppercase tracking-[0.35em] text-slate-400">
                            {articlesLabel}
                          </p>
                          <p className="text-sm text-slate-300">
                            {card.latestTitle
                              ? `Latest: ${card.latestTitle}`
                              : "No stored stories yet. Try refreshing sources."}
                          </p>
                        </div>
                        <div className="mt-auto space-y-2 text-[11px] text-slate-400">
                          <p>
                            <span className="uppercase tracking-[0.2em]">
                              Last update:
                            </span>{" "}
                            {card.updatedAt
                              ? formatTimestamp(card.updatedAt)
                              : "Not available"}
                          </p>
                          <Link
                            href={{
                              pathname: `/topics/${slug}`,
                              query: { label: card.topic },
                            }}
                            className="inline-flex items-center gap-2 rounded-full bg-emerald-500/90 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400"
                          >
                            Open briefing
                          </Link>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-white/[0.02] p-6 shadow-lg md:p-8">
              <h2 className="text-xl font-semibold text-white">
                Interest timeline
              </h2>
              <p className="text-sm text-slate-300">
                We capture a lightweight history of preference changes so you
                can spot emerging themes.
              </p>

              <div className="mt-5 space-y-4">
                {interestHistory.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-5 py-10 text-center text-sm text-slate-300">
                    Adjust your topics and sync to build an interest trail.
                  </div>
                )}

                {interestHistory.map((entry) => (
                  <div
                    key={entry.timestamp}
                    className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.04] p-5"
                  >
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm font-semibold text-white">
                        {formatTimestamp(entry.timestamp)}
                      </p>
                      <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                        {entry.topics.length} active topic
                        {entry.topics.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {entry.topics.map((topic, index) => (
                        <span
                          key={`${entry.timestamp}-${topic}-${index}`}
                          className="rounded-full bg-white/[0.08] px-3 py-1 text-slate-200"
                        >
                          {topic}
                        </span>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2 text-[11px]">
                      {entry.added.length > 0 ? (
                        entry.added.map((topic, index) => (
                          <span
                            key={`history-${entry.timestamp}-added-${topic}-${index}`}
                            className="rounded-full bg-emerald-500/10 px-3 py-1 text-emerald-200"
                          >
                            + {topic}
                          </span>
                        ))
                      ) : (
                        <span className="rounded-full bg-white/[0.05] px-3 py-1 text-slate-300">
                          No new topics
                        </span>
                      )}
                      {entry.removed.length > 0 ? (
                        entry.removed.map((topic, index) => (
                          <span
                            key={`history-${entry.timestamp}-removed-${topic}-${index}`}
                            className="rounded-full bg-rose-500/10 px-3 py-1 text-rose-200"
                          >
                            – {topic}
                          </span>
                        ))
                      ) : (
                        <span className="rounded-full bg-white/[0.05] px-3 py-1 text-slate-300">
                          No removals
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
