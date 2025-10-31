"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  describeError,
  formatTimestamp,
  parseErrorResponse,
} from "@/lib/news-utils";
import type { Article, TopicNewsMap } from "@/types/news";

interface TopicClientProps {
  topicLabel: string;
  requestTopic: string;
}

export default function TopicClient({
  topicLabel,
  requestTopic,
}: TopicClientProps) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRankingBiases, setIsRankingBiases] = useState(false);
  const [selectedAction, setSelectedAction] = useState<string>("refresh");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const loadTopicArticles = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/news", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ topics: [requestTopic] }),
      });

      if (!response.ok) {
        throw new Error(await parseErrorResponse(response));
      }

      const payload = (await response.json()) as { topics?: TopicNewsMap };
      const rawArticles = payload.topics?.[requestTopic];
      const mappedArticles = Array.isArray(rawArticles) ? rawArticles : [];

      if (mappedArticles.length === 0) {
        setArticles([]);
        setErrorMessage(
          `No stored stories are available for ${topicLabel} right now.`,
        );
        setActionMessage(null);
        return;
      }

      setArticles(mappedArticles);

      setActionMessage(
        `Loaded ${mappedArticles.length} stored stor${
          mappedArticles.length === 1 ? "y" : "ies"
        } for ${topicLabel}.`,
      );
    } catch (error) {
      setErrorMessage(describeError(error));
    } finally {
      setIsLoading(false);
    }
  }, [requestTopic, topicLabel]);

  useEffect(() => {
    loadTopicArticles().catch(() => {
      /* handled in loadTopicArticles */
    });
  }, [loadTopicArticles]);

  const handleRefreshSources = useCallback(async () => {
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

      setActionMessage(
        "Fetched the latest stories. Refreshing this briefing for you...",
      );
      await loadTopicArticles();
    } catch (error) {
      setErrorMessage(describeError(error));
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, loadTopicArticles]);

  const handleRankBiases = useCallback(async () => {
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

      setActionMessage(
        "Bias scores updated. Refreshing this briefing with the latest metrics...",
      );
      await loadTopicArticles();
    } catch (error) {
      setErrorMessage(describeError(error));
    } finally {
      setIsRankingBiases(false);
    }
  }, [isRankingBiases, loadTopicArticles]);

  const handleActionRun = useCallback(async () => {
    if (selectedAction === "refresh") {
      await handleRefreshSources();
      return;
    }

    if (selectedAction === "rank") {
      await handleRankBiases();
    }
  }, [handleRankBiases, handleRefreshSources, selectedAction]);

  const actionOptions = useMemo(
    () => [
      { value: "refresh", label: "Refresh latest sources" },
      { value: "rank", label: "Rank biases" },
    ],
    [],
  );

  const isActionInFlight =
    isRefreshing || isRankingBiases || (isLoading && articles.length === 0);

  const biasSummary = useMemo(() => {
    const scored = articles.filter(
      (article) => typeof article.bias === "number",
    );
    return {
      scoredCount: scored.length,
      averageBias:
        scored.length > 0
          ? scored.reduce((total, item) => total + (item.bias ?? 0), 0) /
            scored.length
          : null,
    };
  }, [articles]);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#111827,_#0f172a_65%)] text-slate-100">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-12 md:px-10 lg:px-16">
        <header className="space-y-6 rounded-3xl bg-white/[0.03] p-8 backdrop-blur-sm md:p-12">
          <Link
            href="/"
            className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-300 transition hover:border-white/30 hover:bg-white/10"
          >
            ← Back to preferences
          </Link>
          <div className="space-y-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 py-1 text-xs uppercase tracking-[0.3em] text-slate-300">
              Topic briefing
            </span>
            <h1 className="text-3xl font-semibold leading-tight text-white sm:text-4xl">
              {topicLabel}
            </h1>
            <p className="max-w-2xl text-sm text-slate-300 sm:text-base">
              Review all stored articles, track bias scores, and refine your
              personalised digest for this topic.
            </p>
          </div>

          <div className="flex flex-col gap-4 pt-2 sm:flex-row sm:items-center">
            <div className="flex flex-wrap items-center gap-3">
              <label
                htmlFor="topic-action-selector"
                className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-300"
              >
                Quick actions
              </label>
              <select
                id="topic-action-selector"
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
              className="inline-flex items-center justify-center gap-2 rounded-full bg-emerald-500 px-5 py-2 text-sm font-semibold text-emerald-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-emerald-500/60"
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
                : "border-emerald-400/40 bg-emerald-500/10 text-emerald-100"
            }`}
          >
            {errorMessage ?? actionMessage}
          </div>
        )}

        <section className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.02] p-6 shadow-xl shadow-black/20 md:p-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-white">
                Stored articles
              </h2>
              <p className="text-sm text-slate-300">
                {isLoading
                  ? "Loading articles for this briefing..."
                  : articles.length
                  ? `Showing ${articles.length} articl${
                      articles.length === 1 ? "e" : "es"
                    } saved for ${topicLabel}.`
                  : `No stored articles found for ${topicLabel} yet.`}
              </p>
            </div>
            <div className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs uppercase tracking-[0.3em] text-slate-300">
              Bias scored: {biasSummary.scoredCount}
              {typeof biasSummary.averageBias === "number"
                ? ` · Avg bias ${biasSummary.averageBias.toFixed(2)}`
                : ""}
            </div>
          </div>

          {isLoading ? (
            <div className="grid gap-4 md:grid-cols-2">
              {[...Array(4)].map((_, index) => (
                <div
                  key={`loading-${index}`}
                  className="h-40 animate-pulse rounded-2xl border border-white/10 bg-white/[0.04]"
                />
              ))}
            </div>
          ) : articles.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-6 py-12 text-center text-sm text-slate-300">
              Trigger a sync from the home page or use the quick actions above
              to populate this briefing.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {articles.map((article, index) => {
                const composedKey =
                  article.id ?? article.hash_val ?? `${requestTopic}-${index}`;

                return (
                  <article
                    key={composedKey}
                    className="flex h-full flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-emerald-300/40 hover:bg-white/[0.06]"
                  >
                    {article.image_url ? (
                      <div className="relative overflow-hidden rounded-xl border border-white/10 bg-white/[0.06]">
                        <img
                          src={article.image_url}
                          alt={article.title || "Article image"}
                          className="h-40 w-full object-cover"
                          loading={index > 1 ? "lazy" : "eager"}
                        />
                      </div>
                    ) : (
                      <div className="flex h-40 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                        No image
                      </div>
                    )}

                    <div className="space-y-1">
                      <a
                        href={article.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-base font-semibold text-white hover:text-emerald-200"
                      >
                        {article.title}
                      </a>
                      {article.description && (
                        <p className="text-sm text-slate-300">
                          {article.description}
                        </p>
                      )}
                    </div>

                    <dl className="mt-auto grid grid-cols-2 gap-2 text-[11px] text-slate-400">
                      <div>
                        <dt className="uppercase tracking-[0.2em]">Published</dt>
                        <dd>{formatTimestamp(article.created_at)}</dd>
                      </div>
                      <div>
                        <dt className="uppercase tracking-[0.2em]">Author</dt>
                        <dd>{article.author ?? "Unknown"}</dd>
                      </div>
                      <div>
                        <dt className="uppercase tracking-[0.2em]">
                          Bias score
                        </dt>
                        <dd>
                          {typeof article.bias === "number"
                            ? article.bias.toFixed(2)
                            : "Pending"}
                        </dd>
                      </div>
                    </dl>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
