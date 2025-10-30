package biascontroller

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"newsfetcher/initializer"
	"newsfetcher/models"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sagemakerruntime"
	"github.com/gofiber/fiber/v2"
)

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

	region := strings.TrimSpace(os.Getenv("AWS_REGION"))
	endpointName := strings.TrimSpace(os.Getenv("SAGEMAKER_ENDPOINT_NAME"))
	if region == "" || endpointName == "" {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "AWS_REGION and SAGEMAKER_ENDPOINT_NAME must be set",
		})
	}

	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fmt.Sprintf("failed to load AWS config: %v", err),
		})
	}

	runtimeClient := sagemakerruntime.NewFromConfig(cfg)
	httpClient := &http.Client{
		Timeout: 30 * time.Second,
	}

	var articles []models.NewsModel
	if err := db.WithContext(ctx).Find(&articles).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fmt.Sprintf("failed to load articles: %v", err),
		})
	}

	if len(articles) == 0 {
		return c.JSON(fiber.Map{
			"message": "no articles available for scoring",
			"updated": 0,
			"failed":  0,
		})
	}

	updated := 0
	failed := 0
	failures := make([]map[string]interface{}, 0)

	for _, article := range articles {
		if strings.TrimSpace(article.S3Url) == "" {
			failed++
			failures = append(failures, map[string]interface{}{
				"id":     article.ID.String(),
				"title":  article.Title,
				"reason": "missing s3 url",
			})
			continue
		}

		payload, err := downloadArticleText(ctx, httpClient, article.S3Url)
		if err != nil {
			failed++
			failures = append(failures, map[string]interface{}{
				"id":     article.ID.String(),
				"title":  article.Title,
				"reason": fmt.Sprintf("download failed: %v", err),
			})
			continue
		}

		score, err := invokeBiasEndpoint(ctx, runtimeClient, endpointName, payload)
		if err != nil {
			failed++
			failures = append(failures, map[string]interface{}{
				"id":     article.ID.String(),
				"title":  article.Title,
				"reason": fmt.Sprintf("sagemaker invocation failed: %v", err),
			})
			continue
		}

		if err := db.WithContext(ctx).Model(&models.NewsModel{}).Where("id = ?", article.ID).Update("bias", score).Error; err != nil {
			failed++
			failures = append(failures, map[string]interface{}{
				"id":     article.ID.String(),
				"title":  article.Title,
				"reason": fmt.Sprintf("failed to update bias: %v", err),
			})
			continue
		}

		updated++
	}

	return c.JSON(fiber.Map{
		"message":      "bias scores processed",
		"updated":      updated,
		"failed":       failed,
		"total":        len(articles),
		"failed_items": failures,
	})
}

func downloadArticleText(ctx context.Context, client *http.Client, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status %d downloading article", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	return body, nil
}

func invokeBiasEndpoint(ctx context.Context, client *sagemakerruntime.Client, endpoint string, payload []byte) (float64, error) {
	output, err := client.InvokeEndpoint(ctx, &sagemakerruntime.InvokeEndpointInput{
		EndpointName: aws.String(endpoint),
		Body:         payload,
		ContentType:  aws.String("text/plain; charset=utf-8"),
	})
	if err != nil {
		return 0, err
	}

	if output == nil {
		return 0, fmt.Errorf("received nil response from endpoint")
	}

	return parseBiasScore(output.Body)
}

func parseBiasScore(data []byte) (float64, error) {
	trimmed := strings.TrimSpace(string(data))
	if trimmed == "" {
		return 0, fmt.Errorf("empty response body")
	}

	var jsonPayload map[string]interface{}
	if err := json.Unmarshal(data, &jsonPayload); err == nil {
		for _, key := range []string{"bias", "bias_score", "score"} {
			if value, ok := jsonPayload[key]; ok {
				switch v := value.(type) {
				case float64:
					return v, nil
				case string:
					if parsed, parseErr := strconv.ParseFloat(strings.TrimSpace(v), 64); parseErr == nil {
						return parsed, nil
					}
				}
			}
		}
	}

	value, err := strconv.ParseFloat(trimmed, 64)
	if err != nil {
		return 0, fmt.Errorf("unable to parse bias score from response: %s", trimmed)
	}

	return value, nil
}
