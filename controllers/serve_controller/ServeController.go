package servecontroller

import (
	"context"
	"fmt"
	"strings"

	"newsfetcher/initializer"
	"newsfetcher/models"

	"github.com/gofiber/fiber/v2"
)

type servestruct struct {
	Topics []string `json:"topics"`
}

func ServeByTopic(c *fiber.Ctx) error {
	var req servestruct
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if len(req.Topics) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "No topics provided",
		})
	}

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

	response := make(map[string][]models.NewsModel)

	for _, topic := range req.Topics {
		tag := strings.TrimSpace(topic)
		if tag == "" {
			continue
		}

		lowered := strings.ToLower(tag)

		var articles []models.NewsModel
		if err := db.WithContext(ctx).Where("LOWER(tags) = ?", lowered).Find(&articles).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": fmt.Sprintf("failed to fetch articles for topic %s: %v", tag, err),
			})
		}

		response[tag] = articles
	}

	return c.JSON(fiber.Map{
		"topics": response,
	})
}
