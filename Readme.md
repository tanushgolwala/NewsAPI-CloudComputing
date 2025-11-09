## API Endpoints

### GET `/fetch-news`
- **Description:** Fetches the latest articles for the predefined topics (Technology, Climate, Economy, Health, Diplomacy, Culture), uploads summaries to S3, and stores article metadata in the database.
- **Request:** No body required.
- **Successful Response:**
  ```json
  {
    "message": "News fetched and stored successfully",
    "summary": {
      "technology": {
        "stored": 3,
        "updated": 2,
        "skipped": 0
      }
    }
  }
  ```
- **Error Response:** `{"error": "API key not set"}` (message varies by failure).

### POST `/get-news-by-topic`
- **Description:** Returns stored articles grouped by the requested topics.
- **Request Body:**
  ```json
  {
    "topics": ["Technology", "Health"]
  }
  ```
- **Successful Response:**
  ```json
  {
    "topics": {
      "Technology": [
      {
        "id": "uuid",
        "created_at": "timestamp",
        "updated_at": "timestamp",
        "deleted_at": null,
        "title": "Example headline",
        "description": "Story summary",
        "link": "https://example.com/news",
        "image_url": "https://example.com/thumbnail.jpg",
        "author": "Reporter Name",
        "tags": "technology",
        "hash_val": "uuid",
        "s3_url": "https://signed-s3-url",
        "bias": 0
      }
    ]
  }
  }
  ```
- **Error Response:** `{"error": "No topics provided"}` (message varies by failure).

### GET `/rank-biases`
- **Description:** Downloads article text from S3, invokes the configured Hugging Face Inference Endpoint to compute bias scores, and updates stored articles.
- **Request:** No body required.
- **Successful Response:**
  ```json
  {
    "message": "bias scores processed",
    "updated": 5,
    "failed": 1,
    "total": 6,
    "failed_items": [
      {
        "id": "uuid",
        "title": "Example headline",
        "reason": "huggingface invocation failed: error details"
      }
    ]
  }
  ```
- **Error Response:** `{"error": "HF_TOKEN or HUGGINGFACE_API_TOKEN must be set"}` (message varies by failure).

### GET/POST `/news-by-query`
- **Description:** On-demand endpoint that accepts an arbitrary topic, fetches fresh articles for it, stores the content in S3/DB, scores each article for bias, and immediately returns the enriched articles.
- **Request:**
  - Query parameter: `/news-by-query?query=renewable energy`
  - or JSON body:
    ```json
    {
      "query": "renewable energy"
    }
    ```
- **Successful Response:**
  ```json
  {
    "topics": {
      "renewable energy": [
      {
        "id": "uuid",
        "created_at": "timestamp",
        "updated_at": "timestamp",
        "deleted_at": null,
        "title": "Grid-scale storage breakthrough",
        "description": "Story summary",
        "link": "https://example.com/news",
        "image_url": "https://example.com/thumbnail.jpg",
        "author": "Reporter Name",
        "tags": "renewable energy",
        "hash_val": "uuid",
        "s3_url": "https://signed-s3-url",
        "bias": -0.21
      }
    ]
  }
  }
  ```
- **Error Responses:** `{"error": "query parameter is required"}` if no topic is provided, or `{"error": "failed to score bias for all articles", "details": [...]}` if Hugging Face inference fails for one or more items.

## Required Environment Variables
- `DB_URL`: PostgreSQL connection string used during application startup and by all endpoints.
- `NEWS_API_KEY`: API key for the external news provider, required by `GET /fetch-news`.
- `AWS_REGION`: AWS region used for all S3 interactions (uploading article text and generating presigned URLs), required by `/fetch-news`, `/rank-biases`, and `/news-by-query`.
- `AWS_S3_BUCKET`: S3 bucket name where article summaries are stored, required by `GET /fetch-news`.
- `HF_TOKEN` or `HUGGINGFACE_API_TOKEN`: Hugging Face access token used for all bias-scoring requests (`GET /rank-biases` and `/news-by-query`).
- `HUGGINGFACE_ENDPOINT_URL` (or `HUGGINGFACE_MODEL_URL`): Optional override for the Hugging Face Inference Endpoint URL; defaults to the deployed endpoint baked into the binary.
