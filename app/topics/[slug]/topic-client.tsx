"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import BiasLegend from "@/components/bias-legend";
import { isBiasFlagged } from "@/lib/bias";
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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#2a2a2a,_#050505_70%)] text-zinc-100">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-12 md:px-10 lg:px-16">
        <header className="space-y-6 rounded-3xl border border-orange-800/15 bg-black/30 p-8 shadow-lg shadow-black/40 backdrop-blur-sm md:p-12">
          <Link
            href="/"
            className="inline-flex w-fit items-center gap-2 rounded-full border border-orange-800/30 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-orange-100 transition hover:border-orange-900/60 hover:bg-orange-800/20"
          >
            ← Back to preferences
          </Link>
          <div className="space-y-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-orange-800/35 bg-orange-800/20 px-4 py-1 text-xs uppercase tracking-[0.3em] text-orange-100">
              Topic briefing
            </span>
            <h1 className="text-3xl font-semibold leading-tight text-white sm:text-4xl">
              {topicLabel}
            </h1>
            <p className="max-w-2xl text-sm text-zinc-300 sm:text-base">
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
                className="rounded-full border border-orange-800/25 bg-black/40 px-4 py-2 text-sm font-medium text-white shadow-inner focus:border-orange-500 focus:outline-none disabled:cursor-not-allowed disabled:border-orange-800/25 disabled:text-zinc-500"
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
              className="inline-flex items-center justify-center gap-2 rounded-full bg-orange-800 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-orange-900/25 transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:bg-orange-800/70"
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
                : "border-orange-800/40 bg-orange-800/15 text-orange-100"
            }`}
          >
            {errorMessage ?? actionMessage}
          </div>
        )}

        <section className="space-y-4 rounded-3xl border border-orange-800/15 bg-black/30 p-6 shadow-xl shadow-black/40 md:p-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-white">
                Stored articles
              </h2>
              <p className="text-sm text-zinc-300">
                {isLoading
                  ? "Loading articles for this briefing..."
                  : articles.length
                  ? `Showing ${articles.length} articl${
                      articles.length === 1 ? "e" : "es"
                    } saved for ${topicLabel}.`
                  : `No stored articles found for ${topicLabel} yet.`}
              </p>
            </div>
            <div className="rounded-full border border-orange-800/25 bg-black/40 px-4 py-2 text-xs uppercase tracking-[0.3em] text-orange-100">
              Non Bias scored: {biasSummary.scoredCount}
              {typeof biasSummary.averageBias === "number"
                ? ` · Avg bias ${biasSummary.averageBias.toFixed(2)}`
                : ""}
            </div>
          </div>

          <BiasLegend className="mt-2" />

          {isLoading ? (
            <div className="grid gap-4 md:grid-cols-2">
              {[...Array(4)].map((_, index) => (
                <div
                  key={`loading-${index}`}
                  className="h-40 animate-pulse rounded-2xl border border-orange-800/20 bg-black/40"
                />
              ))}
            </div>
          ) : articles.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-orange-800/25 bg-black/35 px-6 py-12 text-center text-sm text-zinc-300">
              Trigger a sync from the home page or use the quick actions above
              to populate this briefing.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {articles.map((article, index) => {
                const composedKey =
                  article.id ?? article.hash_val ?? `${requestTopic}-${index}`;
                const isBiased = isBiasFlagged(article.bias);
                const hasBiasScore = typeof article.bias === "number";
                const biasDisplay = hasBiasScore
                  ? (article.bias as number).toFixed(2)
                  : "Pending";

                return (
                  <article
                    key={composedKey}
                    className={`flex h-full flex-col gap-3 rounded-2xl border bg-black/45 p-4 transition ${
                      isBiased
                        ? "border-purple-500/60 shadow-inner shadow-purple-900/20 hover:border-purple-400/80"
                        : "border-orange-800/20 hover:border-orange-900/60 hover:bg-black/55"
                    }`}
                  >
                    {article.image_url ? (
                      <div
                        className={`relative overflow-hidden rounded-xl border bg-black/40 ${
                          isBiased
                            ? "border-purple-500/40"
                            : "border-orange-800/25"
                        }`}
                      >
                        <img
                          src={article.image_url}
                          alt={article.title || "Article image"}
                          className="h-40 w-full object-cover"
                          loading={index > 1 ? "lazy" : "eager"}
                        />
                      </div>
                    ) : (
                      <div
                        className={`flex h-40 items-center justify-center rounded-xl border text-xs font-semibold uppercase tracking-[0.3em] ${
                          isBiased
                            ? "border-purple-500/40 bg-black/45 text-purple-200"
                            : "border-orange-800/25 bg-black/40 text-zinc-500"
                        }`}
                      >
                        No image
                      </div>
                    )}

                    <div className="space-y-1">
                      <a
                        href={article.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`text-base font-semibold text-white transition ${
                          isBiased ? "hover:text-purple-100" : "hover:text-orange-100"
                        }`}
                      >
                        {article.title}
                      </a>
                      {article.description && (
                        <p className="text-sm text-zinc-300">
                          {article.description}
                        </p>
                      )}
                    </div>

                    <div
                      className={`flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.3em] ${
                        isBiased ? "text-purple-100" : "text-zinc-400"
                      }`}
                    >
                      <span
                        className={`rounded-full border px-3 py-1 ${
                          isBiased
                            ? "border-purple-500/50 bg-purple-500/10 text-purple-100"
                            : "border-orange-800/25 bg-black/45 text-zinc-300"
                        }`}
                      >
                        Bias {biasDisplay}
                      </span>
                      {isBiased && (
                        <span className="rounded-full border border-purple-400/50 px-3 py-1 text-[0.65rem] normal-case tracking-normal text-purple-100">
                          Flagged
                        </span>
                      )}
                    </div>

                    <dl className="mt-auto grid grid-cols-2 gap-2 text-[11px] text-zinc-400">
                      <div>
                        <dt className="uppercase tracking-[0.2em]">Published</dt>
                        <dd>{formatTimestamp(article.created_at)}</dd>
                      </div>
                      <div>
                        <dt className="uppercase tracking-[0.2em]">Author</dt>
                        <dd>{article.author ?? "Unknown"}</dd>
                      </div>
                      <div>
                        <dt className="uppercase tracking-[0.2em]">Bias score</dt>
                        <dd className={isBiased ? "text-purple-200" : undefined}>
                          {biasDisplay}
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
