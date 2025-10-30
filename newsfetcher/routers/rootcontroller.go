package routers

import (
	fetchcontroller "newsfetcher/controllers/fetch_controller"

	"github.com/gofiber/fiber/v2"
)

func SetupRoutes(r fiber.Router) {
	r.Get("/fetch-news", fetchcontroller.FetchNews)
}
