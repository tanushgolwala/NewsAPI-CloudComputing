package biascontroller

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"newsfetcher/initializer"
	"newsfetcher/models"

	"github.com/gofiber/fiber/v2"
)

const defaultHuggingFaceURL = "https://m6rebwzf26vlh38c.us-east-1.aws.endpoints.huggingface.cloud"

type BiasConfig struct {
	APIToken string
	APIURL   string
}

type BiasProcessingResult struct {
	Updated  int
	Failed   int
	Total    int
	Failures []map[string]interface{}
}

type InferenceError struct {
	StatusCode int
	Message    string
}

func (e *InferenceError) Error() string {
	if e == nil {
		return ""
	}
	if e.Message != "" {
		return e.Message
	}
	return fmt.Sprintf("huggingface returned status %d", e.StatusCode)
}

func (e *InferenceError) Retryable() bool {
	if e == nil {
		return false
	}
	return e.StatusCode >= 500 && e.StatusCode < 600
}

func LoadBiasConfigFromEnv() (BiasConfig, error) {
	token := strings.TrimSpace(os.Getenv("HF_TOKEN"))
	if token == "" {
		token = strings.TrimSpace(os.Getenv("HUGGINGFACE_API_TOKEN"))
	}

	apiURL := strings.TrimSpace(os.Getenv("HUGGINGFACE_ENDPOINT_URL"))
	if apiURL == "" {
		apiURL = strings.TrimSpace(os.Getenv("HUGGINGFACE_MODEL_URL"))
	}
	if apiURL == "" {
		apiURL = defaultHuggingFaceURL
	}

	if token == "" {
		return BiasConfig{}, errors.New("HF_TOKEN or HUGGINGFACE_API_TOKEN must be set")
	}

	return BiasConfig{
		APIToken: token,
		APIURL:   apiURL,
	}, nil
}

func ProcessBiasForArticles(ctx context.Context, articles []models.NewsModel, cfg BiasConfig) (BiasProcessingResult, error) {
	result := BiasProcessingResult{
		Total:    len(articles),
		Failures: make([]map[string]interface{}, 0),
	}

	db := initializer.Database.Db
	if db == nil {
		return result, errors.New("database connection unavailable")
	}

	if len(articles) == 0 {
		log.Printf("No articles provided for bias scoring")
		return result, nil
	}

	httpClient := &http.Client{
		Timeout: 30 * time.Second,
	}

	log.Printf("Starting bias scoring for %d articles", len(articles))

	for _, article := range articles {
		log.Printf("Processing article %s: %s", article.ID.String(), strings.TrimSpace(article.Title))
		if strings.TrimSpace(article.S3Url) == "" {
			result.Failed++
			failure := map[string]interface{}{
				"id":     article.ID.String(),
				"title":  article.Title,
				"reason": "missing s3 url",
			}
			result.Failures = append(result.Failures, failure)
			log.Printf("Skipping article %s due to missing S3 URL", article.ID.String())
			continue
		}

		description, err := downloadArticleText(ctx, httpClient, article.S3Url)
		if err != nil {
			result.Failed++
			failure := map[string]interface{}{
				"id":     article.ID.String(),
				"title":  article.Title,
				"reason": fmt.Sprintf("download failed: %v", err),
			}
			result.Failures = append(result.Failures, failure)
			log.Printf("Failed to download article %s: %v", article.ID.String(), err)
			continue
		}

		if description == "" {
			result.Failed++
			failure := map[string]interface{}{
				"id":     article.ID.String(),
				"title":  article.Title,
				"reason": "description is empty",
			}
			result.Failures = append(result.Failures, failure)
			log.Printf("Article %s has an empty description after parsing; skipping", article.ID.String())
			continue
		}

		score, err := invokeBiasWithRetry(ctx, httpClient, cfg, description)
		if err != nil {
			result.Failed++
			failure := map[string]interface{}{
				"id":     article.ID.String(),
				"title":  article.Title,
				"reason": fmt.Sprintf("huggingface invocation failed: %v", err),
			}
			result.Failures = append(result.Failures, failure)
			log.Printf("Hugging Face inference failed for article %s: %v", article.ID.String(), err)
			continue
		}

		if err := db.WithContext(ctx).Model(&models.NewsModel{}).Where("id = ?", article.ID).Update("bias", score).Error; err != nil {
			result.Failed++
			failure := map[string]interface{}{
				"id":     article.ID.String(),
				"title":  article.Title,
				"reason": fmt.Sprintf("failed to update bias: %v", err),
			}
			result.Failures = append(result.Failures, failure)
			log.Printf("Failed to update bias score for article %s: %v", article.ID.String(), err)
			continue
		}

		result.Updated++
		log.Printf("Updated bias score for article %s to %.4f", article.ID.String(), score)
	}

	log.Printf("Bias scoring complete: updated=%d failed=%d total=%d", result.Updated, result.Failed, result.Total)

	return result, nil
}

func GetBiasScores(c *fiber.Ctx) error {
	db := initializer.Database.Db
	if db == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "database connection unavailable",
		})
	}

	ctx := c.UserContext()
	if ctx == nil {
		ctx = context.Background()
	}

	forceRefresh := c.QueryBool("force", false)
	limit := 0
	if limitParam := strings.TrimSpace(c.Query("limit")); limitParam != "" {
		parsed, err := strconv.Atoi(limitParam)
		if err != nil || parsed <= 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "limit must be a positive integer",
			})
		}
		limit = parsed
	}
	cfg, err := LoadBiasConfigFromEnv()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": err.Error(),
		})
	}

	var articles []models.NewsModel
	query := db.WithContext(ctx)
	if !forceRefresh {
		query = query.Where("bias = ?", 0)
	}
	if limit > 0 {
		query = query.Limit(limit)
	}

	if err := query.Find(&articles).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fmt.Sprintf("failed to load articles: %v", err),
		})
	}

	if len(articles) == 0 {
		log.Printf("No articles available for bias scoring")
		return c.JSON(fiber.Map{
			"message": "no articles available for scoring",
			"updated": 0,
			"failed":  0,
		})
	}

	log.Printf("Starting bias scoring for %d articles (force=%t limit=%d)", len(articles), forceRefresh, limit)

	result, err := ProcessBiasForArticles(ctx, articles, cfg)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fmt.Sprintf("failed to process bias scores: %v", err),
		})
	}

	return c.JSON(fiber.Map{
		"message":      "bias scores processed",
		"updated":      result.Updated,
		"failed":       result.Failed,
		"total":        result.Total,
		"failed_items": result.Failures,
	})
}

func downloadArticleText(ctx context.Context, client *http.Client, url string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("unexpected status %d downloading article", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	description := extractDescription(body)
	return description, nil
}

func extractDescription(body []byte) string {
	text := strings.TrimSpace(string(body))
	if text == "" {
		return ""
	}

	normalized := strings.ReplaceAll(text, "\r\n", "\n")
	const markerLower = "description:"

	lower := strings.ToLower(normalized)
	idx := strings.Index(lower, markerLower)
	if idx == -1 {
		return strings.TrimSpace(normalized)
	}

	desc := normalized[idx+len(markerLower):]
	return strings.TrimSpace(desc)
}

func invokeBiasWithRetry(ctx context.Context, client *http.Client, cfg BiasConfig, description string) (float64, error) {
	const maxAttempts = 3
	backoff := time.Second

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		score, err := invokeBiasEndpoint(ctx, client, cfg.APIURL, cfg.APIToken, description)
		if err == nil {
			return score, nil
		}

		var infErr *InferenceError
		if errors.As(err, &infErr) && infErr.Retryable() && attempt < maxAttempts {
			wait := backoff * time.Duration(1<<(attempt-1))
			log.Printf("Retrying Hugging Face request (attempt %d/%d) after %s due to status %d", attempt+1, maxAttempts, wait, infErr.StatusCode)
			select {
			case <-time.After(wait):
			case <-ctx.Done():
				return 0, ctx.Err()
			}
			continue
		}

		return 0, err
	}

	return 0, fmt.Errorf("failed to invoke Hugging Face after %d attempts", maxAttempts)
}

func invokeBiasEndpoint(ctx context.Context, client *http.Client, apiURL, token string, description string) (float64, error) {
	requestBody := map[string]interface{}{
		"inputs":     description,
		"parameters": map[string]interface{}{},
	}

	bodyBytes, err := json.Marshal(requestBody)
	if err != nil {
		log.Printf("Failed to marshal Hugging Face request payload: %v", err)
		return 0, fmt.Errorf("failed to marshal huggingface payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, apiURL, bytes.NewReader(bodyBytes))
	if err != nil {
		log.Printf("Failed to build Hugging Face request: %v", err)
		return 0, err
	}

	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", token))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	// Ensure Inference Endpoints wait for the model to spin up instead of returning 503 immediately when cold-starting.
	req.Header.Set("X-Wait-For-Model", "true")

	log.Printf("Sending description (%d chars) to Hugging Face endpoint %s", len(description), apiURL)

	resp, err := client.Do(req)
	if err != nil {
		log.Printf("Hugging Face request failed: %v", err)
		return 0, err
	}
	defer resp.Body.Close()

	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("Failed to read Hugging Face response: %v", err)
		return 0, err
	}

	if resp.StatusCode != http.StatusOK {
		snippet := logResponseSnippet(responseBody)
		log.Printf("Hugging Face returned status %d with body: %s", resp.StatusCode, snippet)

		return 0, &InferenceError{
			StatusCode: resp.StatusCode,
			Message:    fmt.Sprintf("huggingface returned status %d: %s", resp.StatusCode, strings.TrimSpace(string(responseBody))),
		}
	}

	snippet := logResponseSnippet(responseBody)
	log.Printf("Hugging Face returned status %d with body: %s", resp.StatusCode, snippet)

	score, err := parseBiasScore(responseBody)
	if err != nil {
		log.Printf("Failed to parse Hugging Face response: %v", err)
		return 0, err
	}

	log.Printf("Parsed Hugging Face bias score: %.4f", score)
	return score, nil
}

func parseBiasScore(data []byte) (float64, error) {
	trimmed := strings.TrimSpace(string(data))
	if trimmed == "" {
		return 0, fmt.Errorf("empty response body")
	}

	var payload interface{}
	if err := json.Unmarshal(data, &payload); err == nil {
		if score, ok := extractScore(payload); ok {
			return score, nil
		}
	}

	value, err := strconv.ParseFloat(trimmed, 64)
	if err != nil {
		return 0, fmt.Errorf("unable to parse bias score from response: %s", trimmed)
	}

	return value, nil
}

func extractScore(data interface{}) (float64, bool) {
	switch v := data.(type) {
	case map[string]interface{}:
		for _, key := range []string{"bias", "bias_score", "score"} {
			if val, ok := v[key]; ok {
				if score, ok := extractScore(val); ok {
					return score, true
				}
			}
		}

		for _, val := range v {
			if score, ok := extractScore(val); ok {
				return score, true
			}
		}
	case []interface{}:
		for _, item := range v {
			if score, ok := extractScore(item); ok {
				return score, true
			}
		}
	case float64:
		return v, true
	case string:
		if parsed, err := strconv.ParseFloat(strings.TrimSpace(v), 64); err == nil {
			return parsed, true
		}
	}

	return 0, false
}

func logResponseSnippet(body []byte) string {
	trimmed := strings.TrimSpace(string(body))
	if trimmed == "" {
		return "<empty>"
	}
	const maxLen = 200
	if len(trimmed) > maxLen {
		return trimmed[:maxLen] + "..."
	}
	return trimmed
}
