package main

import (
	"newsfetcher/initializer"
	"newsfetcher/routers"

	"github.com/gofiber/fiber/v2"
)

func main() {
	app := fiber.New()
	initializer.ConnectToDB()

	routers.SetupRoutes(app)

	app.Get("/", func(c *fiber.Ctx) error {
		return c.SendString("Hello, World!")
	})
	app.Listen(":8080")
}
