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
          "is_activated": true,
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
- **Description:** Downloads article text from S3, invokes the configured SageMaker endpoint to compute bias scores, and updates stored articles.
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
        "reason": "sagemaker invocation failed: error details"
      }
    ]
  }
  ```
- **Error Response:** `{"error": "AWS_REGION and SAGEMAKER_ENDPOINT_NAME must be set"}` (message varies by failure).

## Required Environment Variables
- `DB_URL`: PostgreSQL connection string used during application startup and by all endpoints.
- `NEWS_API_KEY`: API key for the external news provider, required by `GET /fetch-news`.
- `AWS_REGION`: AWS region for S3 and SageMaker interactions, required by `GET /fetch-news` and `GET /rank-biases`.
- `AWS_S3_BUCKET`: S3 bucket name where article summaries are stored, required by `GET /fetch-news`.
- `SAGEMAKER_ENDPOINT_NAME`: Deployed SageMaker endpoint identifier used for bias scoring, required by `GET /rank-biases`.
