package outputcontroller

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	biascontroller "newsfetcher/controllers/bias_controller"
	fetchcontroller "newsfetcher/controllers/fetch_controller"
	"newsfetcher/initializer"
	"newsfetcher/models"

	"github.com/gofiber/fiber/v2"
	"gorm.io/gorm"
)

func FetchNewsByQuery(c *fiber.Ctx) error {
	var payload struct {
		Query string `json:"query"`
	}
	if err := c.BodyParser(&payload); err != nil {
		if !errors.Is(err, io.EOF) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "Invalid request body",
			})
		}
	}

	queryParam := strings.TrimSpace(c.Query("query"))
	topic := queryParam
	if topic == "" {
		topic = strings.TrimSpace(payload.Query)
	}
	if topic == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "query parameter is required",
		})
	}

	cfg, err := fetchcontroller.LoadWorkflowConfigFromEnv()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fmt.Sprintf("failed to load fetch configuration: %v", err),
		})
	}

	ctx := c.UserContext()
	if ctx == nil {
		ctx = context.Background()
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	if _, err := fetchcontroller.FetchTopicsWithConfig(ctx, []string{topic}, cfg); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fmt.Sprintf("failed to fetch news for topic %s: %v", topic, err),
		})
	}

	db := initializer.Database.Db
	if db == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "database connection unavailable",
		})
	}

	limit := cfg.MaxArticles
	articles, err := fetchArticlesForTag(ctx, db, topic, limit)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fmt.Sprintf("failed to load articles for topic %s: %v", topic, err),
		})
	}

	biasCfg, err := biascontroller.LoadBiasConfigFromEnv()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fmt.Sprintf("failed to load bias configuration: %v", err),
		})
	}

	result, err := biascontroller.ProcessBiasForArticles(ctx, articles, biasCfg)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fmt.Sprintf("failed to score bias for topic %s: %v", topic, err),
		})
	}
	if result.Failed > 0 {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error":   "failed to score bias for all articles",
			"details": result.Failures,
		})
	}

	articles, err = fetchArticlesForTag(ctx, db, topic, limit)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": fmt.Sprintf("failed to refresh articles for topic %s: %v", topic, err),
		})
	}

	response := map[string][]models.NewsModel{
		topic: articles,
	}

	return c.JSON(fiber.Map{
		"topics": response,
	})
}

func fetchArticlesForTag(ctx context.Context, db *gorm.DB, topic string, limit int) ([]models.NewsModel, error) {
	var articles []models.NewsModel
	lowered := strings.ToLower(strings.TrimSpace(topic))
	if lowered == "" {
		return articles, nil
	}

	query := db.WithContext(ctx).Where("LOWER(tags) = ?", lowered).Order("created_at DESC")
	if limit > 0 {
		query = query.Limit(limit)
	}

	if err := query.Find(&articles).Error; err != nil {
		return nil, err
	}

	return articles, nil
}
