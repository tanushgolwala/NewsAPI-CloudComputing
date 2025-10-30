package fetchcontroller

import (
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

func FetchNewsFromAPI(topic string) (*http.Response, error) {
	response, err := http.Get("https://newsapi.org/v2/everything?q=" + topic + "&apiKey=" + os.Getenv("NEWS_API_KEY"))
	if err != nil {
		return nil, err
	}
	return response, nil
}

func FetchNews(c *fiber.Ctx) error {
	api_key := os.Getenv("NEWS_API_KEY")
	if api_key == "" {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "API key not set",
		})
	}

	var responses []*http.Response
	for _, topic := range topics {
		res, err := FetchNewsFromAPI(topic)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to fetch news for topic: " + topic,
			})
		}
		responses = append(responses, res)
	}

	return c.JSON(fiber.Map{
		"message": "News fetched successfully",
		"data":    responses,
	})
}
