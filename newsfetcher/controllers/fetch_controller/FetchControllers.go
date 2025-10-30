package fetchcontroller

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"

	"github.com/gofiber/fiber/v2"
)

var topics = []string{
	"Technology",
	"Climate",
	"Economy",
	"Health",
	"Diplomacy",
	"Culture",
}

func FetchNewsFromAPI(topic, apiKey string) (map[string]interface{}, error) {
	response, err := http.Get("https://newsapi.org/v2/everything?q=" + topic + "&apiKey=" + apiKey)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status %d from NewsAPI", response.StatusCode)
	}

	var payload map[string]interface{}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		return nil, err
	}
	return payload, nil
}

func FetchNews(c *fiber.Ctx) error {
	apiKey := os.Getenv("NEWS_API_KEY")
	if apiKey == "" {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "API key not set",
		})
	}

	results := make(map[string]interface{})
	for _, topic := range topics {
		data, err := FetchNewsFromAPI(topic, apiKey)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": fmt.Sprintf("Failed to fetch news for topic %s: %v", topic, err),
			})
		}
		results[topic] = data
	}

	return c.JSON(fiber.Map{
		"message": "News fetched successfully",
		"data":    results,
	})
}
