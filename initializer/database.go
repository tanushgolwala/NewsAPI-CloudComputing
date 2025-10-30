package initializer

import (
	"log"
	"newsfetcher/models"
	"os"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type DbInstance struct {
	Db *gorm.DB
}

func GlobalActivationScope(db *gorm.DB) *gorm.DB {
	return db.Where("is_activated = ?", true)
}

var Database DbInstance

func ConnectToDB() {
	LoadEnvVariables()

	connectionString := os.Getenv("DB_URL")

	log.Println("Connecting to database...")
	db, err := gorm.Open(postgres.Open(connectionString), &gorm.Config{})

	if err != nil {
		log.Fatal("Error connecting to database")
	}

	db.Scopes(GlobalActivationScope)

	log.Println("Connected to database")

	if os.Getenv("SHOULD_MIGRATE") == "TRUE" {
		log.Println("Running DB Migrations...")

		err = db.AutoMigrate(&models.NewsModel{})

		if err != nil {
			log.Fatalf("Error running migrations: %v", err)
		}

		log.Println("DB Migrations completed")
	}

	Database = DbInstance{Db: db}
}
