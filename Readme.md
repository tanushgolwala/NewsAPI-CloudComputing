# System Architecture

This project delivers a cloud-native news personalization platform that stitches together managed services across GCP and AWS. The architecture prioritizes serverless execution, event-driven integration, and low operational overhead.

## High-Level Flow

1. Visitors interact with the web client hosted on Vercel. Actions that require dynamic work (preference saves, bias checks) invoke Fluid Compute serverless functions.
2. The Vercel layer calls the backend API running on Google Cloud Run. Cloud Run exposes REST endpoints for user profiles, article retrieval, and orchestration of downstream services.
3. Preference updates are published to an Upstash Redis queue so that asynchronous processors can hydrate user models or trigger notifications without slowing down the request cycle.
4. A news-ingestion microservice periodically fetches articles, enriches metadata, and persists source documents to Amazon S3 for durable storage.
5. The ML bias-detection workload runs on AWS SageMaker, pulling article content from S3, scoring it, and returning labels to the backend for surfacing insights to the user.

## Component Breakdown

### Google Cloud Run Backend
- Containerized Go service deployed as fully managed Cloud Run instance.
- Auto-scales with incoming HTTP traffic and integrates with Google IAM for secure service-to-service calls.
- Coordinates data retrieval from S3 and inference requests to SageMaker before responding to the frontend.

### Upstash Redis Queue
- Serverless Redis deployment used strictly as a lightweight queue.
- API layer pushes preference-change events; downstream consumers subscribe to keep user profiles in sync.
- Pay-per-request pricing keeps the messaging layer cost-efficient for spiky workloads.

### Vercel Frontend and Fluid Compute
- Static frontend served globally through Vercel’s CDN for low-latency page loads.
- Serverless actions executed on Fluid Compute handle authenticated API calls, preference submissions, and bias-insight polling.
- Continuous deployment pipeline ensures merges to main land in production with automatic rollbacks available.

### News API Microservice on S3
- Dedicated microservice fetches batches of news items from external APIs.
- Cleans, tags, and archives raw payloads as versioned objects in Amazon S3.
- Provides the canonical data lake that both the backend and ML workloads use.

### SageMaker Bias Detection
- Managed ML endpoint hosting the latest bias-detection model.
- Consumes article text from S3, performs inference, and returns bias scores with confidence metrics.
- Scales independently of the core API and can be updated or A/B tested without touching the backend.

## Data & Control Considerations

- **Security:** Service-to-service calls leverage managed identities (Cloud IAM, AWS IAM) and scoped API keys where cross-cloud calls are required.
- **Latency:** Frontend-to-backend requests stay within serverless environments, while longer-running analysis jobs occur asynchronously via queues and batch processing.
- **Observability:** Cloud Run logs, Upstash metrics, S3 access logs, and SageMaker monitoring combine to give full traceability across the workflow.
- **Resilience:** Each component is independently deployable; managed scaling and queue-based decoupling prevent single-point overloads.

This architecture keeps the platform responsive for end users, streamlines operations by delegating infrastructure to cloud providers, and gives the team flexibility to iterate quickly on both product and ML models.

## Architecture Diagram

<img width="1721" height="1000" alt="image" src="https://github.com/user-attachments/assets/1f67d517-87ab-46d5-966b-28a66f7eb900" />


## Timeline Diagram

<img width="1735" height="742" alt="TPFFJXin4CRl-nGZ3cqY5LB13Qaja2Oj5OH0IBbmyTf3iEArjsCRHAjAVOU-OP-auzqrpQhX56ldDt--RoP7FWWAiJA5YC7PM9L8HT318Cm9xv3GIlJm2kP8tbbXz7TKCCD73tz-_OOh_1RH1vWQzmY3cOCpKPLA38j2oE08bfxBrTn1IrqB6s3dXDmZVuJ1LoI9PhW3maFtiK-s02oG7f0CUdzh1rCJjOAng-eOiCrjiQdj" src="https://github.com/user-attachments/assets/41915e03-696c-40ea-a96a-01c207fe9449" />

