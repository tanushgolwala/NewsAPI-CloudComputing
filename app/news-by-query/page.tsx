"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import BiasLegend from "@/components/bias-legend";
import { isBiasFlagged } from "@/lib/bias";
import {
  describeError,
  formatTimestamp,
  parseErrorResponse,
} from "@/lib/news-utils";
import type { Article, TopicNewsMap, TopicNewsResponse } from "@/types/news";

export default function NewsByQueryPage() {
  const [query, setQuery] = useState("");
  const [topics, setTopics] = useState<TopicNewsMap>({});
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState<string>("");

  const topicEntries = useMemo(() => Object.entries(topics), [topics]);

  const totalArticles = useMemo(
    () =>
      topicEntries.reduce(
        (total, [, articles]) => total + (Array.isArray(articles) ? articles.length : 0),
        0,
      ),
    [topicEntries],
  );

  const handleSubmit = useCallback(
    async (event?: React.FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      const trimmed = query.trim();

      if (!trimmed) {
        setErrorMessage("Enter a topic you want to investigate.");
        setStatusMessage(null);
        setTopics({});
        return;
      }

      setIsLoading(true);
      setErrorMessage(null);
      setStatusMessage(null);

      try {
        const response = await fetch("/api/news-by-query", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query: trimmed }),
        });

        if (!response.ok) {
          throw new Error(await parseErrorResponse(response));
        }

        const payload = (await response.json()) as TopicNewsResponse;
        const mappedTopics = payload?.topics ?? {};

        setTopics(mappedTopics);
        setLastQuery(trimmed);

        if (Object.keys(mappedTopics).length === 0) {
          setStatusMessage(`No stories available for "${trimmed}" right now.`);
          return;
        }

        const stories = Object.values(mappedTopics).reduce(
          (total, articles) => total + (Array.isArray(articles) ? articles.length : 0),
          0,
        );

        setStatusMessage(
          `Fetched ${stories} stor${stories === 1 ? "y" : "ies"} covering "${trimmed}".`,
        );
      } catch (error) {
        setErrorMessage(describeError(error));
        setTopics({});
      } finally {
        setIsLoading(false);
      }
    },
    [query],
  );

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#2a2a2a,_#050505_70%)] text-zinc-100">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-12 md:px-10 lg:px-16">
        <header className="space-y-6 rounded-3xl border border-orange-800/15 bg-black/35 p-8 shadow-lg shadow-black/50 backdrop-blur-sm md:p-12">
          <Link
            href="/"
            className="inline-flex w-fit items-center gap-2 rounded-full border border-orange-800/30 bg-orange-800/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-orange-100 transition hover:border-orange-700/70 hover:bg-orange-800/25"
          >
            ← Back to dashboard
          </Link>
          <div className="space-y-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-orange-800/30 bg-orange-800/20 px-4 py-1 text-xs uppercase tracking-[0.3em] text-orange-100">
              On-demand briefing
            </span>
            <h1 className="text-3xl font-semibold leading-tight text-white sm:text-4xl">
              Query fresh coverage
            </h1>
            <p className="max-w-3xl text-sm text-zinc-300 sm:text-base">
              Send any topic to the `/news-by-query` endpoint, store the latest articles, and review them instantly with bias scores, links, and metadata.
            </p>
          </div>
        </header>

        <section className="space-y-6 rounded-3xl border border-orange-800/15 bg-black/30 p-8 shadow-xl shadow-black/40">
          <form className="flex flex-col gap-4 md:flex-row" onSubmit={handleSubmit}>
            <label className="flex-1">
              <span className="text-xs font-semibold uppercase tracking-[0.35em] text-zinc-400">
                Query topic
              </span>
              <input
                type="text"
                placeholder="e.g. renewable energy storage"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-orange-800/20 bg-black/45 px-4 py-3 text-base text-white shadow-inner shadow-black/40 outline-none transition focus:border-orange-500 focus:bg-black/70"
                disabled={isLoading}
              />
            </label>
            <button
              type="submit"
              className="flex items-center justify-center rounded-2xl border border-orange-700/35 bg-gradient-to-r from-orange-600 to-amber-400 px-6 py-3 text-sm font-semibold uppercase tracking-[0.3em] text-black shadow-lg shadow-orange-900/40 transition hover:opacity-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-300 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isLoading}
            >
              {isLoading ? "Fetching…" : "Run query"}
            </button>
          </form>

          {lastQuery && totalArticles > 0 && (
            <div className="text-sm text-zinc-400">
              Showing {totalArticles} stor{totalArticles === 1 ? "y" : "ies"} for &ldquo;
              {lastQuery}
              &rdquo;.
            </div>
          )}

          {statusMessage && (
            <p className="rounded-2xl border border-orange-800/20 bg-orange-800/10 px-4 py-3 text-sm text-orange-100">
              {statusMessage}
            </p>
          )}
          {errorMessage && (
            <p className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {errorMessage}
            </p>
          )}

          <BiasLegend />
        </section>

        {topicEntries.length === 0 && !isLoading && !errorMessage && !statusMessage && (
          <section className="rounded-3xl border border-orange-800/15 bg-black/35 p-10 text-center text-zinc-400">
            <p className="text-base">
              Enter a topic to pull live coverage with bias insights.
            </p>
          </section>
        )}

        {topicEntries.map(([topic, articles]) => (
          <section
            key={topic}
            className="space-y-6 rounded-3xl border border-orange-800/15 bg-black/35 p-8 shadow-lg shadow-black/40"
          >
            <div className="flex flex-col gap-4 border-b border-white/5 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.4em] text-orange-200/80">
                  Topic
                </p>
                <h2 className="text-2xl font-semibold text-white">{topic}</h2>
              </div>
              <div className="text-sm text-zinc-400">
                Showing {articles.length} stor{articles.length === 1 ? "y" : "ies"}
              </div>
            </div>

            <div className="grid gap-6">
              {articles.map((article: Article) => {
                const articleKey =
                  article.id ?? `${topic}-${article.hash_val ?? article.link ?? article.title}`;
                const articleImage = article.image_url ?? article.s3_url ?? null;
                const isBiased = isBiasFlagged(article.bias);

                return (
                  <article
                    key={articleKey}
                    className={`flex flex-col gap-4 rounded-2xl border bg-black/40 p-6 text-zinc-100 shadow-inner ${
                      isBiased
                        ? "border-purple-500/60 shadow-purple-900/30"
                        : "border-orange-800/15 shadow-black/40"
                    }`}
                  >
                    {articleImage && (
                      <div
                        className={`overflow-hidden rounded-2xl border ${
                          isBiased
                            ? "border-purple-500/40"
                            : "border-orange-800/25"
                        } bg-black/50`}
                      >
                        <div
                          role="img"
                          aria-label={article.title ?? topic}
                          className="h-48 w-full bg-cover bg-center"
                          style={{
                            backgroundImage: `linear-gradient(0deg, rgba(0,0,0,0.4), rgba(0,0,0,0.4)), url(${articleImage})`,
                          }}
                        />
                      </div>
                    )}
                    <div className="flex flex-col gap-2">
                      <div
                        className={`flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.3em] ${
                          isBiased ? "text-purple-200" : "text-orange-200/80"
                        }`}
                      >
                        <span>
                          Bias {typeof article.bias === "number" ? article.bias.toFixed(2) : "?"}
                        </span>
                        {isBiased && (
                          <span className="rounded-full border border-purple-400/50 px-2 py-0.5 text-[0.65rem] normal-case tracking-normal text-purple-100">
                            Flagged
                          </span>
                        )}
                        {article.author && (
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[0.65rem] normal-case tracking-normal ${
                              isBiased
                                ? "border-purple-400/50 text-purple-100"
                                : "border-white/20 text-zinc-300"
                            }`}
                          >
                            {article.author}
                          </span>
                        )}
                        {article.tags && (
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[0.65rem] normal-case tracking-normal ${
                              isBiased
                                ? "border-purple-400/50 text-purple-100"
                                : "border-white/20 text-zinc-300"
                            }`}
                          >
                            {article.tags}
                          </span>
                        )}
                      </div>
                      <h3 className="text-xl font-semibold text-white">
                        {article.title || "Untitled story"}
                      </h3>
                    </div>
                    {article.description && (
                      <p className="text-sm text-zinc-300">
                        {article.description}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-400">
                      {article.created_at && (
                        <span>Added {formatTimestamp(article.created_at)}</span>
                      )}
                      {article.updated_at && article.updated_at !== article.created_at && (
                        <span>Updated {formatTimestamp(article.updated_at)}</span>
                      )}
                      {article.bias === null && <span>Bias not scored yet</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-sm">
                      {article.link && (
                        <a
                          href={article.link}
                          target="_blank"
                          rel="noreferrer"
                          className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] transition ${
                            isBiased
                              ? "border-purple-500/50 text-purple-100 hover:border-purple-300 hover:bg-purple-500/10"
                              : "border-orange-700/40 text-orange-100 hover:border-orange-500 hover:bg-orange-700/10"
                          }`}
                        >
                          Read article ↗
                        </a>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
