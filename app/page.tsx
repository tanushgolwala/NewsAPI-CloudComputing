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
import type { Article, TopicNewsMap } from "@/types/news";

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

interface ToastMessage {
  id: number;
  message: string;
  tone: "add" | "remove";
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
  const [likedArticles, setLikedArticles] = useState<Record<string, boolean>>(
    {},
  );
  const [visibleFeedCount, setVisibleFeedCount] = useState(0);
  const feedContainerRef = useRef<HTMLDivElement | null>(null);
  const toastTimeouts = useRef<Record<number, ReturnType<typeof setTimeout>>>(
    {},
  );
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const previousFeedLength = useRef(0);

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

  const pushToast = useCallback(
    (message: string, tone: ToastMessage["tone"]) => {
      const id = Date.now() + Math.floor(Math.random() * 1_000);

      setToasts((current) => [...current, { id, message, tone }]);

      const timeoutId = setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
        delete toastTimeouts.current[id];
      }, 2800);

      toastTimeouts.current[id] = timeoutId;
    },
    [],
  );

  const getArticleKey = useCallback((topic: string, article: Article) => {
    const candidate =
      article.id ??
      article.hash_val ??
      article.s3_url ??
      article.link ??
      `${article.title ?? "untitled"}-${article.updated_at ?? article.created_at ?? "unknown"}`;

    return `${topic.trim().toLowerCase()}::${candidate}`;
  }, []);

  useEffect(() => {
    const registeredTimeouts = toastTimeouts.current;

    return () => {
      Object.values(registeredTimeouts).forEach((timeoutId) => {
        clearTimeout(timeoutId);
      });
    };
  }, []);

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

  const addTopicToSelection = useCallback(
    (
      topic: string,
      options?: { triggerSync?: boolean; showToast?: boolean },
    ) => {
      const trimmed = topic.trim();
      if (!trimmed) {
        return;
      }

      setSelectedTopics((current) => {
        if (current.includes(trimmed)) {
          return current;
        }

        const next = [...current, trimmed];

        if (options?.showToast ?? true) {
          pushToast(`${trimmed} added to your interests`, "add");
        }

        if (options?.triggerSync ?? true) {
          void loadNews(next, { baselineTopics: current });
        }

        return next;
      });
    },
    [loadNews, pushToast],
  );

  const removeTopicFromSelection = useCallback(
    (
      topic: string,
      options?: { triggerSync?: boolean; showToast?: boolean },
    ) => {
      setLikedArticles((current) => {
        if (!newsByTopic[topic]) {
          return current;
        }

        const updated = { ...current };
        for (const article of newsByTopic[topic] ?? []) {
          const key = getArticleKey(topic, article);
          if (updated[key]) {
            delete updated[key];
          }
        }

        return updated;
      });

      setSelectedTopics((current) => {
        if (!current.includes(topic)) {
          return current;
        }

        const next = current.filter((item) => item !== topic);

        if (options?.showToast ?? true) {
          pushToast(`${topic} removed from your interests`, "remove");
        }

        if (options?.triggerSync ?? true) {
          void loadNews(next, { baselineTopics: current });
        }

        return next;
      });
    },
    [getArticleKey, loadNews, newsByTopic, pushToast],
  );

  const handleArticleLikeToggle = useCallback(
    (article: Article, topic: string) => {
      const articleKey = getArticleKey(topic, article);
      let shouldAddTopic = false;

      setLikedArticles((current) => {
        const alreadyLiked = current[articleKey] ?? false;
        const nextLiked = !alreadyLiked;

        const updated = { ...current };
        if (nextLiked) {
          updated[articleKey] = true;
        } else {
          delete updated[articleKey];
        }

        if (!alreadyLiked && nextLiked) {
          shouldAddTopic = true;
        }

        return updated;
      });

      if (shouldAddTopic) {
        addTopicToSelection(topic);
      }
    },
    [addTopicToSelection, getArticleKey],
  );

  const handleArticleDismiss = useCallback(
    (article: Article, topic: string) => {
      const articleKey = getArticleKey(topic, article);

      setLikedArticles((current) => {
        if (!current[articleKey]) {
          return current;
        }

        const updated = { ...current };
        delete updated[articleKey];
        return updated;
      });

      removeTopicFromSelection(topic);
    },
    [getArticleKey, removeTopicFromSelection],
  );

  const suggestedTopics = useMemo(() => {
    return TOPICS.filter((topic) => !selectedTopics.includes(topic)).slice(
      0,
      8,
    );
  }, [selectedTopics]);

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

  const feedArticles = useMemo(() => {
    const aggregated: Array<{ topic: string; article: Article }> = [];

    Object.entries(newsByTopic).forEach(([topic, articles]) => {
      if (!Array.isArray(articles)) {
        return;
      }

      articles.forEach((article) => {
        aggregated.push({ topic, article });
      });
    });

    const getTimestamp = (article: Article) => {
      const candidate =
        article.updated_at ?? article.created_at ?? article.created_at;
      const parsed = candidate ? Date.parse(candidate) : NaN;
      return Number.isNaN(parsed) ? 0 : parsed;
    };

    aggregated.sort(
      (a, b) => getTimestamp(b.article) - getTimestamp(a.article),
    );

    return aggregated;
  }, [newsByTopic]);

  const totalFeedArticles = feedArticles.length;

  useEffect(() => {
    if (totalFeedArticles === previousFeedLength.current) {
      return;
    }

    previousFeedLength.current = totalFeedArticles;

    if (totalFeedArticles === 0) {
      setVisibleFeedCount(0);
      return;
    }

    setVisibleFeedCount((current) => {
      if (current === 0 || totalFeedArticles < current) {
        return Math.min(totalFeedArticles, 8);
      }

      return current;
    });
  }, [totalFeedArticles]);

  useEffect(() => {
    const container = feedContainerRef.current;
    if (!container) {
      return;
    }

    const handleScroll = () => {
      if (
        container.scrollTop + container.clientHeight >=
        container.scrollHeight - 80
      ) {
        setVisibleFeedCount((current) => {
          if (current >= totalFeedArticles) {
            return current;
          }

          return Math.min(totalFeedArticles, current + 5);
        });
      }
    };

    container.addEventListener("scroll", handleScroll);

    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, [totalFeedArticles]);

  const displayedArticles = useMemo(() => {
    if (visibleFeedCount === 0) {
      return [];
    }

    return feedArticles.slice(0, visibleFeedCount);
  }, [feedArticles, visibleFeedCount]);

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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#151515,_#050505_65%)] text-zinc-100">
      <div className="pointer-events-none fixed right-6 top-6 z-50 flex flex-col gap-3">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`rounded-2xl px-4 py-3 text-sm font-semibold shadow-lg shadow-black/40 ${
              toast.tone === "add"
                ? "bg-orange-500/95 text-black"
                : "bg-rose-500/90 text-rose-50"
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-12 md:px-10 lg:px-16">
        <header className="space-y-4 rounded-3xl border border-orange-500/10 bg-black/30 p-8 shadow-lg shadow-black/40 backdrop-blur-sm md:p-12">
          <span className="inline-flex items-center gap-2 rounded-full border border-orange-500/30 bg-orange-500/15 px-4 py-1 text-xs uppercase tracking-[0.3em] text-orange-200">
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
                className="rounded-full border border-orange-500/20 bg-black/40 px-4 py-2 text-sm font-medium text-white shadow-inner focus:border-orange-400 focus:outline-none disabled:cursor-not-allowed disabled:border-orange-500/20 disabled:text-zinc-500"
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
              className="inline-flex items-center justify-center gap-2 rounded-full bg-orange-600 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-orange-500/20 transition hover:bg-orange-500 disabled:cursor-not-allowed disabled:bg-orange-600/70"
            >
              {isActionInFlight ? "Working…" : "Run selected action"}
            </button>
          </div>
        </header>

        {(errorMessage || actionMessage) && (
          <div
            className={`rounded-2xl border p-4 text-sm shadow-lg ${
              errorMessage
                ? "border-rose-400/40 bg-rose-500/10 text-rose-100"
                : "border-orange-400/40 bg-orange-500/10 text-orange-100"
            }`}
          >
            {errorMessage ?? actionMessage}
          </div>
        )}

        <section className="rounded-3xl border border-orange-500/10 bg-black/30 p-6 shadow-xl shadow-black/40 md:p-8">
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

          <div className="mt-6 flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
            <div className="flex-1 rounded-2xl border border-orange-500/10 bg-black/40 p-3 sm:p-4">
              <div
                ref={feedContainerRef}
                className="flex max-h-[560px] flex-col gap-4 overflow-y-auto pr-2 sm:pr-3 lg:max-h-[70vh]"
              >
                {displayedArticles.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-orange-500/20 bg-black/40 px-6 py-12 text-center text-sm text-slate-300">
                    {articlesReturned
                      ? "Scroll the feed and start liking the stories that stand out to refine your interests."
                      : "Sync your feed or tap a suggestion to start collecting stories."}
                  </div>
                ) : (
                  displayedArticles.map(({ topic, article }) => {
                    const articleKey = getArticleKey(topic, article);
                    const isLiked = Boolean(likedArticles[articleKey]);
                    const timestamp =
                      article.updated_at ?? article.created_at ?? null;
                    const slug = topicToSlug(topic);
                    const articleImage =
                      article.image_url ?? article.s3_url ?? null;

                    return (
                      <article
                        key={articleKey}
                        className="flex flex-col gap-4 rounded-2xl border border-orange-500/10 bg-black/50 p-5 shadow-lg shadow-black/40 transition hover:border-orange-400/40"
                      >
                        {articleImage && (
                          <div className="overflow-hidden rounded-2xl border border-orange-500/15 bg-black/40">
                            <div
                              role="img"
                              aria-label={article.title ?? topic}
                              className="h-44 w-full bg-cover bg-center sm:h-56"
                              style={{
                                backgroundImage: `linear-gradient(0deg, rgba(0,0,0,0.45), rgba(0,0,0,0.45)), url(${articleImage})`,
                              }}
                            />
                          </div>
                        )}
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <span className="rounded-full border border-orange-500/20 bg-orange-500/15 px-3 py-1 text-[11px] uppercase tracking-[0.35em] text-orange-100">
                            {topic}
                          </span>
                          {typeof article.bias === "number" && (
                            <span className="rounded-full border border-orange-500/20 bg-black/45 px-3 py-1 text-[11px] text-zinc-300">
                              Bias score {article.bias.toFixed(1)}
                            </span>
                          )}
                        </div>
                        <div className="space-y-2">
                          <h3 className="text-lg font-semibold leading-tight text-white">
                            {article.title}
                          </h3>
                          {article.description && (
                            <p className="text-sm text-slate-200">
                              {article.description}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
                          <span>
                            Updated{" "}
                            {timestamp ? formatTimestamp(timestamp) : "recently"}
                          </span>
                          {article.author && <span>By {article.author}</span>}
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                          <button
                            type="button"
                            onClick={() => handleArticleLikeToggle(article, topic)}
                            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
                              isLiked
                                ? "bg-orange-500 text-black shadow-lg shadow-orange-500/30"
                                : "bg-black/40 text-zinc-100 hover:bg-black/60"
                            }`}
                          >
                            {isLiked ? "Liked" : "Like"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleArticleDismiss(article, topic)}
                            className="inline-flex items-center gap-2 rounded-full border border-orange-500/25 bg-black/40 px-4 py-2 text-sm font-semibold text-orange-100 transition hover:border-rose-500/60 hover:bg-rose-500/15 hover:text-rose-100"
                          >
                            Not for me
                          </button>
                          {article.link && (
                            <a
                              href={article.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ml-auto inline-flex items-center gap-2 rounded-full bg-orange-600/90 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-500"
                            >
                              Read source →
                            </a>
                          )}
                          {slug && (
                            <Link
                              href={{
                                pathname: `/topics/${slug}`,
                                query: { label: topic },
                              }}
                              className="inline-flex items-center gap-1 rounded-full border border-orange-500/25 bg-orange-500/10 px-3 py-1 text-xs font-semibold text-orange-100 transition hover:border-orange-400/60 hover:bg-orange-500/20 hover:text-white"
                            >
                              Open topic
                            </Link>
                          )}
                        </div>
                      </article>
                    );
                  })
                )}
                {displayedArticles.length > 0 &&
                  visibleFeedCount < totalFeedArticles && (
                    <div className="sticky bottom-2 flex justify-center">
                      <span className="rounded-full border border-orange-500/20 bg-orange-500/15 px-4 py-1 text-xs font-semibold uppercase tracking-[0.35em] text-orange-100">
                        Keep scrolling for more
                      </span>
                    </div>
                  )}
              </div>
            </div>
            <div className="w-full max-w-lg space-y-3 rounded-2xl border border-orange-500/10 bg-black/35 p-4 lg:w-[240px]">
              <div className="space-y-1.5">
                <h3 className="text-sm font-semibold uppercase tracking-[0.35em] text-slate-300">
                  Topic snapshots
                </h3>
                <p className="text-xs text-slate-400">
                  Quick pulse on how each focus area is performing.
                </p>
              </div>
              <div className="space-y-2.5">
                {topicCards.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-orange-500/20 bg-black/40 px-4 py-6 text-sm text-slate-300">
                    Start training your feed by liking stories you enjoy.
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
                        className="flex flex-col gap-2.5 rounded-2xl border border-orange-500/15 bg-black/45 p-3"
                      >
                        <div className="space-y-1">
                          <h4 className="text-base font-semibold text-white">
                            {card.topic}
                          </h4>
                          <p className="text-[11px] uppercase tracking-[0.35em] text-slate-400">
                            {articlesLabel}
                          </p>
                          <p className="text-xs text-slate-300">
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
                            className="inline-flex items-center gap-2 rounded-full bg-orange-500/90 px-3 py-1 text-xs font-semibold text-black transition hover:bg-orange-400"
                          >
                            Dive deeper
                          </Link>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </section>

        <form
          onSubmit={handleSubmit}
          className="flex w-full flex-col gap-6 rounded-3xl border border-orange-500/10 bg-black/35 p-6 shadow-xl shadow-black/40 backdrop-blur md:p-8 lg:mx-auto lg:max-w-3xl"
        >
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-white">
              Train your personalised briefing
            </h2>
            <p className="text-sm text-slate-300">
              Scroll through the feed, tap like on the stories that resonate, and
              we will keep your interest model in sync automatically.
            </p>
          </div>

          <div className="space-y-3 rounded-2xl border border-orange-500/15 bg-black/45 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-300">
              Your interests
            </p>
            {selectedTopics.length ? (
              <div className="flex flex-wrap gap-2">
                {selectedTopics.map((topic) => (
                  <button
                    key={`selected-${topic}`}
                    type="button"
                    onClick={() => removeTopicFromSelection(topic)}
                    className="group inline-flex items-center gap-2 rounded-full border border-orange-400/40 bg-orange-500/10 px-3 py-1 text-xs font-medium text-orange-50 transition hover:border-rose-400/50 hover:bg-rose-500/10 hover:text-rose-100"
                  >
                    {topic}
                    <span className="rounded-full bg-black/60 px-2 py-[2px] text-[10px] uppercase tracking-[0.25em] text-zinc-300 transition group-hover:bg-rose-500/40 group-hover:text-white">
                      Remove
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-300">
                Start liking stories to build your personalised interest map.
              </p>
            )}
          </div>

          <div className="space-y-3 rounded-2xl border border-dashed border-orange-500/25 bg-black/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-300">
              Suggested signals
            </p>
            <p className="text-xs text-slate-400">
              Give the model a nudge while it learns from your likes.
            </p>
            <div className="flex flex-wrap gap-2">
              {suggestedTopics.length ? (
                suggestedTopics.map((topic) => (
                  <button
                    key={`suggested-${topic}`}
                    type="button"
                    onClick={() => addTopicToSelection(topic)}
                    className="rounded-full border border-orange-500/25 bg-black/45 px-3 py-1 text-xs font-medium text-zinc-200 transition hover:border-orange-400/60 hover:bg-orange-500/20 hover:text-white"
                  >
                    + {topic}
                  </button>
                ))
              ) : (
                <span className="rounded-full bg-black/40 px-3 py-1 text-xs text-zinc-400">
                  All suggested topics are in play.
                </span>
              )}
            </div>
          </div>

          <div className="space-y-3 rounded-2xl border border-orange-500/15 bg-black/45 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-300">
              Live interest changes
            </p>
            <div className="flex flex-wrap gap-2 text-xs">
              <div className="flex flex-wrap gap-2">
                {diffPreview.added.length ? (
                  diffPreview.added.map((topic, index) => (
                    <span
                      key={`added-${topic}-${index}`}
                      className="rounded-full border border-orange-500/30 bg-orange-500/15 px-3 py-1 text-orange-200"
                    >
                      + {topic}
                    </span>
                  ))
                ) : (
                  <span className="rounded-full bg-black/40 px-3 py-1 text-zinc-400">
                    No new topics
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {diffPreview.removed.length ? (
                  diffPreview.removed.map((topic, index) => (
                    <span
                      key={`removed-${topic}-${index}`}
                      className="rounded-full border border-rose-500/30 bg-rose-500/15 px-3 py-1 text-rose-200"
                    >
                      – {topic}
                    </span>
                  ))
                ) : (
                  <span className="rounded-full bg-black/40 px-3 py-1 text-zinc-400">
                    No removals
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading || selectedTopics.length === 0}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-orange-500 px-6 py-3 text-sm font-semibold text-black transition hover:bg-orange-400 disabled:cursor-not-allowed disabled:bg-orange-500/60"
          >
            {isLoading ? "Syncing preferences…" : "Sync feed now"}
          </button>
          <p className="text-xs text-slate-400">
            We also refresh your briefing whenever you like or dismiss a story.
          </p>
        </form>

        <section className="mx-auto w-full max-w-4xl rounded-3xl border border-orange-500/10 bg-black/30 p-5 shadow-lg shadow-black/40 md:p-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">Interest timeline</h2>
              <p className="text-xs text-slate-400">
                Quick pulse of how your interests have shifted recently.
              </p>
            </div>
            <p className="text-[10px] uppercase tracking-[0.35em] text-orange-200">
              Last {Math.min(interestHistory.length, MAX_HISTORY_ITEMS)} updates
            </p>
          </div>

          <div className="mt-4 space-y-3">
            {interestHistory.length === 0 && (
              <div className="rounded-2xl border border-dashed border-orange-500/20 bg-black/40 px-4 py-8 text-center text-xs text-zinc-400">
                Like or remove topics to start building your timeline.
              </div>
            )}

            {interestHistory.map((entry) => (
              <div
                key={entry.timestamp}
                className="flex flex-col gap-3 rounded-2xl border border-orange-500/15 bg-black/45 px-4 py-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-300">
                  <span className="font-semibold text-white">
                    {formatTimestamp(entry.timestamp)}
                  </span>
                  <span className="uppercase tracking-[0.35em] text-zinc-500">
                    {entry.topics.length} topic{entry.topics.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px] text-zinc-200">
                  {entry.topics.map((topic, index) => (
                    <span
                      key={`${entry.timestamp}-topic-${topic}-${index}`}
                      className="rounded-full border border-orange-500/20 bg-black/50 px-2.5 py-1"
                    >
                      {topic}
                    </span>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2 text-[10px]">
                  {entry.added.length > 0 ? (
                    entry.added.map((topic, index) => (
                      <span
                        key={`${entry.timestamp}-added-${topic}-${index}`}
                        className="rounded-full border border-orange-500/30 bg-orange-500/15 px-2.5 py-[3px] text-orange-200"
                      >
                        + {topic}
                      </span>
                    ))
                  ) : (
                    <span className="rounded-full bg-black/40 px-2.5 py-[3px] text-zinc-500">
                      No additions
                    </span>
                  )}
                  {entry.removed.length > 0 ? (
                    entry.removed.map((topic, index) => (
                      <span
                        key={`${entry.timestamp}-removed-${topic}-${index}`}
                        className="rounded-full border border-rose-500/30 bg-rose-500/15 px-2.5 py-[3px] text-rose-200"
                      >
                        – {topic}
                      </span>
                    ))
                  ) : (
                    <span className="rounded-full bg-black/40 px-2.5 py-[3px] text-zinc-500">
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
  );
}
