package routers

import (
	biascontroller "newsfetcher/controllers/bias_controller"
	fetchcontroller "newsfetcher/controllers/fetch_controller"
	servecontroller "newsfetcher/controllers/serve_controller"

	"github.com/gofiber/fiber/v2"
)

func SetupRoutes(r fiber.Router) {
	r.Get("/fetch-news", fetchcontroller.FetchNews)
	r.Post("/get-news-by-topic", servecontroller.ServeByTopic)
	r.Get("/rank-biases", biascontroller.GetBiasScores)
}
