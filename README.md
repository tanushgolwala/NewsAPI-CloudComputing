## News Intelligence Hub

A responsive Next.js dashboard that captures viewer interests, queues topic preferences to Upstash Redis, and pulls curated news from your Cloud backend. The interface highlights how interests evolve over time, offers one-click refreshes, and surfaces bias scores once t`hey are computed downstream.

### Key Features
- Topic picker with live diffing between the current and last synced interests, plus a quick-actions dropdown for refresh and bias ranking.
- Server-side API routes that:
  - queue preferences to Upstash Redis;
  - proxy `/get-news-by-topic`, `/fetch-news`, and `/rank-biases` calls to the backend running on `http://localhost:8080`.
- Personalised topic cards that link to dedicated article pages with S3 summaries and bias scores.
- Lightweight local history to visualise changes in focus areas.

### Getting Started
1. Install dependencies
   ```bash
   npm install
   ```
2. Create a `.env.local` based on `.env.example` and fill in the required values.
3. Run the development server
   ```bash
   npm run dev
   ```
4. Open [http://localhost:3000](http://localhost:3000) to access the dashboard.
`
### Required Environment Variables
Set the following keys in `.env.local` (see `.env.example`):

| Variable | Purpose |
| --- | --- |
| `NEWS_API_BASE_URL` | Base URL of the backend that exposes `/fetch-news`, `/get-news-by-topic`, and `/rank-biases`. Defaults to `http://localhost:8080`. |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint used to push preference messages. |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash REST token (Bearer) for authenticating queue writes. |
| `UPSTASH_REDIS_QUEUE_KEY` | Redis list key that stores queued topic preferences (e.g. `news:preferences`). |

### Usage Notes
- The topic form queues preferences and immediately pulls stored articles for the selected topics.
- Use the quick-actions dropdown on any page to trigger `/fetch-news` or `/rank-biases` without leaving the flow.
- Topic cards open dedicated pages where you can inspect every stored article for that topic.
- Interest history is persisted in `localStorage` to make it easy to compare sessions on the same device.

### Tech Stack
- Next.js App Router with React Server & Client Components
- Tailwind CSS (via the new `@import "tailwindcss"` workflow)
- Upstash Redis REST API
- Cloud news aggregation backend (localhost:8080)
