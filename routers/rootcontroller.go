package routers

import (
	biascontroller "newsfetcher/controllers/bias_controller"
	fetchcontroller "newsfetcher/controllers/fetch_controller"
	outputcontroller "newsfetcher/controllers/output_controller"
	servecontroller "newsfetcher/controllers/serve_controller"

	"github.com/gofiber/fiber/v2"
)

func SetupRoutes(r fiber.Router) {
	r.Get("/fetch-news", fetchcontroller.FetchNews)
	r.Post("/get-news-by-topic", servecontroller.ServeByTopic)
	r.Get("/rank-biases", biascontroller.GetBiasScores)
	r.Get("/news-by-query", outputcontroller.FetchNewsByQuery)
	r.Post("/news-by-query", outputcontroller.FetchNewsByQuery)
}
